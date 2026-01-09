/**
 * Meetup Venue Enrichment
 *
 * Fetches venue information from Meetup event detail pages.
 * Used in Phase 2 enrichment after initial event import.
 *
 * Uses simple fetch + HTML parsing instead of Playwright for serverless compatibility.
 * JSON-LD structured data is embedded in the initial HTML response.
 */

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
 * Extract JSON-LD venue data from HTML content
 * Parses all <script type="application/ld+json"> tags to find venue information
 */
function extractVenueFromHtml(html: string): MeetupVenueInfo | null {
  // Find all JSON-LD script tags using regex
  const jsonLdPattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let match

  while ((match = jsonLdPattern.exec(html)) !== null) {
    try {
      const jsonContent = match[1].trim()
      const data = JSON.parse(jsonContent)

      // Look for location data in the JSON-LD
      if (data.location) {
        const loc = data.location
        if (loc['@type'] === 'Place' && loc.name) {
          const address =
            typeof loc.address === 'string'
              ? loc.address
              : loc.address?.streetAddress || loc.address?.name || null
          return { name: loc.name, address }
        }
      }
    } catch {
      // Not valid JSON or doesn't match expected structure, continue
    }
  }

  return null
}

/**
 * Fetch venue info from a single Meetup event detail page
 * Uses simple fetch instead of Playwright - JSON-LD is in the initial HTML
 */
export async function fetchMeetupVenueFromUrl(eventUrl: string): Promise<MeetupVenueInfo | null> {
  try {
    const response = await fetch(eventUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    })

    if (!response.ok) {
      console.log(`[Meetup Enrichment] HTTP ${response.status} for ${eventUrl}`)
      return null
    }

    const html = await response.text()
    return extractVenueFromHtml(html)
  } catch (error) {
    console.log(`[Meetup Enrichment] Failed to fetch ${eventUrl}:`, error)
    return null
  }
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

  console.log(`[Meetup Enrichment] Starting enrichment for ${events.length} events...`)

  // Process in batches
  for (let i = 0; i < events.length; i += concurrency) {
    const batch = events.slice(i, i + concurrency)

    // Process batch in parallel
    const batchResults = await Promise.all(
      batch.map(async (event) => {
        try {
          const venue = await fetchMeetupVenueFromUrl(event.eventUrl)
          if (venue) {
            console.log(`[Meetup Enrichment] Found venue for event ${event.id}: ${venue.name}`)
          }
          return { eventId: event.id, venue }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error'
          console.log(`[Meetup Enrichment] Error for event ${event.id}: ${errorMsg}`)
          return { eventId: event.id, venue: null, error: errorMsg }
        }
      })
    )

    results.push(...batchResults)

    // Delay between batches (except after last batch)
    if (i + concurrency < events.length) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }

    console.log(
      `[Meetup Enrichment] Progress: ${Math.min(i + concurrency, events.length)}/${events.length}`
    )
  }

  console.log(
    `[Meetup Enrichment] Completed. Found venues for ${results.filter((r) => r.venue).length}/${events.length} events`
  )
  return results
}
