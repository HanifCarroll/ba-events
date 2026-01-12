/**
 * Shared HTML Parsing Utilities
 *
 * Provides reusable functions for extracting structured data from HTML content.
 * Used by scrapers to extract JSON-LD, __NEXT_DATA__, and other embedded data.
 *
 * These utilities work with fetch + HTML parsing (no Playwright needed) for
 * serverless compatibility.
 */

import { HttpError } from './errors'

/**
 * Extract all JSON-LD structured data from HTML
 * Returns array of parsed JSON objects from <script type="application/ld+json"> tags
 */
export function extractJsonLd(html: string): unknown[] {
  const pattern =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  const results: unknown[] = []
  let match

  while ((match = pattern.exec(html)) !== null) {
    try {
      results.push(JSON.parse(match[1].trim()))
    } catch {
      // Skip invalid JSON
    }
  }

  return results
}

/**
 * Find JSON-LD data matching a Schema.org type
 * Handles both direct objects and @graph arrays
 */
export function findJsonLdByType(html: string, schemaType: string): unknown | null {
  const allData = extractJsonLd(html)

  for (const data of allData) {
    if (typeof data === 'object' && data !== null) {
      const obj = data as Record<string, unknown>

      // Direct type match
      if (obj['@type'] === schemaType) return data

      // Handle @graph arrays
      if (Array.isArray(obj['@graph'])) {
        const found = obj['@graph'].find(
          (item: Record<string, unknown>) => item['@type'] === schemaType
        )
        if (found) return found
      }
    }
  }

  return null
}

/**
 * Extract __NEXT_DATA__ from Next.js pages
 * Returns the parsed JSON object from the #__NEXT_DATA__ script tag
 */
export function extractNextData(html: string): unknown | null {
  const match = html.match(
    /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i
  )
  if (!match) return null

  try {
    return JSON.parse(match[1])
  } catch {
    return null
  }
}

/**
 * Navigate a nested object path safely
 * Returns undefined if any part of the path doesn't exist
 *
 * @example
 * getNestedValue(obj, 'props.pageProps.event') // obj.props.pageProps.event
 */
export function getNestedValue(obj: unknown, path: string): unknown {
  return path.split('.').reduce((current, key) => {
    if (current && typeof current === 'object' && key in current) {
      return (current as Record<string, unknown>)[key]
    }
    return undefined
  }, obj)
}

/**
 * Venue data extracted from HTML
 */
export interface ExtractedVenue {
  name: string
  address: string | null
  latitude?: number | null
  longitude?: number | null
}

/**
 * Extract venue data from JSON-LD Event location
 * Looks for Event type with a Place location
 */
export function extractVenueFromJsonLdEvent(html: string): ExtractedVenue | null {
  const eventData = findJsonLdByType(html, 'Event') as Record<string, unknown> | null
  if (!eventData?.location) return null

  const loc = eventData.location as Record<string, unknown>
  if (loc['@type'] !== 'Place' || !loc.name) return null

  const address = loc.address as Record<string, unknown> | string | undefined

  return {
    name: loc.name as string,
    address:
      typeof address === 'string'
        ? address
        : (address?.streetAddress as string) || null,
    latitude: (loc.geo as Record<string, unknown>)?.latitude as number | null ?? null,
    longitude: (loc.geo as Record<string, unknown>)?.longitude as number | null ?? null,
  }
}

/**
 * Extract meta tag content by name
 *
 * @example
 * extractMetaContent(html, 'description') // <meta name="description" content="...">
 */
export function extractMetaContent(html: string, name: string): string | null {
  const pattern = new RegExp(
    `<meta[^>]*name=["']${name}["'][^>]*content=["']([^"']+)["']`,
    'i'
  )
  const match = html.match(pattern)
  return match ? match[1] : null
}

/**
 * Extract meta tag content by property (for Open Graph tags)
 *
 * @example
 * extractMetaProperty(html, 'og:title') // <meta property="og:title" content="...">
 */
export function extractMetaProperty(html: string, property: string): string | null {
  const pattern = new RegExp(
    `<meta[^>]*property=["']${property}["'][^>]*content=["']([^"']+)["']`,
    'i'
  )
  const match = html.match(pattern)
  return match ? match[1] : null
}

/**
 * Standard browser-like headers for web scraping
 * Mimics a real Chrome browser to avoid being blocked
 */
export const browserHeaders = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
}

/**
 * Fetch HTML content from a URL with browser-like headers.
 * Throws HttpError for HTTP errors (404, 500, etc.) to allow callers to distinguish error types.
 * Returns null only for network errors (no response received).
 */
export async function fetchHtml(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { headers: browserHeaders })

    if (!response.ok) {
      // Throw HttpError so callers can distinguish 404s from other errors
      throw new HttpError(response.status, response.statusText, url)
    }

    return await response.text()
  } catch (error) {
    // Re-throw HttpError as-is for upstream handling
    if (error instanceof HttpError) {
      throw error
    }
    // Network errors, timeouts, etc. - log and return null
    console.log(`[HTML Fetch] Failed to fetch ${url}:`, error)
    return null
  }
}
