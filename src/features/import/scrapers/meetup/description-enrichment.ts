/**
 * Meetup Description Enrichment
 *
 * Fetches full event descriptions from individual Meetup event pages.
 * The search/list page GraphQL often returns null descriptions - full descriptions
 * are only available on individual event pages.
 *
 * Uses simple fetch + HTML parsing instead of Playwright for serverless compatibility.
 * __NEXT_DATA__ contains the complete event data including full descriptions.
 *
 * Note: This approach bypasses the Jina Reader which returns 451 errors for Meetup.
 */

import type {
  DescriptionEnrichProgress,
  DescriptionEnrichComplete,
} from '@/shared/lib/streaming-types'
import {
  extractNextData,
  getNestedValue,
  fetchHtml,
} from '@/shared/lib/html-parsing'

export interface MeetupDescriptionResult {
  eventId: string
  description: string | null
  error?: string
}

/**
 * Extract description from Meetup's __NEXT_DATA__
 * Path: props.pageProps.event.description
 */
function extractDescriptionFromNextData(nextData: unknown): string | null {
  // Navigate to event description in Next.js props
  const description = getNestedValue(nextData, 'props.pageProps.event.description')

  if (typeof description === 'string' && description.trim()) {
    return description.trim()
  }

  return null
}

/**
 * Extract description data from HTML content
 * Uses __NEXT_DATA__ which contains the complete event data
 *
 * Note: JSON-LD and meta descriptions are truncated on Meetup, so we only use __NEXT_DATA__
 */
function extractDescriptionFromHtml(html: string): string | null {
  const nextData = extractNextData(html)
  if (nextData) {
    return extractDescriptionFromNextData(nextData)
  }

  return null
}

/**
 * Fetch description from a single Meetup event detail page
 * Uses simple fetch instead of Jina Reader (which returns 451 for Meetup)
 */
export async function fetchMeetupDescriptionFromDetailPage(
  eventUrl: string
): Promise<string | null> {
  // Ensure URL is properly formed
  let fullUrl = eventUrl
  if (!fullUrl.startsWith('http')) {
    fullUrl = `https://www.meetup.com${fullUrl.startsWith('/') ? '' : '/'}${fullUrl}`
  }

  const html = await fetchHtml(fullUrl)
  if (!html) return null

  return extractDescriptionFromHtml(html)
}

export interface DescriptionEnrichmentEvent {
  id: string
  eventUrl: string
  name: string
}

/**
 * Batch fetch descriptions for multiple Meetup events with streaming progress
 *
 * Processes events with controlled concurrency to avoid rate limiting.
 * Uses fetch instead of Jina Reader for Meetup compatibility.
 *
 * @param events - Array of events with id and eventUrl
 * @param concurrency - Number of requests to process in parallel (default: 3)
 * @param delayMs - Delay between batches in milliseconds (default: 1000)
 */
export async function* enrichMeetupEventsWithDescriptions(
  events: DescriptionEnrichmentEvent[],
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

  const results: MeetupDescriptionResult[] = []
  const errors: Array<{ id: string; error: string }> = []

  console.log(
    `[Meetup Description Enrichment] Starting description enrichment for ${events.length} events...`
  )

  // Process in batches
  for (let i = 0; i < events.length; i += concurrency) {
    const batch = events.slice(i, i + concurrency)

    // Process batch in parallel
    const batchResults = await Promise.all(
      batch.map(async (event) => {
        try {
          const description = await fetchMeetupDescriptionFromDetailPage(event.eventUrl)
          if (description) {
            console.log(
              `[Meetup Description Enrichment] Found description for ${event.name} (${description.length} chars)`
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
            `[Meetup Description Enrichment] Error for ${event.name}: ${errorMsg}`
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
      `[Meetup Description Enrichment] Progress: ${Math.min(i + concurrency, events.length)}/${events.length}`
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
    `[Meetup Description Enrichment] Completed. Found descriptions for ${enriched}/${events.length} events`
  )
}

/**
 * Get description results (non-streaming version)
 */
export async function enrichMeetupDescriptionsBatch(
  events: DescriptionEnrichmentEvent[],
  concurrency: number = 3,
  delayMs: number = 1000
): Promise<MeetupDescriptionResult[]> {
  const results: MeetupDescriptionResult[] = []

  for await (const update of enrichMeetupEventsWithDescriptions(
    events,
    concurrency,
    delayMs
  )) {
    if (update.type === 'progress') {
      // Find the event that was just processed
      const eventIndex = update.current - 1
      const event = events[eventIndex]
      if (event) {
        // Get actual description from the batch processing
        const existingResult = results.find((r) => r.eventId === event.id)
        if (!existingResult) {
          results.push({
            eventId: event.id,
            description: update.success ? null : null, // Will be filled by caller
            error: update.error,
          })
        }
      }
    }
  }

  return results
}
