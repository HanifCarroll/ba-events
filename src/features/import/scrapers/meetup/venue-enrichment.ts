/**
 * Meetup Venue Enrichment
 *
 * Fetches venue information from Meetup event detail pages.
 * Used in Phase 2 enrichment after initial event import.
 */

import type { Page, Browser } from 'playwright'

export interface MeetupVenueInfo {
  name: string
  address: string | null
}

/**
 * Script to extract venue info from event detail page
 * Runs in browser context via page.evaluate()
 */
const venueExtractionScript = (): { name: string | null; address: string | null } => {
  // Method 1: JSON-LD structured data (most reliable)
  // Meetup uses various Schema.org event subtypes (FoodEvent, EducationEvent, SocialEvent, etc.)
  // so we check for any JSON-LD with a location.@type === 'Place' rather than specific event types
  const scripts = document.querySelectorAll('script[type="application/ld+json"]')
  for (const script of scripts) {
    try {
      const data = JSON.parse(script.textContent || '')
      if (data.location) {
        const loc = data.location
        if (loc['@type'] === 'Place' && loc.name) {
          const address = typeof loc.address === 'string'
            ? loc.address
            : loc.address?.streetAddress || null
          return { name: loc.name, address }
        }
      }
    } catch {
      // Not valid JSON, continue
    }
  }

  // Method 2: DOM element with data-testid
  const locationSection = document.querySelector('[data-testid="event-location"]')
  if (locationSection) {
    const nameEl = locationSection.querySelector('a') || locationSection.querySelector('h3')
    const addressEl = locationSection.querySelector('address') || locationSection.querySelector('p')
    const name = nameEl?.textContent?.trim() || null
    const address = addressEl?.textContent?.trim() || null
    if (name) return { name, address }
  }

  // Method 3: Look for location icon followed by venue name
  const locationIcon = document.querySelector('[data-icon="location-dot"]')
  if (locationIcon) {
    const parent = locationIcon.closest('div')
    const text = parent?.textContent?.trim()
    if (text && text.length < 200) {
      // Split by newlines or commas to get venue name vs address
      const parts = text.split(/\n|,/).map(s => s.trim()).filter(Boolean)
      if (parts.length > 0) {
        return {
          name: parts[0],
          address: parts.slice(1).join(', ') || null
        }
      }
    }
  }

  return { name: null, address: null }
}

/**
 * Fetch venue info from a single Meetup event detail page
 */
export async function fetchMeetupVenueFromDetailPage(
  page: Page,
  eventUrl: string
): Promise<MeetupVenueInfo | null> {
  try {
    await page.goto(eventUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    })

    // Wait for JSON-LD scripts to be present (they're in initial HTML)
    // Use state: 'attached' since script tags are never visible
    await page.waitForSelector('script[type="application/ld+json"]', { timeout: 5000, state: 'attached' })

    const venueInfo = await page.evaluate(venueExtractionScript)

    if (venueInfo.name) {
      return {
        name: venueInfo.name,
        address: venueInfo.address,
      }
    }

    return null
  } catch (error) {
    console.log(`[Meetup Enrichment] Failed to fetch venue from ${eventUrl}:`, error)
    return null
  }
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
 * Batch fetch venues for multiple Meetup events
 *
 * Uses a single browser instance and processes events with controlled concurrency
 * to avoid rate limiting.
 *
 * @param events - Array of events with id and eventUrl
 * @param concurrency - Number of pages to process in parallel (default: 3)
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

  const { chromium } = await import('playwright')

  const browser: Browser = await chromium.launch({
    headless: true,
  })

  const results: EnrichmentResult[] = []

  try {
    console.log(`[Meetup Enrichment] Starting enrichment for ${events.length} events...`)

    // Process in batches
    for (let i = 0; i < events.length; i += concurrency) {
      const batch = events.slice(i, i + concurrency)

      // Process batch in parallel
      const batchResults = await Promise.all(
        batch.map(async (event) => {
          const page = await browser.newPage()
          try {
            const venue = await fetchMeetupVenueFromDetailPage(page, event.eventUrl)
            if (venue) {
              console.log(`[Meetup Enrichment] Found venue for event ${event.id}: ${venue.name}`)
            }
            return { eventId: event.id, venue }
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error'
            console.log(`[Meetup Enrichment] Error for event ${event.id}: ${errorMsg}`)
            return { eventId: event.id, venue: null, error: errorMsg }
          } finally {
            await page.close()
          }
        })
      )

      results.push(...batchResults)

      // Delay between batches (except after last batch)
      if (i + concurrency < events.length) {
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }

      console.log(`[Meetup Enrichment] Progress: ${Math.min(i + concurrency, events.length)}/${events.length}`)
    }

    return results
  } finally {
    await browser.close()
    console.log(`[Meetup Enrichment] Completed. Found venues for ${results.filter(r => r.venue).length}/${events.length} events`)
  }
}
