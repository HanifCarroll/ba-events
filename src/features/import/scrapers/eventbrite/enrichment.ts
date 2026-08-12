/**
 * Eventbrite Event Enrichment
 *
 * Enriches Eventbrite events with:
 * 1. Price (fetched from individual event pages)
 * 2. Categories (inferred via AI from name + description)
 *
 * This runs as Phase 2, after the fast JSON-LD import.
 */

import { generateObject } from 'ai'
import { z } from 'zod'
import type { Category } from '@/shared/lib/types'
import { NO_THINKING, textModel } from '@/shared/lib/ai/providers'
import { HttpError } from '@/shared/lib/errors'

// ---------------------------------------------------------------------------
// Price Extraction
// ---------------------------------------------------------------------------

export interface EventbritePriceInfo {
  price: number | null
  isFree: boolean
}

/**
 * Fetch an Eventbrite event page and extract price information.
 * Throws HttpError for HTTP errors (404, 500, etc.) to allow callers to detect canceled events.
 * Returns null only for network errors (no response received).
 */
export async function fetchEventbritePrice(url: string): Promise<EventbritePriceInfo | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
      },
    })

    if (!response.ok) {
      // Throw HttpError so callers can detect 404s and mark events as canceled
      throw new HttpError(response.status, response.statusText, url)
    }

    const html = await response.text()
    return extractPriceFromHtml(html)
  } catch (error) {
    // Re-throw HttpError as-is for upstream handling
    if (error instanceof HttpError) {
      throw error
    }
    console.error(`[eventbrite] Price fetch error for ${url}:`, error)
    return null
  }
}

/**
 * Extract price from Eventbrite page HTML
 */
function extractPriceFromHtml(html: string): EventbritePriceInfo {
  // Check for "Gratis" or "Free" indicators first
  if (
    html.includes('>Gratis<') ||
    html.includes('>Free<') ||
    html.includes('data-testid="free-badge"') ||
    html.includes('"price":"0"') ||
    html.includes('"price": "0"')
  ) {
    return { price: 0, isFree: true }
  }

  // Try to find price in various formats
  // Format 1: $X.XXX,XX ARS or $X,XXX.XX USD
  const arsMatch = html.match(/\$\s*([\d.]+)[,.](\d{2})\s*(ARS)?/i)
  if (arsMatch) {
    // Argentine format: 1.500,00 → 1500.00
    const intPart = arsMatch[1].replace(/\./g, '')
    const decPart = arsMatch[2]
    const price = parseFloat(`${intPart}.${decPart}`)
    if (!isNaN(price)) {
      return { price, isFree: price === 0 }
    }
  }

  // Format 2: Simple number with optional decimals
  const simpleMatch = html.match(/(?:desde|from)?\s*\$\s*([\d,]+(?:\.\d{2})?)/i)
  if (simpleMatch) {
    const price = parseFloat(simpleMatch[1].replace(/,/g, ''))
    if (!isNaN(price)) {
      return { price, isFree: price === 0 }
    }
  }

  // Format 3: JSON-LD offers.price on individual page
  const jsonLdPriceMatch = html.match(/"price"\s*:\s*"?([\d.]+)"?/)
  if (jsonLdPriceMatch) {
    const price = parseFloat(jsonLdPriceMatch[1])
    if (!isNaN(price)) {
      return { price, isFree: price === 0 }
    }
  }

  // No price found - assume free (common for many Eventbrite events)
  return { price: null, isFree: true }
}

// ---------------------------------------------------------------------------
// AI-based Category Inference
// ---------------------------------------------------------------------------

// The 6 simplified categories
const CATEGORY_SCHEMA = z.object({
  category: z.enum(['music', 'arts', 'food', 'social', 'sports', 'festival']),
})

/**
 * Prompt for categorizing events
 */
const CATEGORIZATION_PROMPT = `Categorize this event into ONE of these categories:
- music: concerts, DJ sets, live performances, music festivals
- arts: theater, comedy, film, exhibitions, galleries, workshops, cultural events
- food: food markets, wine tastings, culinary events, restaurant events
- social: networking, meetups, parties, social gatherings, expat events
- sports: fitness, yoga, running, sports competitions, outdoor activities
- festival: multi-day festivals, large celebrations, fairs, carnivals

Based on the event name and description, choose the SINGLE most appropriate category.
If unclear, use "social" as the default.

Respond with ONLY a JSON object with a single "category" field, e.g. {"category": "music"}. Nothing else.`

/**
 * Infer category from event name and description using AI.
 * generateObject schema-validates the output, so it always returns a valid category.
 */
export async function inferCategory(
  name: string,
  description: string | null
): Promise<Category> {
  try {
    const eventContext = `Event: ${name}${description ? `\nDescription: ${description}` : ''}`

    const { object } = await generateObject({
      model: textModel,
      schema: CATEGORY_SCHEMA,
      prompt: `${CATEGORIZATION_PROMPT}\n\n${eventContext}`,
      ...NO_THINKING,
    })

    return object.category
  } catch (error) {
    console.error('[eventbrite] AI inference error:', error)
    return 'social'
  }
}

// ---------------------------------------------------------------------------
// Combined Enrichment
// ---------------------------------------------------------------------------

export interface EventbriteEnrichmentResult {
  price: number | null
  is_free: boolean
  categories: Category[]
}

/**
 * Fully enrich an Eventbrite event with price and category
 *
 * @param eventUrl - Event page URL for price fetching
 * @param name - Event name for AI inference
 * @param description - Event description for AI inference
 */
export async function enrichEventbriteEvent(
  eventUrl: string,
  name: string,
  description: string | null
): Promise<EventbriteEnrichmentResult> {
  // Run price fetch and AI inference in parallel
  const [priceInfo, category] = await Promise.all([
    fetchEventbritePrice(eventUrl),
    inferCategory(name, description),
  ])

  return {
    price: priceInfo?.price ?? null,
    is_free: priceInfo?.isFree ?? true,
    categories: [category],
  }
}

export interface BatchEnrichmentResult {
  id: string
  price: number | null
  is_free: boolean
  categories: Category[]
  error?: string
}

/**
 * Batch enrich multiple Eventbrite events
 *
 * @param events - Events to enrich (must have id, link, name, description_es)
 * @param onProgress - Optional progress callback
 * @param delayMs - Delay between requests to avoid rate limiting
 */
export async function enrichEventbriteEventsBatch(
  events: Array<{ id: string; link: string; name: string; description_es: string | null }>,
  onProgress?: (current: number, total: number) => void,
  delayMs: number = 500
): Promise<BatchEnrichmentResult[]> {
  const results: BatchEnrichmentResult[] = []

  for (let i = 0; i < events.length; i++) {
    const event = events[i]
    onProgress?.(i + 1, events.length)

    try {
      const enrichment = await enrichEventbriteEvent(event.link, event.name, event.description_es)
      results.push({
        id: event.id,
        ...enrichment,
      })
    } catch (error) {
      results.push({
        id: event.id,
        price: null,
        is_free: true,
        categories: ['social'],
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }

    // Add delay between requests
    if (i < events.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  return results
}

// ---------------------------------------------------------------------------
// Venue Extraction (for events imported without venue data)
// ---------------------------------------------------------------------------

export interface EventbriteVenueInfo {
  name: string
  address: string | null
  latitude: number | null
  longitude: number | null
}

/**
 * Extract venue info from Eventbrite event page JSON-LD.
 * Throws HttpError for HTTP errors (404, 500, etc.) to allow callers to detect canceled events.
 * Returns null only for network errors or if no venue data found.
 */
export async function extractEventbriteVenueInfo(
  link: string
): Promise<EventbriteVenueInfo | null> {
  try {
    const response = await fetch(link, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
      },
    })

    if (!response.ok) {
      // Throw HttpError so callers can detect 404s and mark events as canceled
      throw new HttpError(response.status, response.statusText, link)
    }

    const html = await response.text()

    // Extract JSON-LD script tag
    const jsonLdMatch = html.match(
      /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i
    )

    if (!jsonLdMatch) {
      return null
    }

    try {
      const data = JSON.parse(jsonLdMatch[1])

      // Handle different JSON-LD structures
      interface JsonLdEvent {
        '@type': string
        location?: {
          name?: string
          address?: {
            streetAddress?: string
            addressLocality?: string
          }
          geo?: {
            latitude: string
            longitude: string
          }
        }
      }

      let eventData: JsonLdEvent | null = null

      if (data['@type'] === 'Event') {
        eventData = data
      } else if (Array.isArray(data)) {
        eventData = data.find((item) => item['@type'] === 'Event')
      } else if (data['@graph']) {
        eventData = data['@graph'].find((item: JsonLdEvent) => item['@type'] === 'Event')
      }

      if (!eventData?.location?.name) {
        return null
      }

      const location = eventData.location
      const address = location.address
      const geo = location.geo

      const addressParts = [address?.streetAddress, address?.addressLocality].filter(
        (part): part is string => Boolean(part)
      )

      return {
        name: location.name!,
        address: addressParts.length > 0 ? addressParts.join(', ') : null,
        latitude: geo?.latitude ? parseFloat(geo.latitude) : null,
        longitude: geo?.longitude ? parseFloat(geo.longitude) : null,
      }
    } catch {
      console.error(`[Eventbrite] Failed to parse JSON-LD from ${link}`)
      return null
    }
  } catch (error) {
    // Re-throw HttpError as-is for upstream handling
    if (error instanceof HttpError) {
      throw error
    }
    console.error(`[Eventbrite] Error fetching ${link}:`, error)
    return null
  }
}

/**
 * Batch extract venue info from multiple Eventbrite events
 */
export async function extractEventbriteVenuesBatch(
  events: Array<{ id: string; link: string }>,
  delayMs: number = 500
): Promise<
  Array<{
    id: string
    venue: EventbriteVenueInfo | null
    error?: string
  }>
> {
  const results: Array<{
    id: string
    venue: EventbriteVenueInfo | null
    error?: string
  }> = []

  for (const event of events) {
    try {
      const venue = await extractEventbriteVenueInfo(event.link)
      results.push({ id: event.id, venue })
    } catch (error) {
      results.push({
        id: event.id,
        venue: null,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }

    // Rate limiting delay
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  return results
}
