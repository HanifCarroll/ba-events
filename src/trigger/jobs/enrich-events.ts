/**
 * Event Enrichment Job
 *
 * Enriches events that have pending enrichment status.
 * - Fetches event descriptions from source pages
 * - Generates bilingual descriptions
 * - Updates embeddings
 */
import { task, metadata } from '@trigger.dev/sdk/v3'
import { createServiceRoleClient } from '../utils/db-client'
import {
  enrichEvents,
  getEventsNeedingEnrichment,
  type EnrichmentStats,
} from '@/features/import/core/event-enrichment'

export interface EnrichEventsJobPayload {
  /** Limit events to enrich per run (default: 50) */
  limit?: number
  /** Source to filter events (optional) */
  source?: string
  /** Only enrich events created after this date (ISO string) */
  createdAfter?: string
}

export const enrichEventsJob = task({
  id: 'enrich-events',
  // Enrichment is slow (1 second per event + API calls)
  maxDuration: 1800, // 30 minutes
  run: async (payload: EnrichEventsJobPayload): Promise<EnrichmentStats> => {
    console.log('[enrich-events] Starting event enrichment job')

    const client = createServiceRoleClient()
    const limit = payload.limit ?? 50

    // Get events needing enrichment
    const events = await getEventsNeedingEnrichment(client, {
      source: payload.source,
      limit,
      createdAfter: payload.createdAfter,
    })

    if (events.length === 0) {
      console.log('[enrich-events] No events need enrichment')
      // Set metadata for empty case
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
      }
    }

    console.log(`[enrich-events] Found ${events.length} events to enrich`)

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

    // Process with progress logging and metadata updates
    const stats = await enrichEvents(client, events, {
      delayMs: 1000, // 1 second between requests
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
          console.log(`[enrich-events] Progress: ${current}/${total}`)
        }
        if (!result.success) {
          console.warn(`[enrich-events] Failed: ${result.eventId} - ${result.error}`)
        }
      },
    })

    console.log('[enrich-events] Job completed:', stats)
    return stats
  },
})
