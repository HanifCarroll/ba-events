/**
 * Enrichment batches.
 *
 * Daily chain: after the 06:00 scrape, `runDailyEnrichmentBatch` drains the
 * PENDING events that run created, 100 per batch. Each batch is its own
 * Workflow step and the next one starts only after it finishes, so batches never
 * overlap. A row that fails is marked `failed`, leaves the pending set, and
 * waits for the catch-up; the final batch writes the audit counts back to the
 * day's `scrape_runs` row.
 *
 * Catch-up (10:00 Buenos Aires): `runCatchupBatch` processes 50 events per
 * batch. The first batch retries failed rows; later batches only process
 * pending rows, so a failed row is attempted at most once per scheduled chain.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { Effect } from 'effect'
import { withAcquisitionRun } from '#features/import/acquisition/run.ts'
import {
  enrichEventsEffect,
  getEventsNeedingEnrichmentEffect,
  countEventsNeedingEnrichmentEffect,
  type EnrichmentStats,
  type EventEnrichmentResult,
} from '#features/import/core/event-enrichment.ts'
import { recordEnrichmentAudit, shouldChainNextBatch } from './daily-scrape-outcome.ts'

export const DAILY_BATCH_SIZE = 100
export const DAILY_MAX_BATCHES = 10 // 1000-event safety ceiling
export const CATCHUP_BATCH_SIZE = 50

export function catchupStatusesForBatch(batchNumber: number): Array<'pending' | 'failed'> {
  return batchNumber === 1 ? ['pending', 'failed'] : ['pending']
}

export function shouldChainCatchupBatch(pendingRemaining: number, batchNumber: number, maxBatches: number): boolean {
  return pendingRemaining > 0 && batchNumber < maxBatches
}

export function catchupMaxBatches(pendingCount: number): number {
  return Math.max(20, Math.ceil(pendingCount / CATCHUP_BATCH_SIZE) + 1)
}

export function dailyMaxBatches(eligible: number): number {
  return Math.max(DAILY_MAX_BATCHES, Math.ceil(eligible / DAILY_BATCH_SIZE) + 1)
}

type BatchStats = Omit<EnrichmentStats, 'errors'> & { errors: number }

function count(client: SupabaseClient, options: Parameters<typeof countEventsNeedingEnrichmentEffect>[1]): Promise<number> {
  return Effect.runPromise(Effect.catchEager(countEventsNeedingEnrichmentEffect(client, options), () => Effect.succeed(0)))
}

function logProgress(label: string, batchNumber: number) {
  return (current: number, total: number, result: EventEnrichmentResult) => {
    if (current % 10 === 0 || current === total) console.log(`[${label}] Batch ${batchNumber} progress: ${current}/${total}`)
    if (result.canceled) console.log(`[${label}] Event page gone, marked as canceled: ${result.eventId}`)
    else if (!result.success) console.warn(`[${label}] Failed: ${result.eventId} - ${result.error}`)
  }
}

/** Enrich one bounded batch. Error details stay in the logs; step output keeps counts only. */
async function enrichBatch(
  client: SupabaseClient,
  acquisitionId: string,
  label: string,
  batchNumber: number,
  query: Parameters<typeof getEventsNeedingEnrichmentEffect>[1]
): Promise<BatchStats> {
  return withAcquisitionRun(acquisitionId, async () => {
    const events = await Effect.runPromise(Effect.catchEager(getEventsNeedingEnrichmentEffect(client, query), (error) => {
      console.error(`[${label}] Failed to get events:`, error)
      return Effect.succeed([])
    }))
    if (events.length === 0) return { total: 0, enriched: 0, skipped: 0, failed: 0, canceled: 0, errors: 0 }
    console.log(`[${label}] Found ${events.length} events to enrich (batch ${batchNumber})`)
    const stats = await Effect.runPromise(enrichEventsEffect(client, events, { concurrency: 4, delayMs: 0, onProgress: logProgress(label, batchNumber) }))
    return { ...stats, errors: stats.errors.length }
  })
}

export interface DailyBatchInput {
  runId: string
  scrapeRunId: string
  createdAfter: string
  eligible: number
  batchNumber: number
  maxBatches: number
  enrichedSoFar: number
  failedSoFar: number
}

export interface DailyBatchResult extends BatchStats {
  enrichedSoFar: number
  failedSoFar: number
  pendingRemaining: number
  chainNext: boolean
}

export async function runDailyEnrichmentBatch(client: SupabaseClient, input: DailyBatchInput): Promise<DailyBatchResult> {
  const stats = await enrichBatch(client, `${input.runId}:enrich:${input.batchNumber}`, 'enrich-events', input.batchNumber, {
    limit: DAILY_BATCH_SIZE, createdAfter: input.createdAfter, statuses: ['pending'],
  })
  // Failed rows are no longer pending, so an attempted row never keeps the chain alive.
  const pendingRemaining = stats.total === 0 ? 0 : await count(client, { createdAfter: input.createdAfter, statuses: ['pending'] })
  const enrichedSoFar = input.enrichedSoFar + stats.enriched
  const failedSoFar = input.failedSoFar + stats.failed
  const chainNext = shouldChainNextBatch(pendingRemaining, input.batchNumber, input.maxBatches)
  if (!chainNext) {
    // Final batch: failures plus any rows left at the ceiling go to the catch-up.
    const remaining = await count(client, { createdAfter: input.createdAfter })
    await recordEnrichmentAudit(client, input.scrapeRunId, { eligible: input.eligible, enriched: enrichedSoFar, failed: failedSoFar, remaining })
  }
  console.log(`[enrich-events] Batch ${input.batchNumber} completed:`, { eligible: input.eligible, enriched: enrichedSoFar, failed: failedSoFar, pendingRemaining, chainNext })
  return { ...stats, enrichedSoFar, failedSoFar, pendingRemaining, chainNext }
}

export interface CatchupBatchResult extends BatchStats {
  pendingRemaining: number
  remainingCount: number
  chainNext: boolean
}

export async function countCatchupBacklog(client: SupabaseClient): Promise<number> {
  return count(client, { statuses: ['pending', 'failed'] })
}

export async function runCatchupBatch(client: SupabaseClient, runId: string, batchNumber: number, maxBatches: number): Promise<CatchupBatchResult> {
  const stats = await enrichBatch(client, `${runId}:catchup:${batchNumber}`, 'enrichment-batch', batchNumber, {
    limit: CATCHUP_BATCH_SIZE, statuses: catchupStatusesForBatch(batchNumber),
  })
  if (stats.total === 0) return { ...stats, pendingRemaining: 0, remainingCount: 0, chainNext: false }
  const pendingRemaining = await count(client, { statuses: ['pending'] })
  const remainingCount = await count(client, { statuses: ['pending', 'failed'] })
  const chainNext = shouldChainCatchupBatch(pendingRemaining, batchNumber, maxBatches)
  console.log(`[enrichment-batch] Batch #${batchNumber} completed: ${stats.enriched} enriched, ${stats.failed} failed, ${stats.canceled} canceled, ${pendingRemaining} pending, ${remainingCount} remaining`)
  if (!chainNext && pendingRemaining > 0) console.log(`[enrichment-batch] Reached max batches (${maxBatches}), ${pendingRemaining} pending events remaining for next run`)
  return { ...stats, pendingRemaining, remainingCount, chainNext }
}
