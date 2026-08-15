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
 */
import { schedules, task, tasks, metadata } from '@trigger.dev/sdk/v3'
import { createServiceRoleClient } from '../utils/db-client.ts'
import {
  enrichEvents,
  enrichmentStartsAtFloor,
  type EnrichmentStats,
} from '#features/import/core/event-enrichment.ts'

// Smaller batch size - each event takes 15-30 seconds due to API calls
const BATCH_SIZE = 50

/**
 * Get events needing enrichment (pending or failed status, have link).
 */
async function getEventsForCatchup(
  client: ReturnType<typeof createServiceRoleClient>,
  limit: number
) {
  const { data, error } = await client
    .from('events')
    .select('id, name, link, source, categories, venue_id')
    .in('enrichment_status', ['pending', 'failed'])
    .neq('status', 'canceled')
    .neq('status', 'past')
    .gte('starts_at', enrichmentStartsAtFloor())
    .not('link', 'is', null)
    .order('starts_at', { ascending: true })
    .limit(limit)

  if (error) {
    console.error('[enrichment-catchup] Failed to get events:', error)
    return []
  }

  return data || []
}

/**
 * Get count of events needing enrichment.
 */
async function getPendingCount(client: ReturnType<typeof createServiceRoleClient>) {
  const { count } = await client
    .from('events')
    .select('*', { count: 'exact', head: true })
    .in('enrichment_status', ['pending', 'failed'])
    .neq('status', 'canceled')
    .neq('status', 'past')
    .gte('starts_at', enrichmentStartsAtFloor())
    .not('link', 'is', null)

  return count ?? 0
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
    const events = await getEventsForCatchup(client, BATCH_SIZE)

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
    const stats = await enrichEvents(client, events, {
      delayMs: 1000,
      onProgress: (current, total, result) => {
        if (result.canceled) {
          canceledCount++
        } else if (result.enriched) {
          enrichedCount++
        } else if (!result.success) {
          failedCount++
        }

        const currentEventName = events[current - 1]?.name ?? null

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
    })

    // Check remaining count
    const remainingCount = await getPendingCount(client)

    console.log(`[enrichment-batch] Batch #${batchNumber} completed: ${stats.enriched} enriched, ${stats.failed} failed, ${stats.canceled} canceled, ${remainingCount} remaining`)

    // Chain to next batch if there are more events and we haven't hit max batches
    let chainedNextBatch = false
    if (remainingCount > 0 && batchNumber < maxBatches) {
      console.log(`[enrichment-batch] Triggering batch #${batchNumber + 1}`)
      await tasks.trigger<typeof enrichmentBatch>('enrichment-batch', {
        batchNumber: batchNumber + 1,
        maxBatches,
      })
      chainedNextBatch = true
    } else if (remainingCount > 0) {
      console.log(`[enrichment-batch] Reached max batches (${maxBatches}), ${remainingCount} events remaining for next run`)
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
    const pendingCount = await getPendingCount(client)

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
