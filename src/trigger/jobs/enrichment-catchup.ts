/**
 * Enrichment Catchup Job
 *
 * Runs daily at 10 AM Buenos Aires time (4 hours after daily-scrape).
 * Processes events that need enrichment but were missed by the daily scrape job:
 * - Events with enrichment_status = 'pending' (never enriched)
 * - Events with enrichment_status = 'failed' (previously failed, retry)
 *
 * This handles the backlog of events that weren't enriched during import,
 * including events that failed enrichment due to temporary errors.
 *
 * Architecture:
 * - enrichmentCatchup (scheduled) triggers enrichmentBatch
 * - enrichmentBatch processes 50 events, then chains to itself if more remain
 * - The first batch retries failed rows; later batches only process pending rows
 *   so a failed row is attempted at most once in a scheduled chain.
 */
import { schedules, task, tasks, metadata } from '@trigger.dev/sdk/v3'
import { Effect } from 'effect'
import { createServiceRoleClient } from '../utils/db-client.ts'
import {
  enrichEventsEffect,
  getEventsNeedingEnrichmentEffect,
  countEventsNeedingEnrichmentEffect,
  type EnrichmentStats,
} from '#features/import/core/event-enrichment.ts'

// Smaller batch size - each event takes 15-30 seconds due to API calls
const BATCH_SIZE = 50

export function catchupStatusesForBatch(batchNumber: number): Array<'pending' | 'failed'> {
  return batchNumber === 1 ? ['pending', 'failed'] : ['pending']
}

export function shouldChainCatchupBatch(
  pendingRemaining: number,
  batchNumber: number,
  maxBatches: number
): boolean {
  return pendingRemaining > 0 && batchNumber < maxBatches
}

/**
 * Get events needing enrichment (pending or failed status, have link).
 */
function getEventsForCatchupEffect(
  client: ReturnType<typeof createServiceRoleClient>,
  limit: number,
  statuses: Array<'pending' | 'failed'> = catchupStatusesForBatch(1)
) {
  return getEventsNeedingEnrichmentEffect(client, { limit, statuses })
}

/**
 * Get count of events needing enrichment.
 */
function getPendingCountEffect(
  client: ReturnType<typeof createServiceRoleClient>,
  statuses: Array<'pending' | 'failed'> = ['pending', 'failed']
) {
  return countEventsNeedingEnrichmentEffect(client, { statuses })
}

export interface EnrichmentBatchPayload {
  /** Which batch number this is (for logging) */
  batchNumber: number
  /** Maximum batches to process in this chain (prevents runaway) */
  maxBatches?: number
}

export interface EnrichmentBatchResult extends EnrichmentStats {
  batchNumber: number
  remainingCount: number
  chainedNextBatch: boolean
}

/**
 * Process a single batch of events and chain to next batch if needed.
 */
export const enrichmentBatch = task({
  id: 'enrichment-batch',
  maxDuration: 3600, // 1 hour per batch (should take ~25 min for 50 events)
  run: async (payload: EnrichmentBatchPayload): Promise<EnrichmentBatchResult> => {
    const { batchNumber, maxBatches = 10 } = payload

    console.log(`[enrichment-batch] Starting batch #${batchNumber}`)

    const client = createServiceRoleClient()

    // Get events needing enrichment
    const events = await Effect.runPromise(Effect.catchEager(getEventsForCatchupEffect(
      client,
      BATCH_SIZE,
      catchupStatusesForBatch(batchNumber)
    ), (error) => {
      console.error('[enrichment-catchup] Failed to get events:', error)
      return Effect.succeed([])
    }))

    if (events.length === 0) {
      console.log('[enrichment-batch] No events need enrichment')
      return {
        batchNumber,
        total: 0,
        enriched: 0,
        skipped: 0,
        failed: 0,
        canceled: 0,
        errors: [],
        remainingCount: 0,
        chainedNextBatch: false,
      }
    }

    console.log(`[enrichment-batch] Found ${events.length} events to enrich`)

    // Set initial metadata
    metadata.set('progress', {
      batchNumber,
      current: 0,
      total: events.length,
      enriched: 0,
      failed: 0,
      canceled: 0,
      currentEvent: events[0]?.name ?? null,
    })

    // Track stats
    let enrichedCount = 0
    let failedCount = 0
    let canceledCount = 0

    // Process events
    const stats = await Effect.runPromise(enrichEventsEffect(client, events, {
      concurrency: 4,
      delayMs: 0,
      onProgress: (current, total, result) => {
        if (result.canceled) {
          canceledCount++
        } else if (result.enriched) {
          enrichedCount++
        } else if (!result.success) {
          failedCount++
        }

        const currentEventName = events.find((event) => event.id === result.eventId)?.name ?? null

        metadata.set('progress', {
          batchNumber,
          current,
          total,
          enriched: enrichedCount,
          failed: failedCount,
          canceled: canceledCount,
          currentEvent: currentEventName,
        })

        if (current % 10 === 0 || current === total) {
          console.log(`[enrichment-batch] Batch #${batchNumber} progress: ${current}/${total} (${canceledCount} canceled)`)
        }
        if (result.canceled) {
          console.log(`[enrichment-batch] Event page gone, marked as canceled: ${result.eventId}`)
        } else if (!result.success) {
          console.warn(`[enrichment-batch] Failed: ${result.eventId} - ${result.error}`)
        }
      },
    }))

    // Failed rows stay retryable for the next scheduled run, but must not keep
    // this chain alive after their one attempt in the first batch.
    const pendingRemaining = await Effect.runPromise(Effect.catchEager(
      getPendingCountEffect(client, ['pending']),
      () => Effect.succeed(0)
    ))
    const remainingCount = await Effect.runPromise(Effect.catchEager(
      getPendingCountEffect(client),
      () => Effect.succeed(0)
    ))

    console.log(`[enrichment-batch] Batch #${batchNumber} completed: ${stats.enriched} enriched, ${stats.failed} failed, ${stats.canceled} canceled, ${pendingRemaining} pending, ${remainingCount} remaining`)

    // Chain to next batch if there are more events and we haven't hit max batches
    let chainedNextBatch = false
    if (shouldChainCatchupBatch(pendingRemaining, batchNumber, maxBatches)) {
      console.log(`[enrichment-batch] Triggering batch #${batchNumber + 1}`)
      await tasks.trigger<typeof enrichmentBatch>('enrichment-batch', {
        batchNumber: batchNumber + 1,
        maxBatches,
      })
      chainedNextBatch = true
    } else if (pendingRemaining > 0) {
      console.log(`[enrichment-batch] Reached max batches (${maxBatches}), ${pendingRemaining} pending events remaining for next run`)
    }

    return {
      ...stats,
      batchNumber,
      remainingCount,
      chainedNextBatch,
    }
  },
})

/**
 * Scheduled task that kicks off the catchup process.
 */
export const enrichmentCatchup = schedules.task({
  id: 'enrichment-catchup',
  // 10 AM Buenos Aires time (UTC-3), 4 hours after daily-scrape
  cron: {
    pattern: '0 10 * * *',
    timezone: 'America/Buenos_Aires',
  },
  run: async (payload) => {
    console.log('[enrichment-catchup] Starting scheduled catchup')
    console.log(`[enrichment-catchup] Scheduled time: ${payload.timestamp}`)

    const client = createServiceRoleClient()
    const pendingCount = await Effect.runPromise(Effect.catchEager(
      getPendingCountEffect(client),
      () => Effect.succeed(0)
    ))

    if (pendingCount === 0) {
      console.log('[enrichment-catchup] No events need enrichment')
      return {
        triggered: false,
        pendingCount: 0,
      }
    }

    console.log(`[enrichment-catchup] Found ${pendingCount} events needing enrichment, triggering batch processing`)

    // Trigger the first batch
    // Allow up to 20 batches (1000 events) per scheduled run
    await tasks.trigger<typeof enrichmentBatch>('enrichment-batch', {
      batchNumber: 1,
      maxBatches: 20,
    })

    return {
      triggered: true,
      pendingCount,
    }
  },
})
