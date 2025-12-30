/**
 * Client-side Passline Venue Enrichment
 *
 * Fetches Passline event detail pages from the browser to extract venue information.
 * Must run client-side because Cloudflare blocks server-side requests.
 *
 * Passline detail pages have:
 * - JSON-LD with venue name (location.name)
 * - DOM elements with city/region info (e.g., "Buenos Aires, PALERMO")
 * - Google Maps link (could be resolved for full address but adds complexity)
 */

export interface PasslineVenueInfo {
  venueName: string
  address: string | null // Street address like "Blvd. Pellegrini y Av. López y Planes"
  location: string | null // City/region string like "Buenos Aires, PALERMO"
}

export interface PasslineEnrichmentResult {
  id: string
  venue: PasslineVenueInfo | null
  error?: string
}

/**
 * Extract venue info from a Passline event detail page
 * Runs in browser context (client-side only)
 *
 * Passline venue blocks typically contain:
 * - Line 1: Venue name (e.g., "Estadio Club A. Unión")
 * - Line 2: Street address (e.g., "Blvd. Pellegrini y Av. López y Planes")
 * - Line 3: City, REGION (e.g., "Santa Fe, SANTA FE")
 */
export async function extractPasslineVenueClient(
  url: string
): Promise<PasslineVenueInfo | null> {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
      },
    })

    if (!response.ok) {
      console.error(`[Passline] Failed to fetch ${url}: ${response.status}`)
      return null
    }

    const html = await response.text()

    let venueName: string | null = null
    let address: string | null = null
    let location: string | null = null

    // Method 1: Extract from JSON-LD (most reliable for venue name)
    const jsonLdMatch = html.match(
      /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i
    )

    if (jsonLdMatch) {
      try {
        const jsonLd = JSON.parse(jsonLdMatch[1])
        if (jsonLd.location?.name) {
          venueName = jsonLd.location.name
        }
      } catch {
        // JSON parse failed, continue with DOM extraction
      }
    }

    // Method 2: Extract address/location from venue block in DOM
    // The venue block typically appears as nested elements with:
    // - Venue name (from JSON-LD or first line)
    // - Street address (e.g., "Blvd. Pellegrini y Av. López y Planes")
    // - City, REGION (e.g., "Santa Fe, SANTA FE")

    if (venueName) {
      // Look for the venue name in HTML and extract surrounding text
      // The venue block is usually in a link or div near the event header
      const venueNameEscaped = venueName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const venueBlockPattern = new RegExp(
        venueNameEscaped + '[\\s\\S]{0,200}',
        'i'
      )
      const venueBlockMatch = html.match(venueBlockPattern)

      if (venueBlockMatch) {
        // Strip HTML tags and get text lines
        const blockText = venueBlockMatch[0]
          .replace(/<[^>]+>/g, '\n')
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0)

        // Find address line (has numbers or street keywords)
        for (const line of blockText) {
          if (line === venueName) continue
          if (
            !address &&
            line.length > 5 &&
            (/\d/.test(line) ||
              /(?:calle|av\.|avenida|blvd|boulevard|paseo|ruta)/i.test(line))
          ) {
            address = line
          }
          // Find location line (City, REGION format)
          if (!location && line.includes(',') && /[A-ZÁÉÍÓÚ]{2,}$/.test(line.trim())) {
            location = line
          }
        }
      }
    }

    // Method 2b: Try to find venue block near maps link if present
    if (!address) {
      const mapsLinkMatch = html.match(
        /href="[^"]*(?:maps\.app\.goo\.gl|google\.com\/maps|javascript:void)[^"]*"[^>]*>([\s\S]*?)<\/a>/i
      )

      if (mapsLinkMatch) {
        const linkContent = mapsLinkMatch[1]
          .replace(/<[^>]+>/g, '\n')
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0)

        // Look for address and location in link content
        for (const line of linkContent) {
          if (
            !address &&
            line.length > 5 &&
            (/\d/.test(line) ||
              /(?:calle|av\.|avenida|blvd|boulevard|paseo|ruta)/i.test(line))
          ) {
            address = line
          }
          if (!location && line.includes(',') && /[A-ZÁÉÍÓÚ]{2,}$/.test(line.trim())) {
            location = line
          }
        }
      }
    }

    // Method 3: Extract location from broader HTML patterns
    // Look for patterns like "Buenos Aires, NEIGHBORHOOD" or "City, REGION"
    if (!location) {
      const locationPatterns = [
        // Pattern: "Buenos Aires, NEIGHBORHOOD"
        />\s*(Buenos\s+Aires,\s*[A-ZÁÉÍÓÚ][A-Za-záéíóúñÁÉÍÓÚÑ\s]+)\s*</i,
        // Pattern: "Capital Federal, NEIGHBORHOOD"
        />\s*(Capital\s+Federal,\s*[A-ZÁÉÍÓÚ][A-Za-záéíóúñÁÉÍÓÚÑ\s]+)\s*</i,
        // Pattern: "CityName, REGION" (all caps region)
        />\s*([A-Za-záéíóúñÁÉÍÓÚÑ\s]+,\s*[A-ZÁÉÍÓÚ]{2,})\s*</,
      ]

      for (const pattern of locationPatterns) {
        const match = html.match(pattern)
        if (match) {
          location = match[1].trim()
          break
        }
      }
    }

    // If we found a venue name, return the result
    if (venueName) {
      return {
        venueName,
        address,
        location,
      }
    }

    return null
  } catch (error) {
    console.error(`[Passline] Error extracting venue from ${url}:`, error)
    return null
  }
}

/**
 * Batch extract venue info from multiple Passline events
 * Includes rate limiting delay between requests
 */
export async function extractPasslineVenuesBatchClient(
  events: Array<{ id: string; url: string }>,
  onProgress?: (current: number, total: number) => void,
  delayMs: number = 500
): Promise<PasslineEnrichmentResult[]> {
  const results: PasslineEnrichmentResult[] = []

  for (let i = 0; i < events.length; i++) {
    const event = events[i]
    onProgress?.(i + 1, events.length)

    try {
      const venue = await extractPasslineVenueClient(event.url)
      results.push({ id: event.id, venue })
    } catch (error) {
      results.push({
        id: event.id,
        venue: null,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }

    // Rate limiting delay between requests
    if (i < events.length - 1 && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  return results
}
