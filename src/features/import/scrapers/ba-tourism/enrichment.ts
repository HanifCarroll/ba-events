/**
 * BA Tourism Venue Enrichment
 *
 * Extracts venue information from BA Tourism event detail pages
 * using simple fetch + regex (no Playwright or AI needed).
 */

/**
 * Extract venue name from BA Tourism event detail page
 * Venue appears under the "¿Dónde?" heading
 */
export async function extractBATourismVenueName(link: string): Promise<string | null> {
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
      console.error(`[BA Tourism Enrichment] Failed to fetch ${link}: ${response.status}`)
      return null
    }

    const html = await response.text()

    // Look for venue name after "¿Dónde?" heading
    // The structure is typically: <strong>¿Dónde?</strong></p><p>Venue Name</p>
    // or variations with different tags
    const patterns = [
      // Pattern 1: ¿Dónde? followed by content in next element
      /¿Dónde\?[\s\S]*?<\/[^>]+>\s*<[^>]+>([^<]+)/i,
      // Pattern 2: ¿Dónde? with venue in same line after closing tag
      /¿Dónde\?<\/[^>]+>\s*([^<]+)/i,
      // Pattern 3: More flexible - find ¿Dónde? and get next non-empty text
      /¿Dónde\?[\s\S]*?>\s*([A-Z][^<]{3,})/,
    ]

    for (const pattern of patterns) {
      const match = html.match(pattern)
      if (match?.[1]) {
        const venueName = match[1]
          .trim()
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)))

        // Validate it looks like a venue name (not HTML or short garbage)
        if (venueName.length >= 3 && !venueName.startsWith('<') && !venueName.includes('=')) {
          return venueName
        }
      }
    }

    console.log(`[BA Tourism Enrichment] Could not extract venue from ${link}`)
    return null
  } catch (error) {
    console.error(`[BA Tourism Enrichment] Error fetching ${link}:`, error)
    return null
  }
}

/**
 * Batch extract venue names from multiple BA Tourism events
 */
export async function extractBATourismVenuesBatch(
  events: Array<{ id: string; link: string }>,
  delayMs = 500
): Promise<Array<{ id: string; venueName: string | null; error?: string }>> {
  const results: Array<{ id: string; venueName: string | null; error?: string }> = []

  for (const event of events) {
    try {
      const venueName = await extractBATourismVenueName(event.link)
      results.push({ id: event.id, venueName })

      // Rate limiting delay
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }
    } catch (error) {
      results.push({
        id: event.id,
        venueName: null,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  return results
}
