/**
 * Luma Venue Enrichment
 *
 * Fetches venue information from individual Luma event pages.
 * Used for events that were imported without venue data.
 *
 * Uses simple fetch + HTML parsing instead of Playwright for serverless compatibility.
 * __NEXT_DATA__ and JSON-LD structured data are embedded in the initial HTML.
 */

import type {
  VenueEnrichProgress,
  VenueEnrichComplete,
} from '@/shared/lib/streaming-types'
import {
  extractNextData,
  getNestedValue,
  findJsonLdByType,
  fetchHtml,
} from '@/shared/lib/html-parsing'

export interface LumaVenueResult {
  eventId: string
  venue: {
    name: string
    address: string | null
    latitude: number | null
    longitude: number | null
  } | null
  error?: string
}

export interface VenueEnrichmentEvent {
  eventId: string
  eventUrl: string
  eventName?: string
}

/**
 * Extract venue from __NEXT_DATA__ script content
 */
function extractVenueFromNextData(
  nextData: unknown
): LumaVenueResult['venue'] | null {
  // Navigate to event data in Next.js props
  const event = getNestedValue(nextData, 'props.pageProps.initialData.event') as
    | Record<string, unknown>
    | undefined

  if (!event) return null

  // Try geo_address_json first
  const geoJson = event.geo_address_json as Record<string, unknown> | undefined
  if (geoJson) {
    const name = (geoJson.place_name || geoJson.name) as string | undefined
    if (name) {
      return {
        name,
        address: (geoJson.full_address || geoJson.address) as string | null ?? null,
        latitude: (geoJson.latitude as number) ?? null,
        longitude: (geoJson.longitude as number) ?? null,
      }
    }
  }

  // Try venue object
  const venue = event.venue as Record<string, unknown> | undefined
  if (venue) {
    const name = (venue.name || venue.place_name) as string | undefined
    if (name) {
      return {
        name,
        address: (venue.full_address || venue.address) as string | null ?? null,
        latitude: (venue.latitude as number) ?? null,
        longitude: (venue.longitude as number) ?? null,
      }
    }
  }

  // Try location field
  const location = event.location as Record<string, unknown> | undefined
  if (location) {
    const name = (location.name || location.place_name) as string | undefined
    if (name) {
      return {
        name,
        address: (location.full_address || location.address) as string | null ?? null,
        latitude: (location.latitude as number) ?? null,
        longitude: (location.longitude as number) ?? null,
      }
    }
  }

  return null
}

/**
 * Extract venue from JSON-LD structured data
 */
function extractVenueFromJsonLd(html: string): LumaVenueResult['venue'] | null {
  const eventData = findJsonLdByType(html, 'Event') as Record<string, unknown> | null
  if (!eventData?.location) return null

  const loc = eventData.location as Record<string, unknown>
  if (loc['@type'] !== 'Place' || !loc.name) return null

  const geo = loc.geo as Record<string, unknown> | undefined
  const address = loc.address as Record<string, unknown> | string | undefined

  return {
    name: loc.name as string,
    address:
      typeof address === 'string'
        ? address
        : (address?.streetAddress as string) || null,
    latitude: (geo?.latitude as number) ?? null,
    longitude: (geo?.longitude as number) ?? null,
  }
}

/**
 * Extract venue data from HTML content
 * Tries __NEXT_DATA__ first (most reliable), then falls back to JSON-LD
 */
function extractVenueFromHtml(html: string): LumaVenueResult['venue'] | null {
  // Method 1: __NEXT_DATA__ embedded data (most reliable)
  const nextData = extractNextData(html)
  if (nextData) {
    const venue = extractVenueFromNextData(nextData)
    if (venue) return venue
  }

  // Method 2: JSON-LD Schema.org structured data
  return extractVenueFromJsonLd(html)
}

/**
 * Fetch venue from a single Luma event detail page
 * Uses simple fetch instead of Playwright - __NEXT_DATA__ is in the initial HTML
 */
export async function fetchLumaVenueFromUrl(
  eventUrl: string
): Promise<LumaVenueResult['venue']> {
  // Ensure URL is properly formed
  let fullUrl = eventUrl
  if (!fullUrl.startsWith('http')) {
    fullUrl = `https://lu.ma${fullUrl.startsWith('/') ? '' : '/'}${fullUrl}`
  }

  const html = await fetchHtml(fullUrl)
  if (!html) return null

  return extractVenueFromHtml(html)
}

/**
 * Batch fetch venues for multiple Luma events with streaming progress
 *
 * Processes events with controlled concurrency to avoid rate limiting.
 * Uses fetch instead of Playwright for serverless compatibility.
 *
 * @param events - Array of events with eventId and eventUrl
 * @param concurrency - Number of requests to process in parallel (default: 3)
 * @param delayMs - Delay between batches in milliseconds (default: 1000)
 */
export async function* enrichLumaEventsWithVenues(
  events: VenueEnrichmentEvent[],
  concurrency: number = 3,
  delayMs: number = 1000
): AsyncGenerator<VenueEnrichProgress | VenueEnrichComplete> {
  if (events.length === 0) {
    yield {
      type: 'complete',
      enriched: 0,
      venuesCreated: 0,
      total: 0,
      errors: [],
    }
    return
  }

  const results: LumaVenueResult[] = []
  const errors: Array<{ id: string; error: string }> = []
  let enriched = 0

  console.log(
    `[Luma Venue Enrichment] Starting venue enrichment for ${events.length} events...`
  )

  // Process in batches
  for (let i = 0; i < events.length; i += concurrency) {
    const batch = events.slice(i, i + concurrency)

    // Process batch in parallel
    const batchResults = await Promise.all(
      batch.map(async (event) => {
        try {
          const venue = await fetchLumaVenueFromUrl(event.eventUrl)
          if (venue) {
            console.log(
              `[Luma Venue Enrichment] Found venue "${venue.name}" for ${event.eventName || event.eventId}`
            )
          }
          return {
            eventId: event.eventId,
            eventName: event.eventName,
            venue,
            success: !!venue,
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error'
          console.log(
            `[Luma Venue Enrichment] Error for ${event.eventName || event.eventId}: ${errorMsg}`
          )
          return {
            eventId: event.eventId,
            eventName: event.eventName,
            venue: null,
            error: errorMsg,
            success: false,
          }
        }
      })
    )

    // Track results and errors
    for (const result of batchResults) {
      results.push({
        eventId: result.eventId,
        venue: result.venue,
        error: result.error,
      })

      if (result.error) {
        errors.push({ id: result.eventId, error: result.error })
      }

      if (result.venue) {
        enriched++
      }

      // Yield progress for each event
      yield {
        type: 'progress',
        current: results.length,
        total: events.length,
        eventName: result.eventName || result.eventId,
        action: result.venue ? 'extracted' : 'error',
        venueName: result.venue?.name,
        venue: result.venue,
      } as VenueEnrichProgress & { venue?: LumaVenueResult['venue'] }
    }

    // Delay between batches (except after last batch)
    if (i + concurrency < events.length) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }

    console.log(
      `[Luma Venue Enrichment] Progress: ${Math.min(i + concurrency, events.length)}/${events.length}`
    )
  }

  // Final completion message
  yield {
    type: 'complete',
    enriched,
    venuesCreated: 0, // Will be updated by server action
    total: events.length,
    errors,
  }

  console.log(
    `[Luma Venue Enrichment] Completed. Found venues for ${enriched}/${events.length} events`
  )
}
