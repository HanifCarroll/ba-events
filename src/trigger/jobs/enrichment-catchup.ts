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
 */
import { schedules, metadata } from '@trigger.dev/sdk/v3'
import { createServiceRoleClient } from '../utils/db-client'
import {
  enrichEvents,
  type EnrichmentStats,
} from '@/features/import/core/event-enrichment'

/**
 * Get events needing enrichment (pending or failed status, have link).
 * Unlike getEventsNeedingEnrichment, this includes failed events for retry.
 */
async function getEventsForCatchup(
  client: ReturnType<typeof createServiceRoleClient>,
  limit: number
) {
  const { data, error } = await client
    .from('events')
    .select('id, name, link, source, categories, venue_id')
    .in('enrichment_status', ['pending', 'failed'])
    .not('link', 'is', null)
    .order('starts_at', { ascending: true })
    .limit(limit)

  if (error) {
    console.error('[enrichment-catchup] Failed to get events:', error)
    return []
  }

  return data || []
}

export const enrichmentCatchup = schedules.task({
  id: 'enrichment-catchup',
  // 10 AM Buenos Aires time (UTC-3), 4 hours after daily-scrape
  cron: {
    pattern: '0 10 * * *',
    timezone: 'America/Buenos_Aires',
  },
  // No maxDuration needed - Trigger.dev v3 has no timeouts
  // But set a reasonable limit for monitoring purposes
  maxDuration: 7200, // 2 hours
  run: async (payload): Promise<EnrichmentStats & { remainingCount: number }> => {
    console.log('[enrichment-catchup] Starting catchup enrichment')
    console.log(`[enrichment-catchup] Scheduled time: ${payload.timestamp}`)

    const client = createServiceRoleClient()

    // Process in batches of 200 per run
    // At ~1 second per event, this takes about 3-4 minutes
    const BATCH_SIZE = 200

    // Get events needing enrichment (pending or failed)
    const events = await getEventsForCatchup(client, BATCH_SIZE)

    if (events.length === 0) {
      console.log('[enrichment-catchup] No events need enrichment')
      metadata.set('progress', {
        current: 0,
        total: 0,
        enriched: 0,
        failed: 0,
        currentEvent: null,
      })
      return {
        total: 0,
        enriched: 0,
        skipped: 0,
        failed: 0,
        errors: [],
        remainingCount: 0,
      }
    }

    console.log(`[enrichment-catchup] Found ${events.length} events to enrich`)

    // Set initial metadata for frontend progress tracking
    metadata.set('progress', {
      current: 0,
      total: events.length,
      enriched: 0,
      failed: 0,
      currentEvent: events[0]?.name ?? null,
    })

    // Track stats for metadata updates
    let enrichedCount = 0
    let failedCount = 0

    // Process events with progress logging
    const stats = await enrichEvents(client, events, {
      delayMs: 1000, // 1 second between requests (rate limiting)
      onProgress: (current, total, result) => {
        // Update counts
        if (result.enriched) {
          enrichedCount++
        } else if (!result.success) {
          failedCount++
        }

        // Find current event name for display
        const currentEventName = events[current - 1]?.name ?? null

        // Update metadata for real-time frontend updates
        metadata.set('progress', {
          current,
          total,
          enriched: enrichedCount,
          failed: failedCount,
          currentEvent: currentEventName,
        })

        // Console logging (every 10 or at completion)
        if (current % 10 === 0 || current === total) {
          console.log(`[enrichment-catchup] Progress: ${current}/${total} (${enrichedCount} enriched, ${failedCount} failed)`)
        }
        if (!result.success) {
          console.warn(`[enrichment-catchup] Failed: ${result.eventId} - ${result.error}`)
        }
      },
    })

    // Check how many events still need enrichment
    const { count: remainingCount } = await client
      .from('events')
      .select('*', { count: 'exact', head: true })
      .in('enrichment_status', ['pending', 'failed'])
      .not('link', 'is', null)

    console.log(`[enrichment-catchup] Completed: ${stats.enriched} enriched, ${stats.failed} failed, ${remainingCount ?? 0} remaining`)

    return {
      ...stats,
      remainingCount: remainingCount ?? 0,
    }
  },
})
