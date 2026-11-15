/**
 * baeventos-jobs: the scheduled import, enrichment, and retention jobs.
 *
 * Each job is a Cloudflare Workflow started by a cron `schedules` entry on its
 * binding (UTC; Buenos Aires is UTC-3 all year). Every unit of work is a
 * `step.do` with Trigger.dev's old policy: 3 attempts with exponential backoff
 * from 1 second, and the old per-task time budget as the step timeout.
 */
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { BrowserWorker } from '@cloudflare/playwright'
import { Schema } from 'effect'
import { mapBatchRunsToResults, type BatchRunLike } from './daily-scrape-outcome.ts'
import { closeScrapeRun, openScrapeRun, timed } from './daily-scrape.ts'
import { catchupMaxBatches, countCatchupBacklog, dailyMaxBatches, runCatchupBatch, runDailyEnrichmentBatch } from './enrichment.ts'
import { purgeGuestLifecycleRetention } from './guest-lifecycle-retention.ts'
import { SOURCES } from './source-health.ts'
import { importSource, readSourceCatalog } from './sources.ts'

export interface JobsEnv {
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
  BROWSER: BrowserWorker
}

type Budget = '10 minutes' | '30 minutes' | '1 hour'
const policy = (timeout: Budget) => ({ retries: { limit: 2, delay: '1 second', backoff: 'exponential' as const }, timeout })
const SOURCE_BUDGET = { meetup: '30 minutes', 'ba-tourism': '10 minutes', luma: '1 hour' } as const

/** A fresh client per step: nothing request-scoped is cached across invocations. */
function serviceClient(env: JobsEnv): SupabaseClient {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 09:00 UTC (06:00 Buenos Aires): import every source, then drain the new events' enrichment. */
export class DailyScrapeWorkflow extends WorkflowEntrypoint<JobsEnv, unknown> {
  async run(event: WorkflowEvent<unknown>, step: WorkflowStep) {
    const scheduledTime = event.schedule ? new Date(event.schedule.scheduledTime).toISOString() : null
    const run = await step.do('open scrape run', policy('10 minutes'), () => openScrapeRun(serviceClient(this.env), event.instanceId, scheduledTime))

    const outcomes: BatchRunLike[] = []
    for (const source of SOURCES) {
      try {
        const output = await step.do(`import ${source.id}`, policy(SOURCE_BUDGET[source.id]), () =>
          timed(source.id, () => importSource(source.id, serviceClient(this.env), this.env.BROWSER, event.instanceId, run.id)))
        outcomes.push({ taskIdentifier: source.id, ok: true, output })
      } catch (error) {
        outcomes.push({ taskIdentifier: source.id, ok: false, error: message(error) })
      }
    }

    const results = mapBatchRunsToResults(outcomes, SOURCES)
    const eligible = await step.do('close scrape run', policy('10 minutes'), () => closeScrapeRun(serviceClient(this.env), run, outcomes, results))

    if (eligible > 0) {
      const maxBatches = dailyMaxBatches(eligible)
      let totals = { enrichedSoFar: 0, failedSoFar: 0 }
      for (let batchNumber = 1; batchNumber <= maxBatches; batchNumber++) {
        const batch = await step.do(`enrich batch ${batchNumber}`, policy('30 minutes'), () => runDailyEnrichmentBatch(serviceClient(this.env), {
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
    const pendingCount = await step.do('count backlog', policy('10 minutes'), () => countCatchupBacklog(serviceClient(this.env)))
    if (pendingCount === 0) return { pendingCount, batches: 0 }
    const maxBatches = catchupMaxBatches(pendingCount)
    let batchNumber = 1
    for (; batchNumber <= maxBatches; batchNumber++) {
      const batch = await step.do(`catch-up batch ${batchNumber}`, policy('1 hour'), () =>
        runCatchupBatch(serviceClient(this.env), event.instanceId, batchNumber, maxBatches))
      if (!batch.chainNext) break
    }
    return { pendingCount, batches: Math.min(batchNumber, maxBatches) }
  }
}

/** 10:00 UTC (07:00 Buenos Aires): delete guest lifecycle and transcript rows older than 30 days. */
export class GuestRetentionWorkflow extends WorkflowEntrypoint<JobsEnv, unknown> {
  async run(_event: WorkflowEvent<unknown>, step: WorkflowStep) {
    return step.do('purge guest lifecycle', policy('10 minutes'), () => purgeGuestLifecycleRetention(serviceClient(this.env)))
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

export default {
  fetch: () => new Response(null, { status: 404 }),
}
