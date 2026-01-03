/**
 * Luma Description Enrichment
 *
 * Fetches full event descriptions from individual Luma event pages.
 * The Buenos Aires listing page only shows event titles - descriptions
 * are only available on individual event pages.
 *
 * Used in post-import enrichment step or from events table.
 */

import type { Page, Browser } from 'playwright'
import type {
  DescriptionEnrichProgress,
  DescriptionEnrichComplete,
} from '@/shared/lib/streaming-types'

export interface LumaDescriptionResult {
  eventId: string
  description: string | null
  error?: string
}

// Type for Prosemirror nodes (used in browser context)
type ProsemirrorNode = { type: string; text?: string; content?: ProsemirrorNode[] }

/**
 * Script to extract description from Luma event detail page
 * Runs in browser context via page.evaluate()
 */
const descriptionExtractionScript = (): string | null => {
  // Helper function to extract text from Prosemirror document
  function extractTextFromProsemirror(content: ProsemirrorNode[]): string {
    const parts: string[] = []

    for (const node of content) {
      if (node.type === 'text' && node.text) {
        parts.push(node.text)
      } else if (node.type === 'paragraph' || node.type === 'doc') {
        if (Array.isArray(node.content)) {
          const innerText = extractTextFromProsemirror(node.content as ProsemirrorNode[])
          if (innerText) {
            parts.push(innerText)
          }
        }
        // Add newline between paragraphs
        if (node.type === 'paragraph') {
          parts.push('\n\n')
        }
      } else if (node.type === 'hardBreak') {
        parts.push('\n')
      } else if (Array.isArray(node.content)) {
        const innerText = extractTextFromProsemirror(node.content as ProsemirrorNode[])
        if (innerText) {
          parts.push(innerText)
        }
      }
    }

    return parts.join('').trim()
  }

  // Method 1: JSON-LD Schema.org structured data (most reliable)
  const scripts = document.querySelectorAll('script[type="application/ld+json"]')
  for (const script of scripts) {
    try {
      const data = JSON.parse(script.textContent || '')
      if (data['@type'] === 'Event' && data.description) {
        return data.description
      }
    } catch {
      // Not valid JSON, continue
    }
  }

  // Method 2: __NEXT_DATA__ embedded data
  const nextDataScript = document.querySelector('#__NEXT_DATA__')
  if (nextDataScript) {
    try {
      const data = JSON.parse(nextDataScript.textContent || '')
      // Navigate to event description in Next.js props
      const event = data?.props?.pageProps?.initialData?.event
      if (event?.description) {
        return event.description
      }
      // Try description_mirror (Prosemirror format)
      if (event?.description_mirror) {
        // Extract plain text from Prosemirror doc
        const doc = event.description_mirror
        if (doc?.content) {
          return extractTextFromProsemirror(doc.content as ProsemirrorNode[])
        }
      }
    } catch {
      // Not valid JSON, continue
    }
  }

  // Method 3: Look for description in page meta tags
  const metaDescription = document.querySelector('meta[name="description"]')
  if (metaDescription) {
    const content = metaDescription.getAttribute('content')
    if (content && content.length > 50) {
      return content
    }
  }

  // Method 4: DOM fallback - look for description element
  const descriptionEl = document.querySelector('[data-testid="event-description"]')
  if (descriptionEl) {
    return descriptionEl.textContent?.trim() || null
  }

  return null
}

/**
 * Fetch description from a single Luma event detail page
 */
export async function fetchLumaDescriptionFromDetailPage(
  page: Page,
  eventUrl: string
): Promise<string | null> {
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

    // Wait for JSON-LD scripts to be present
    await page.waitForSelector('script[type="application/ld+json"]', { timeout: 5000, state: 'attached' })

    const description = await page.evaluate(descriptionExtractionScript)

    return description
  } catch (error) {
    console.log(`[Luma Enrichment] Failed to fetch description from ${eventUrl}:`, error)
    return null
  }
}

export interface EnrichmentEvent {
  id: string
  source_url: string
  name: string
}

/**
 * Batch fetch descriptions for multiple Luma events with streaming progress
 *
 * Uses a single browser instance and processes events with controlled concurrency
 * to avoid rate limiting.
 *
 * @param events - Array of events with id and source_url
 * @param concurrency - Number of pages to process in parallel (default: 3)
 * @param delayMs - Delay between batches in milliseconds (default: 1000)
 */
export async function* enrichLumaEventsWithDescriptions(
  events: EnrichmentEvent[],
  concurrency: number = 3,
  delayMs: number = 1000
): AsyncGenerator<DescriptionEnrichProgress | DescriptionEnrichComplete> {
  if (events.length === 0) {
    yield {
      type: 'complete',
      enriched: 0,
      total: 0,
    }
    return
  }

  const { chromium } = await import('playwright')

  const browser: Browser = await chromium.launch({
    headless: true,
  })

  const results: LumaDescriptionResult[] = []
  const errors: Array<{ id: string; error: string }> = []

  try {
    console.log(`[Luma Enrichment] Starting description enrichment for ${events.length} events...`)

    // Process in batches
    for (let i = 0; i < events.length; i += concurrency) {
      const batch = events.slice(i, i + concurrency)

      // Process batch in parallel
      const batchResults = await Promise.all(
        batch.map(async (event) => {
          const page = await browser.newPage()
          try {
            const description = await fetchLumaDescriptionFromDetailPage(page, event.source_url)
            if (description) {
              console.log(`[Luma Enrichment] Found description for ${event.name}`)
            }
            return { eventId: event.id, description, name: event.name, success: !!description }
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error'
            console.log(`[Luma Enrichment] Error for ${event.name}: ${errorMsg}`)
            return { eventId: event.id, description: null, name: event.name, error: errorMsg, success: false }
          } finally {
            await page.close()
          }
        })
      )

      // Track results and errors
      for (const result of batchResults) {
        results.push({
          eventId: result.eventId,
          description: result.description,
          error: result.error,
        })

        if (result.error) {
          errors.push({ id: result.eventId, error: result.error })
        }

        // Yield progress for each event
        yield {
          type: 'progress',
          current: results.length,
          total: events.length,
          eventName: result.name,
          success: result.success,
          error: result.error,
        }
      }

      // Delay between batches (except after last batch)
      if (i + concurrency < events.length) {
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }

      console.log(`[Luma Enrichment] Progress: ${Math.min(i + concurrency, events.length)}/${events.length}`)
    }

    // Final completion message
    const enriched = results.filter((r) => r.description).length
    yield {
      type: 'complete',
      enriched,
      total: events.length,
      errors: errors.length > 0 ? errors : undefined,
    }

    console.log(`[Luma Enrichment] Completed. Found descriptions for ${enriched}/${events.length} events`)
  } finally {
    await browser.close()
  }
}

/**
 * Get description results (non-streaming version)
 */
export async function enrichLumaDescriptionsBatch(
  events: EnrichmentEvent[],
  concurrency: number = 3,
  delayMs: number = 1000
): Promise<LumaDescriptionResult[]> {
  const results: LumaDescriptionResult[] = []

  for await (const update of enrichLumaEventsWithDescriptions(events, concurrency, delayMs)) {
    if (update.type === 'progress') {
      // Collect results from progress updates
      const event = events.find((_, idx) => idx === update.current - 1)
      if (event) {
        results.push({
          eventId: event.id,
          description: update.success ? 'fetched' : null, // Placeholder
          error: update.error,
        })
      }
    }
  }

  return results
}
