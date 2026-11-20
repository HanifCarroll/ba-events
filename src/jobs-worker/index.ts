/**
 * baeventos-jobs: the scheduled import, enrichment, and retention jobs.
 *
 * Each job is a Cloudflare Workflow. Cron Triggers (UTC; Buenos Aires is UTC-3
 * all year) call `scheduled()`, which starts an ordinary instance: no overall
 * deadline and no one-hour scheduled budget. Every unit of work is a `step.do` with
 * Trigger.dev's old policy: 3 attempts with exponential backoff from 1 second,
 * and the old per-task time budget as the step timeout.
 */
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers'
import type { D1Database, Vectorize } from '@cloudflare/workers-types'
import { boundVectorize, catalogStoreFor } from '#features/import/core/catalog-store-for.ts'
import type { BrowserWorker } from '@cloudflare/playwright'
import { Schema } from 'effect'
import { importAllSources, mapBatchRunsToResults } from './daily-scrape-outcome.ts'
import { closeScrapeRun, openScrapeRun, timed } from './daily-scrape.ts'
import { catchupMaxBatches, countCatchupBacklog, dailyMaxBatches, runCatchupBatch, runDailyEnrichmentBatch } from './enrichment.ts'
import { purgeGuestLifecycleRetention } from './guest-lifecycle-retention.ts'
import { boundD1Database } from '#shared/lib/db/d1.server.ts'
import { SOURCES } from './source-health.ts'
import { dispatchCron } from './schedule.ts'
import { EMBEDDING_TASK_LIMIT, runCatalogTask, runEmbeddingTask } from './catalog-maintenance.ts'
import { isReadOnly } from '#shared/lib/db/read-only.ts'
import { importSource, readSourceCatalog } from './sources.ts'
import { officialPageRenderer } from '#features/import/intake/render-official-page.ts'
import { cloudflareBrowser } from './browser.ts'
import { handleIntakeRequest, type IntakeApiEnv } from './intake-api.ts'

interface WorkflowBinding { create(options: { id: string; params?: unknown }): Promise<unknown> }

export interface JobsEnv extends IntakeApiEnv {
  BROWSER: BrowserWorker
  DAILY_SCRAPE: WorkflowBinding
  GUEST_RETENTION: WorkflowBinding
  ENRICHMENT_CATCHUP: WorkflowBinding
  DB?: D1Database
  VECTORIZE?: Vectorize
  /** '1' during the D1 cutover window: crons start nothing (read-only.ts). */
  DB_READ_ONLY?: string
}

type Budget = '10 minutes' | '30 minutes' | '1 hour'
const policy = (timeout: Budget) => ({ retries: { limit: 2, delay: '1 second', backoff: 'exponential' as const }, timeout })
const SOURCE_BUDGET = { meetup: '30 minutes', 'ba-tourism': '10 minutes', luma: '1 hour' } as const

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 09:00 UTC (06:00 Buenos Aires): import every source, then drain the new events' enrichment. */
export class DailyScrapeWorkflow extends WorkflowEntrypoint<JobsEnv, unknown> {
  async run(event: WorkflowEvent<unknown>, step: WorkflowStep) {
    const params = event.payload as { scheduledTime?: string } | undefined
    const scheduledTime = params?.scheduledTime ?? null
    const run = await step.do('open scrape run', policy('10 minutes'), () => openScrapeRun(catalogStoreFor(this.env), event.instanceId, scheduledTime))

    // Sources run concurrently, so a hung source cannot delay the others.
    const outcomes = await importAllSources(step, SOURCES, id => SOURCE_BUDGET[id], id =>
      timed(id, () => importSource(id, catalogStoreFor(this.env), this.env.BROWSER, event.instanceId, run.id)))

    const results = mapBatchRunsToResults(outcomes, SOURCES)
    const eligible = await step.do('close scrape run', policy('10 minutes'), () => closeScrapeRun(catalogStoreFor(this.env), run, outcomes, results))

    if (eligible > 0) {
      const maxBatches = dailyMaxBatches(eligible)
      let totals = { enrichedSoFar: 0, failedSoFar: 0 }
      for (let batchNumber = 1; batchNumber <= maxBatches; batchNumber++) {
        const batch = await step.do(`enrich batch ${batchNumber}`, policy('30 minutes'), () => runDailyEnrichmentBatch(catalogStoreFor(this.env), {
          runId: event.instanceId, scrapeRunId: run.id, createdAfter: run.startedAt, eligible, batchNumber, maxBatches, ...totals,
        }))
        totals = { enrichedSoFar: batch.enrichedSoFar, failedSoFar: batch.failedSoFar }
        if (!batch.chainNext) break
      }
    }

    const failed = outcomes.filter(outcome => !outcome.ok).map(outcome => outcome.taskIdentifier)
    // Recorded above; failing the instance keeps a broken source visible in the dashboard.
    if (failed.length) throw new Error(`Sources failed: ${failed.join(', ')}`)
    return { scrapeRunId: run.id, results, enrichmentEligible: eligible }
  }
}

/** 13:00 UTC (10:00 Buenos Aires): retry failed rows once and drain any pending backlog. */
export class EnrichmentCatchupWorkflow extends WorkflowEntrypoint<JobsEnv, unknown> {
  async run(event: WorkflowEvent<unknown>, step: WorkflowStep) {
    const pendingCount = await step.do('count backlog', policy('10 minutes'), () => countCatchupBacklog(catalogStoreFor(this.env)))
    if (pendingCount === 0) return { pendingCount, batches: 0 }
    const maxBatches = catchupMaxBatches(pendingCount)
    let batchNumber = 1
    for (; batchNumber <= maxBatches; batchNumber++) {
      const batch = await step.do(`catch-up batch ${batchNumber}`, policy('1 hour'), () =>
        runCatchupBatch(catalogStoreFor(this.env), event.instanceId, batchNumber, maxBatches))
      if (!batch.chainNext) break
    }
    return { pendingCount, batches: Math.min(batchNumber, maxBatches) }
  }
}

/** 10:00 UTC (07:00 Buenos Aires): delete guest lifecycle and transcript rows older than 30 days. */
export class GuestRetentionWorkflow extends WorkflowEntrypoint<JobsEnv, unknown> {
  async run(_event: WorkflowEvent<unknown>, step: WorkflowStep) {
    return step.do('purge guest lifecycle', policy('10 minutes'), () => {
      const d1 = boundD1Database(this.env)
      if (!d1) throw new Error('Missing DB binding')
      return purgeGuestLifecycleRetention(d1)
    })
  }
}

const checkSchema = Schema.Struct({ days: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 14 }))) })

/**
 * Manual, unscheduled source check (replaces `browser-acquisition-check`):
 * reads each source's catalog with no database, model, or embedding calls.
 * `wrangler workflows trigger baeventos-source-check '{"days":2}'`
 */
export class SourceCheckWorkflow extends WorkflowEntrypoint<JobsEnv, unknown> {
  async run(event: WorkflowEvent<unknown>, step: WorkflowStep) {
    const { days = 1 } = Schema.decodeUnknownSync(checkSchema)(event.payload ?? {})
    const day = (offset: number) => new Date(Date.now() - 3 * 3600_000 + offset * 86400_000).toISOString().slice(0, 10)
    const results = []
    for (const source of SOURCES) {
      try {
        results.push(await step.do(`read ${source.id}`, { retries: { limit: 0, delay: '1 second', backoff: 'constant' }, timeout: '10 minutes' }, () =>
          readSourceCatalog(source.id, this.env.BROWSER, day(0), day(days - 1))))
      } catch (error) {
        results.push({ source: source.id, error: message(error) })
      }
    }
    return { checkedAt: new Date().toISOString(), results }
  }
}

const catalogTaskSchema = Schema.Struct({
  task: Schema.Literals(['mark-past-events', 'reconcile-vectors', 'populate-embeddings', 'reembed-stale']),
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: EMBEDDING_TASK_LIMIT }))),
})

/** Manual catalog maintenance. Scheduled jobs keep their own entry points. */
export class CatalogTaskWorkflow extends WorkflowEntrypoint<JobsEnv, unknown> {
  async run(event: WorkflowEvent<unknown>, step: WorkflowStep) {
    const { task, limit = EMBEDDING_TASK_LIMIT } = Schema.decodeUnknownSync(catalogTaskSchema)(event.payload ?? {})
    return step.do(task, { retries: { limit: 0, delay: '1 second', backoff: 'constant' }, timeout: '30 minutes' }, async () => {
      if (isReadOnly(this.env)) throw new Error('Catalog maintenance is disabled in read-only mode')
      if (task === 'populate-embeddings' || task === 'reembed-stale') {
        const db = boundD1Database(this.env)
        const vectors = boundVectorize(this.env)
        if (!db || !vectors) throw new Error('Catalog maintenance requires DB and VECTORIZE')
        return runEmbeddingTask(task, db, vectors, limit)
      }
      return JSON.parse(JSON.stringify(await runCatalogTask(task, this.env)))
    })
  }
}

export default {
  // `/intake/*` answers only where the env binds DB (intake-api.ts); everything else stays a 404.
  fetch: (request: Request, env: JobsEnv) => handleIntakeRequest(request, env,
    env.BROWSER && officialPageRenderer(cloudflareBrowser(env.BROWSER, 'intake', 20_000))),
  scheduled: (controller: { cron: string; scheduledTime: number }, env: JobsEnv) => dispatchCron(controller, env, runCatalogTask),
}
