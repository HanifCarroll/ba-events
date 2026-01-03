/**
 * Luma Venue Enrichment
 *
 * Fetches venue information from individual Luma event pages.
 * Used for events that were imported without venue data.
 *
 * Uses Playwright to access __NEXT_DATA__ embedded in Luma pages.
 */

import type { Page, Browser } from 'playwright'
import type {
  VenueEnrichProgress,
  VenueEnrichComplete,
} from '@/shared/lib/streaming-types'

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

/**
 * Script to extract venue from Luma event detail page
 * Runs in browser context via page.evaluate()
 */
const venueExtractionScript = (): {
  name: string
  address: string | null
  latitude: number | null
  longitude: number | null
} | null => {
  // Method 1: __NEXT_DATA__ embedded data (most reliable)
  const nextDataScript = document.querySelector('#__NEXT_DATA__')
  if (nextDataScript) {
    try {
      const data = JSON.parse(nextDataScript.textContent || '')
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
      // Not valid JSON, continue
    }
  }

  // Method 2: JSON-LD Schema.org structured data
  const scripts = document.querySelectorAll('script[type="application/ld+json"]')
  for (const script of scripts) {
    try {
      const data = JSON.parse(script.textContent || '')
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
 * Fetch venue from a single Luma event detail page
 */
export async function fetchLumaVenueFromDetailPage(
  page: Page,
  eventUrl: string
): Promise<LumaVenueResult['venue']> {
  try {
    // Ensure URL is properly formed
    let fullUrl = eventUrl
    if (!fullUrl.startsWith('http')) {
      fullUrl = `https://lu.ma${fullUrl.startsWith('/') ? '' : '/'}${fullUrl}`
    }

    await page.goto(fullUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    })

    // Wait for __NEXT_DATA__ script to be present
    await page.waitForSelector('#__NEXT_DATA__', { timeout: 5000, state: 'attached' })

    const venue = await page.evaluate(venueExtractionScript)

    return venue
  } catch (error) {
    console.log(`[Luma Venue Enrichment] Failed to fetch venue from ${eventUrl}:`, error)
    return null
  }
}

export interface VenueEnrichmentEvent {
  eventId: string
  eventUrl: string
  eventName?: string
}

/**
 * Batch fetch venues for multiple Luma events with streaming progress
 *
 * Uses a single browser instance and processes events with controlled concurrency
 * to avoid rate limiting.
 *
 * @param events - Array of events with eventId and eventUrl
 * @param concurrency - Number of pages to process in parallel (default: 3)
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

  const { chromium } = await import('playwright')

  const browser: Browser = await chromium.launch({
    headless: true,
  })

  const results: LumaVenueResult[] = []
  const errors: Array<{ id: string; error: string }> = []
  let enriched = 0

  try {
    console.log(`[Luma Venue Enrichment] Starting venue enrichment for ${events.length} events...`)

    // Process in batches
    for (let i = 0; i < events.length; i += concurrency) {
      const batch = events.slice(i, i + concurrency)

      // Process batch in parallel
      const batchResults = await Promise.all(
        batch.map(async (event) => {
          const page = await browser.newPage()
          try {
            const venue = await fetchLumaVenueFromDetailPage(page, event.eventUrl)
            if (venue) {
              console.log(`[Luma Venue Enrichment] Found venue "${venue.name}" for ${event.eventName || event.eventId}`)
            }
            return {
              eventId: event.eventId,
              eventName: event.eventName,
              venue,
              success: !!venue,
            }
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error'
            console.log(`[Luma Venue Enrichment] Error for ${event.eventName || event.eventId}: ${errorMsg}`)
            return {
              eventId: event.eventId,
              eventName: event.eventName,
              venue: null,
              error: errorMsg,
              success: false,
            }
          } finally {
            await page.close()
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

      console.log(`[Luma Venue Enrichment] Progress: ${Math.min(i + concurrency, events.length)}/${events.length}`)
    }

    // Final completion message
    yield {
      type: 'complete',
      enriched,
      venuesCreated: 0, // Will be updated by server action
      total: events.length,
      errors,
    }

    console.log(`[Luma Venue Enrichment] Completed. Found venues for ${enriched}/${events.length} events`)
  } finally {
    await browser.close()
  }
}
