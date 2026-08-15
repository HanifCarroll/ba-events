/**
 * Luma Description Enrichment
 *
 * Fetches full event descriptions from individual Luma event pages.
 * The Buenos Aires listing page only shows event titles - descriptions
 * are only available on individual event pages.
 *
 * Uses simple fetch + HTML parsing instead of Playwright for serverless compatibility.
 * JSON-LD and __NEXT_DATA__ are embedded in the initial HTML response.
 */

import type {
  DescriptionEnrichProgress,
  DescriptionEnrichComplete,
} from '#shared/lib/streaming-types.ts'
import {
  extractNextData,
  getNestedValue,
  findJsonLdByType,
  extractMetaContent,
  fetchHtml,
} from '#shared/lib/html-parsing.ts'

export interface LumaDescriptionResult {
  eventId: string
  description: string | null
  error?: string
}

// Type for Prosemirror nodes
type ProsemirrorNode = { type: string; text?: string; content?: ProsemirrorNode[] }

/**
 * Extract text from Prosemirror document format
 * Luma stores descriptions in Prosemirror format in description_mirror
 */
function extractTextFromProsemirror(content: ProsemirrorNode[]): string {
  const parts: string[] = []

  for (const node of content) {
    if (node.type === 'text' && node.text) {
      parts.push(node.text)
    } else if (node.type === 'paragraph' || node.type === 'doc') {
      if (Array.isArray(node.content)) {
        const innerText = extractTextFromProsemirror(node.content)
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
      const innerText = extractTextFromProsemirror(node.content)
      if (innerText) {
        parts.push(innerText)
      }
    }
  }

  return parts.join('').trim()
}

/**
 * Extract description from __NEXT_DATA__
 */
function extractDescriptionFromNextData(nextData: unknown): string | null {
  // Navigate to event description in Next.js props
  const event = getNestedValue(nextData, 'props.pageProps.initialData.event') as
    | Record<string, unknown>
    | undefined

  if (!event) return null

  // Try plain description first
  if (typeof event.description === 'string' && event.description) {
    return event.description
  }

  // Try description_mirror (Prosemirror format)
  const descMirror = event.description_mirror as { content?: ProsemirrorNode[] } | undefined
  if (descMirror?.content) {
    return extractTextFromProsemirror(descMirror.content)
  }

  return null
}

/**
 * Extract description from JSON-LD structured data
 */
function extractDescriptionFromJsonLd(html: string): string | null {
  const eventData = findJsonLdByType(html, 'Event') as Record<string, unknown> | null
  if (eventData?.description && typeof eventData.description === 'string') {
    return eventData.description
  }
  return null
}

/**
 * Extract description data from HTML content
 * Tries __NEXT_DATA__ first (most reliable), then JSON-LD, then meta tags
 */
function extractDescriptionFromHtml(html: string): string | null {
  // Method 1: __NEXT_DATA__ embedded data (most reliable for full descriptions)
  const nextData = extractNextData(html)
  if (nextData) {
    const description = extractDescriptionFromNextData(nextData)
    if (description) return description
  }

  // Method 2: JSON-LD Schema.org structured data
  const jsonLdDescription = extractDescriptionFromJsonLd(html)
  if (jsonLdDescription) return jsonLdDescription

  // Method 3: Meta description (fallback for simple descriptions)
  const metaDesc = extractMetaContent(html, 'description')
  if (metaDesc && metaDesc.length > 50) {
    return metaDesc
  }

  return null
}

/**
 * Fetch description from a single Luma event detail page
 * Uses simple fetch instead of Playwright - __NEXT_DATA__ is in the initial HTML
 */
export async function fetchLumaDescriptionFromDetailPage(
  eventUrl: string
): Promise<string | null> {
  // Ensure URL is properly formed
  let fullUrl = eventUrl
  if (!fullUrl.startsWith('http')) {
    fullUrl = `https://lu.ma${fullUrl.startsWith('/') ? '' : '/'}${fullUrl}`
  }

  const html = await fetchHtml(fullUrl)
  if (!html) return null

  return extractDescriptionFromHtml(html)
}

export interface EnrichmentEvent {
  id: string
  source_url: string
  name: string
}

/**
 * Batch fetch descriptions for multiple Luma events with streaming progress
 *
 * Processes events with controlled concurrency to avoid rate limiting.
 * Uses fetch instead of Playwright for serverless compatibility.
 *
 * @param events - Array of events with id and source_url
 * @param concurrency - Number of requests to process in parallel (default: 3)
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

  const results: LumaDescriptionResult[] = []
  const errors: Array<{ id: string; error: string }> = []

  console.log(
    `[Luma Description Enrichment] Starting description enrichment for ${events.length} events...`
  )

  // Process in batches
  for (let i = 0; i < events.length; i += concurrency) {
    const batch = events.slice(i, i + concurrency)

    // Process batch in parallel
    const batchResults = await Promise.all(
      batch.map(async (event) => {
        try {
          const description = await fetchLumaDescriptionFromDetailPage(event.source_url)
          if (description) {
            console.log(
              `[Luma Description Enrichment] Found description for ${event.name}`
            )
          }
          return {
            eventId: event.id,
            description,
            name: event.name,
            success: !!description,
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error'
          console.log(
            `[Luma Description Enrichment] Error for ${event.name}: ${errorMsg}`
          )
          return {
            eventId: event.id,
            description: null,
            name: event.name,
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

    console.log(
      `[Luma Description Enrichment] Progress: ${Math.min(i + concurrency, events.length)}/${events.length}`
    )
  }

  // Final completion message
  const enriched = results.filter((r) => r.description).length
  yield {
    type: 'complete',
    enriched,
    total: events.length,
    errors: errors.length > 0 ? errors : undefined,
  }

  console.log(
    `[Luma Description Enrichment] Completed. Found descriptions for ${enriched}/${events.length} events`
  )
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

  for await (const update of enrichLumaEventsWithDescriptions(
    events,
    concurrency,
    delayMs
  )) {
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
