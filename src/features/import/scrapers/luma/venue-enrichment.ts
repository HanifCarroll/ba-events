/**
 * Luma Venue Enrichment
 *
 * Fetches venue information from individual Luma event pages.
 * Used for events that were imported without venue data.
 *
 * Uses simple fetch + HTML parsing instead of Playwright for serverless compatibility.
 * __NEXT_DATA__ and JSON-LD structured data are embedded in the initial HTML.
 */

import type { VenueEnrichProgress, VenueEnrichComplete } from '@/shared/lib/streaming-types'

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
  nextDataContent: string
): LumaVenueResult['venue'] | null {
  try {
    const data = JSON.parse(nextDataContent)
    // Navigate to event data in Next.js props
    const event = data?.props?.pageProps?.initialData?.event

    // Try geo_address_json first
    if (event?.geo_address_json) {
      const geo = event.geo_address_json
      const name = geo.place_name || geo.name || null
      if (name) {
        return {
          name,
          address: geo.full_address || geo.address || null,
          latitude: geo.latitude ?? null,
          longitude: geo.longitude ?? null,
        }
      }
    }

    // Try venue object
    if (event?.venue) {
      const venue = event.venue
      const name = venue.name || venue.place_name || null
      if (name) {
        return {
          name,
          address: venue.full_address || venue.address || null,
          latitude: venue.latitude ?? null,
          longitude: venue.longitude ?? null,
        }
      }
    }

    // Try location field
    if (event?.location) {
      const loc = event.location
      const name = loc.name || loc.place_name || null
      if (name) {
        return {
          name,
          address: loc.full_address || loc.address || null,
          latitude: loc.latitude ?? null,
          longitude: loc.longitude ?? null,
        }
      }
    }
  } catch {
    // Not valid JSON
  }

  return null
}

/**
 * Extract venue from JSON-LD structured data
 */
function extractVenueFromJsonLd(html: string): LumaVenueResult['venue'] | null {
  const jsonLdPattern =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let match

  while ((match = jsonLdPattern.exec(html)) !== null) {
    try {
      const jsonContent = match[1].trim()
      const data = JSON.parse(jsonContent)

      if (data['@type'] === 'Event' && data.location) {
        const loc = data.location
        // Can be a Place or PostalAddress
        if (loc['@type'] === 'Place' && loc.name) {
          return {
            name: loc.name,
            address: loc.address?.streetAddress || loc.address || null,
            latitude: loc.geo?.latitude ?? null,
            longitude: loc.geo?.longitude ?? null,
          }
        }
      }
    } catch {
      // Not valid JSON, continue
    }
  }

  return null
}

/**
 * Extract venue data from HTML content
 * Tries __NEXT_DATA__ first (most reliable), then falls back to JSON-LD
 */
function extractVenueFromHtml(html: string): LumaVenueResult['venue'] | null {
  // Method 1: __NEXT_DATA__ embedded data (most reliable)
  const nextDataMatch = html.match(
    /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i
  )
  if (nextDataMatch) {
    const venue = extractVenueFromNextData(nextDataMatch[1])
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
  try {
    // Ensure URL is properly formed
    let fullUrl = eventUrl
    if (!fullUrl.startsWith('http')) {
      fullUrl = `https://lu.ma${fullUrl.startsWith('/') ? '' : '/'}${fullUrl}`
    }

    const response = await fetch(fullUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    })

    if (!response.ok) {
      console.log(`[Luma Venue Enrichment] HTTP ${response.status} for ${fullUrl}`)
      return null
    }

    const html = await response.text()
    return extractVenueFromHtml(html)
  } catch (error) {
    console.log(`[Luma Venue Enrichment] Failed to fetch ${eventUrl}:`, error)
    return null
  }
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
