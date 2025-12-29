/**
 * Client-side Description Scraper for Passline Events
 *
 * Fetches real event descriptions from Passline event pages.
 * Runs in browser to bypass Cloudflare protection.
 */

/**
 * Delay helper for rate limiting
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Parse description from HTML content
 * Tries multiple sources in order of preference
 */
function parseDescriptionFromHTML(html: string): string | null {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')

  // Try 1: Open Graph description (most reliable for event pages)
  const ogDescription = doc.querySelector('meta[property="og:description"]')
  if (ogDescription) {
    const content = ogDescription.getAttribute('content')?.trim()
    if (content && content.length > 20) {
      return content
    }
  }

  // Try 2: Standard meta description
  const metaDescription = doc.querySelector('meta[name="description"]')
  if (metaDescription) {
    const content = metaDescription.getAttribute('content')?.trim()
    if (content && content.length > 20) {
      return content
    }
  }

  // Try 3: Look for common description containers
  const descriptionSelectors = [
    '.event-description',
    '.description',
    '[data-description]',
    '.event-info p',
    '.event-details p',
    'article p',
  ]

  for (const selector of descriptionSelectors) {
    const element = doc.querySelector(selector)
    if (element) {
      const text = element.textContent?.trim()
      if (text && text.length > 20) {
        return text
      }
    }
  }

  return null
}

/**
 * Clean and normalize description text
 */
function cleanDescription(description: string): string {
  return description
    .replace(/\s+/g, ' ') // Normalize whitespace
    .replace(/\n+/g, '\n') // Normalize newlines
    .trim()
    .slice(0, 2000) // Limit length
}

/**
 * Fetch description from a single Passline event page
 */
export async function fetchEventDescription(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'text/html',
        'User-Agent': 'Mozilla/5.0 (compatible; EventScraper/1.0)',
      },
    })

    if (!response.ok) {
      console.warn(`Failed to fetch ${url}: ${response.status}`)
      return null
    }

    const html = await response.text()
    const description = parseDescriptionFromHTML(html)

    if (description) {
      return cleanDescription(description)
    }

    return null
  } catch (error) {
    console.error(`Error fetching description from ${url}:`, error)
    return null
  }
}

/**
 * Result of a batch description fetch
 */
export interface DescriptionFetchResult {
  id: string
  link: string
  description: string | null
  error?: string
}

/**
 * Fetch descriptions for multiple events
 * Processes sequentially with delay to avoid rate limiting
 */
export async function fetchDescriptionsBatch(
  events: Array<{ id: string; link: string }>,
  onProgress?: (current: number, total: number) => void,
  delayMs = 500
): Promise<DescriptionFetchResult[]> {
  const results: DescriptionFetchResult[] = []

  for (let i = 0; i < events.length; i++) {
    const event = events[i]

    // Report progress
    onProgress?.(i + 1, events.length)

    // Skip if no link
    if (!event.link) {
      results.push({
        id: event.id,
        link: event.link,
        description: null,
        error: 'No link provided',
      })
      continue
    }

    try {
      const description = await fetchEventDescription(event.link)
      results.push({
        id: event.id,
        link: event.link,
        description,
      })
    } catch (error) {
      results.push({
        id: event.id,
        link: event.link,
        description: null,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }

    // Add delay between requests (except for last one)
    if (i < events.length - 1) {
      await delay(delayMs)
    }
  }

  return results
}
