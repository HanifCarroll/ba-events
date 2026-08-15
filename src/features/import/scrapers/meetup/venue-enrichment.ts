/**
 * Meetup Venue Enrichment
 *
 * Fetches venue information from Meetup event detail pages.
 * Used in Phase 2 enrichment after initial event import.
 *
 * Uses simple fetch + HTML parsing instead of Playwright for serverless compatibility.
 * JSON-LD structured data is embedded in the initial HTML response.
 */

import {
  findJsonLdByType,
  fetchHtml,
} from '#shared/lib/html-parsing.ts'
import { logger } from '#shared/lib/logger.ts'

export interface MeetupVenueInfo {
  name: string
  address: string | null
}

export interface EnrichmentEvent {
  id: string
  eventUrl: string
}

export interface EnrichmentResult {
  eventId: string
  venue: MeetupVenueInfo | null
  error?: string
}

/**
 * Extract venue from JSON-LD Event data
 */
function extractVenueFromJsonLd(html: string): MeetupVenueInfo | null {
  const eventData = findJsonLdByType(html, 'Event') as Record<string, unknown> | null
  if (!eventData?.location) return null

  const loc = eventData.location as Record<string, unknown>
  if (loc['@type'] !== 'Place' || !loc.name) return null

  const address = loc.address as Record<string, unknown> | string | undefined
  const resolvedAddress =
    typeof address === 'string'
      ? address
      : (address?.streetAddress as string) || (address?.name as string) || null

  return {
    name: loc.name as string,
    address: resolvedAddress,
  }
}

/**
 * Fetch venue info from a single Meetup event detail page
 * Uses simple fetch instead of Playwright - JSON-LD is in the initial HTML
 */
export async function fetchMeetupVenueFromUrl(
  eventUrl: string
): Promise<MeetupVenueInfo | null> {
  const html = await fetchHtml(eventUrl)
  if (!html) return null

  return extractVenueFromJsonLd(html)
}

/**
 * Batch fetch venues for multiple Meetup events
 *
 * Processes events with controlled concurrency to avoid rate limiting.
 * Uses fetch instead of Playwright for serverless compatibility.
 *
 * @param events - Array of events with id and eventUrl
 * @param concurrency - Number of requests to process in parallel (default: 3)
 * @param delayMs - Delay between batches in milliseconds (default: 1000)
 */
export async function enrichMeetupEventsWithVenues(
  events: EnrichmentEvent[],
  concurrency: number = 3,
  delayMs: number = 1000
): Promise<EnrichmentResult[]> {
  if (events.length === 0) {
    return []
  }

  const results: EnrichmentResult[] = []

  logger.info('[Meetup Enrichment] Starting enrichment', { count: events.length })

  // Process in batches
  for (let i = 0; i < events.length; i += concurrency) {
    const batch = events.slice(i, i + concurrency)

    // Process batch in parallel
    const batchResults = await Promise.all(
      batch.map(async (event) => {
        try {
          const venue = await fetchMeetupVenueFromUrl(event.eventUrl)
          if (venue) {
            logger.debug('[Meetup Enrichment] Found venue', { eventId: event.id, venue: venue.name })
          }
          return { eventId: event.id, venue }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error'
          logger.warn('[Meetup Enrichment] Error fetching venue', { eventId: event.id, error: errorMsg })
          return { eventId: event.id, venue: null, error: errorMsg }
        }
      })
    )

    results.push(...batchResults)

    // Delay between batches (except after last batch)
    if (i + concurrency < events.length) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }

    logger.debug('[Meetup Enrichment] Progress', { current: Math.min(i + concurrency, events.length), total: events.length })
  }

  logger.info('[Meetup Enrichment] Completed', { found: results.filter((r) => r.venue).length, total: events.length })
  return results
}
