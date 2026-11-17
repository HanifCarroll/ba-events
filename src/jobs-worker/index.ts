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
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { D1Database, Vectorize } from '@cloudflare/workers-types'
import { catalogStoreFor } from '#features/import/core/catalog-store-for.ts'
import type { CatalogStore } from '#features/import/core/catalog-store.ts'
import type { BrowserWorker } from '@cloudflare/playwright'
import { Schema } from 'effect'
import { importAllSources, mapBatchRunsToResults } from './daily-scrape-outcome.ts'
import { closeScrapeRun, openScrapeRun, timed } from './daily-scrape.ts'
import { catchupMaxBatches, countCatchupBacklog, dailyMaxBatches, runCatchupBatch, runDailyEnrichmentBatch } from './enrichment.ts'
import { purgeGuestLifecycleRetention } from './guest-lifecycle-retention.ts'
import { boundD1Database } from '#shared/lib/db/d1.server.ts'
import { useD1Binding } from '#shared/lib/db/d1-binding.server.ts'
import { SOURCES } from './source-health.ts'
import { dispatchCron } from './schedule.ts'
import { runCatalogTask } from './catalog-maintenance.ts'
import { importSource, readSourceCatalog } from './sources.ts'
import { handleIntakeRequest, type IntakeApiEnv } from './intake-api.ts'

interface WorkflowBinding { create(options: { id: string; params?: unknown }): Promise<unknown> }

/** The intake API's bindings (`DB`, `VECTORIZE`, the two R2 buckets, `INTAKE_API_TOKEN`) exist only in staging until the cutover. */
export interface JobsEnv extends IntakeApiEnv {
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
  BROWSER: BrowserWorker
  DAILY_SCRAPE: WorkflowBinding
  GUEST_RETENTION: WorkflowBinding
  ENRICHMENT_CATCHUP: WorkflowBinding
  /** Only staging binds these until the cutover (delivery PR 08); without `DB` every job uses Supabase. */
  DB?: D1Database
  VECTORIZE?: Vectorize
  /** '1' during the D1 cutover window: crons start nothing (read-only.ts). */
  DB_READ_ONLY?: string
}

type Budget = '10 minutes' | '30 minutes' | '1 hour'
const policy = (timeout: Budget) => ({ retries: { limit: 2, delay: '1 second', backoff: 'exponential' as const }, timeout })
const SOURCE_BUDGET = { meetup: '30 minutes', 'ba-tourism': '10 minutes', luma: '1 hour' } as const

/** A fresh client per step: nothing request-scoped is cached across invocations. */
function serviceClient(env: JobsEnv): SupabaseClient {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
}

/** The catalog for one step: D1 when the env binds it, else Supabase. Fresh per step, like the client. */
function catalog(env: JobsEnv): CatalogStore {
  return catalogStoreFor(env, () => serviceClient(env))
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 09:00 UTC (06:00 Buenos Aires): import every source, then drain the new events' enrichment. */
export class DailyScrapeWorkflow extends WorkflowEntrypoint<JobsEnv, unknown> {
  async run(event: WorkflowEvent<unknown>, step: WorkflowStep) {
    // run() re-executes from the top on every wake, so each isolate records the binding before any step reaches the acquisition cache.
    useD1Binding(this.env)
    const params = event.payload as { scheduledTime?: string } | undefined
    const scheduledTime = params?.scheduledTime ?? null
    const run = await step.do('open scrape run', policy('10 minutes'), () => openScrapeRun(catalog(this.env), event.instanceId, scheduledTime))

    // Sources run concurrently, so a hung source cannot delay the others.
    const outcomes = await importAllSources(step, SOURCES, id => SOURCE_BUDGET[id], id =>
      timed(id, () => importSource(id, catalog(this.env), this.env.BROWSER, event.instanceId, run.id)))

    const results = mapBatchRunsToResults(outcomes, SOURCES)
    const eligible = await step.do('close scrape run', policy('10 minutes'), () => closeScrapeRun(catalog(this.env), run, outcomes, results))

    if (eligible > 0) {
      const maxBatches = dailyMaxBatches(eligible)
      let totals = { enrichedSoFar: 0, failedSoFar: 0 }
      for (let batchNumber = 1; batchNumber <= maxBatches; batchNumber++) {
        const batch = await step.do(`enrich batch ${batchNumber}`, policy('30 minutes'), () => runDailyEnrichmentBatch(catalog(this.env), {
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
    useD1Binding(this.env)
    const pendingCount = await step.do('count backlog', policy('10 minutes'), () => countCatchupBacklog(catalog(this.env)))
    if (pendingCount === 0) return { pendingCount, batches: 0 }
    const maxBatches = catchupMaxBatches(pendingCount)
    let batchNumber = 1
    for (; batchNumber <= maxBatches; batchNumber++) {
      const batch = await step.do(`catch-up batch ${batchNumber}`, policy('1 hour'), () =>
        runCatchupBatch(catalog(this.env), event.instanceId, batchNumber, maxBatches))
      if (!batch.chainNext) break
    }
    return { pendingCount, batches: Math.min(batchNumber, maxBatches) }
  }
}

/** 10:00 UTC (07:00 Buenos Aires): delete guest lifecycle and transcript rows older than 30 days. */
export class GuestRetentionWorkflow extends WorkflowEntrypoint<JobsEnv, unknown> {
  async run(_event: WorkflowEvent<unknown>, step: WorkflowStep) {
    // A Worker with a D1 `DB` binding (staging until the cutover) purges D1 instead of Supabase.
    return step.do('purge guest lifecycle', policy('10 minutes'), () => {
      const d1 = boundD1Database(this.env)
      return purgeGuestLifecycleRetention(d1 ? { d1 } : serviceClient(this.env))
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
    useD1Binding(this.env)
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

const catalogTaskSchema = Schema.Struct({ task: Schema.Literals(['mark-past-events', 'reconcile-vectors']) })

/**
 * Manual run of a D1 catalog task, for staging and the cutover rehearsal:
 * `wrangler workflows trigger baeventos-catalog-task-staging '{"task":"mark-past-events"}' --config wrangler.jobs.staging.jsonc`.
 * Only the staging config binds it; without D1 the task reports that it skipped.
 */
export class CatalogTaskWorkflow extends WorkflowEntrypoint<JobsEnv, unknown> {
  async run(event: WorkflowEvent<unknown>, step: WorkflowStep) {
    const { task } = Schema.decodeUnknownSync(catalogTaskSchema)(event.payload ?? {})
    return step.do(task, { retries: { limit: 0, delay: '1 second', backoff: 'constant' }, timeout: '30 minutes' }, async () => JSON.parse(JSON.stringify(await runCatalogTask(task, this.env))))
  }
}

export default {
  // `/intake/*` answers only where the env binds DB (intake-api.ts); everything else stays a 404.
  fetch: (request: Request, env: JobsEnv) => handleIntakeRequest(request, env),
  scheduled: (controller: { cron: string; scheduledTime: number }, env: JobsEnv) => dispatchCron(controller, env, runCatalogTask),
}
