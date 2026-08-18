/**
 * Daily Scrape Outcome Mapping + Finalization
 *
 * Pure helpers for mapping batch trigger-and-wait results to per-source
 * outcomes, aggregating stats, and reliably finalizing the `scrape_runs` row.
 * Kept free of Trigger.dev SDK imports so they can be unit-tested in isolation.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export interface DailyScrapeResult {
  scrapeRunId: string
  startedAt: string
  completedAt: string
  results: {
    source: string
    success: boolean
    eventsInserted: number
    eventsUpdated: number
    eventsSkipped: number
    venuesAutoCreated: number
    error?: string
  }[]
  enrichmentTriggered: boolean
  enrichmentEligible: number
  blocklistCleanup: number
}

/**
 * Counts recorded against a daily run's enrichment chain. `eligible` is known
 * synchronously at trigger time (the parent writes it); `enriched`/`failed`/
 * `remaining` are written back by the final batch of the async chain.
 */
export interface EnrichmentAudit {
  eligible: number
  enriched: number
  failed: number
  remaining: number
}

/**
 * Merge a partial enrichment audit patch into any existing enrichment metadata
 * object, so the async chain's final write preserves the `eligible` the parent
 * already recorded (and vice versa).
 */
export function mergeEnrichmentMetadata(
  existing: unknown,
  patch: Partial<EnrichmentAudit>
): EnrichmentAudit {
  const base =
    existing && typeof existing === 'object' && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {}
  return { ...base, ...patch } as EnrichmentAudit
}

/**
 * Whether an enrichment chain should trigger its next batch. Sequential:
 * the next batch is only triggered after the current one fully completes,
 * so batches never overlap and never double-process the same events.
 */
export function shouldChainNextBatch(
  remainingCount: number,
  batchNumber: number,
  maxBatches: number
): boolean {
  return remainingCount > 0 && batchNumber < maxBatches
}

export type ScrapeRunStatus = 'completed' | 'partial' | 'failed'

function getUnknownMessage(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.message
  if (typeof value !== 'object') return String(value)

  const record = value as Record<string, unknown>
  if (typeof record.message === 'string') return record.message
  if (typeof record.error === 'string') return record.error
  if (typeof record.reason === 'string') return record.reason

  if (record.error && typeof record.error === 'object') {
    const nestedMessage = getUnknownMessage(record.error)
    if (nestedMessage) return nestedMessage
  }

  return null
}

export interface BatchRunLike {
  taskIdentifier: string
  ok: boolean
  output?: unknown
  error?: unknown
}

interface ScrapeStatsOutput {
  eventsInserted?: number
  eventsUpdated?: number
  eventsSkipped?: number
  venuesAutoCreated?: number
}

/**
 * Map batch trigger-and-wait runs to per-source results, keyed by
 * `taskIdentifier`. A missing run or an `ok: false` run becomes a failed
 * source entry (so all-failed detection and error reporting stay intact).
 */
export function mapBatchRunsToResults(
  runs: BatchRunLike[],
  sourceJobs: readonly { id: string; name: string }[]
): DailyScrapeResult['results'] {
  const byIdentifier = new Map(runs.map((run) => [run.taskIdentifier, run]))

  return sourceJobs.map((source) => {
    const run = byIdentifier.get(source.id)

    if (!run) {
      return {
        source: source.name,
        success: false,
        eventsInserted: 0,
        eventsUpdated: 0,
        eventsSkipped: 0,
        venuesAutoCreated: 0,
        error: 'No run produced',
      }
    }

    if (run.ok) {
      const output = (run.output ?? {}) as ScrapeStatsOutput
      return {
        source: source.name,
        success: true,
        eventsInserted: output.eventsInserted ?? 0,
        eventsUpdated: output.eventsUpdated ?? 0,
        eventsSkipped: output.eventsSkipped ?? 0,
        venuesAutoCreated: output.venuesAutoCreated ?? 0,
      }
    }

    return {
      source: source.name,
      success: false,
      eventsInserted: 0,
      eventsUpdated: 0,
      eventsSkipped: 0,
      venuesAutoCreated: 0,
      error: getUnknownMessage(run.error) ?? 'Failed without error details',
    }
  })
}

/**
 * Aggregate stats across source results.
 */
export function summarizeResults(results: DailyScrapeResult['results']): {
  inserted: number
  updated: number
  skipped: number
  venuesCreated: number
} {
  return results.reduce(
    (acc, result) => ({
      inserted: acc.inserted + result.eventsInserted,
      updated: acc.updated + result.eventsUpdated,
      skipped: acc.skipped + result.eventsSkipped,
      venuesCreated: acc.venuesCreated + result.venuesAutoCreated,
    }),
    { inserted: 0, updated: 0, skipped: 0, venuesCreated: 0 }
  )
}

/**
 * Outcome mapping: completed when every source succeeded, failed when every
 * source failed, partial otherwise (some succeeded, some failed).
 */
export function determineScrapeRunStatus(
  results: DailyScrapeResult['results']
): ScrapeRunStatus {
  if (results.length === 0) return 'failed'
  const successes = results.filter((result) => result.success).length
  if (successes === results.length) return 'completed'
  if (successes === 0) return 'failed'
  return 'partial'
}

function buildScrapeRunErrorMessage(results: DailyScrapeResult['results']): string | null {
  const failed = results.filter((result) => !result.success)
  if (failed.length === 0) return null

  return failed
    .map((result) => `${result.source}: ${result.error ?? 'Unknown failure'}`)
    .join('; ')
}

/**
 * Finalize the scrape_runs row with the correct status and completed_at.
 * Throws when the DB update returns or rejects an error, so the parent cannot
 * report success on a run whose finalization failed.
 */
export async function finalizeScrapeRun(
  client: SupabaseClient,
  scrapeRunId: string,
  metadata: unknown,
  results: DailyScrapeResult['results'],
  enrichmentTriggered: boolean,
  blocklistCleanup: number,
  enrichmentEligible: number
): Promise<void> {
  const totals = summarizeResults(results)
  const status = determineScrapeRunStatus(results)
  const errorMessage = buildScrapeRunErrorMessage(results)
  const completedAt = new Date().toISOString()

  const { error: updateError } = await client
    .from('scrape_runs')
    .update({
      status,
      completed_at: completedAt,
      error_message: errorMessage,
      events_fetched: totals.inserted + totals.updated + totals.skipped,
      events_inserted: totals.inserted,
      events_updated: totals.updated,
      events_skipped: totals.skipped,
      venues_auto_created: totals.venuesCreated,
      metadata: {
        ...((metadata as object | null) ?? {}),
        results,
        enrichmentTriggered,
        blocklistCleanup,
        enrichment: mergeEnrichmentMetadata(undefined, { eligible: enrichmentEligible }),
      },
    })
    .eq('id', scrapeRunId)

  if (updateError) {
    throw new Error(`Failed to finalize scrape run: ${updateError.message}`)
  }
}

/**
 * Write enrichment chain results back to the daily run's audit row. Merges the
 * patch into the existing `metadata.enrichment` (so the parent's `eligible` is
 * preserved) and updates the dedicated `enrichments_completed`/
 * `enrichments_failed` columns. Best-effort: logs instead of throwing so a
 * failed audit write never marks the enrichment chain as failed.
 */
export async function recordEnrichmentAudit(
  client: SupabaseClient,
  scrapeRunId: string,
  patch: Partial<EnrichmentAudit>
): Promise<void> {
  const { data: current, error: readError } = await client
    .from('scrape_runs')
    .select('metadata')
    .eq('id', scrapeRunId)
    .maybeSingle()

  if (readError) {
    console.error('[enrichment-audit] Failed to read scrape run metadata:', readError)
    return
  }

  const existingMetadata = (current?.metadata as Record<string, unknown> | null) ?? {}
  const enrichment = mergeEnrichmentMetadata(existingMetadata.enrichment, patch)

  const update: Record<string, unknown> = {
    metadata: { ...existingMetadata, enrichment },
  }
  if (patch.enriched !== undefined) update.enrichments_completed = patch.enriched
  if (patch.failed !== undefined) update.enrichments_failed = patch.failed

  const { error: updateError } = await client
    .from('scrape_runs')
    .update(update)
    .eq('id', scrapeRunId)

  if (updateError) {
    console.error('[enrichment-audit] Failed to write enrichment audit:', updateError)
  }
}
