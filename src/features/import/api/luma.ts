import { createServerFn } from '@tanstack/react-start'
import {
  type LumaEvent,
  transformLumaEvent,
  fetchLumaEvents,
  filterByDateRange as filterLumaByDateRange,
} from '../scrapers/luma'
import { categorizeEvent } from '../scrapers/ai-categorizer'
import { matchVenue, type VenueMatchResult } from '../scrapers/venue-matcher'
import { upsertEvents, createVenue, supabase, updateEvent } from '@/shared/lib/db/client'
import { generateEventEmbedding } from '@/shared/lib/ai/embeddings'
import { requireAdminAccess } from '@/shared/lib/admin-utils'
import type { EventInsert } from '@/shared/lib/types'
import type {
  ImportProgress,
  ImportComplete,
  ImportUpdate,
  DescriptionEnrichProgress,
  DescriptionEnrichComplete,
  DescriptionEnrichUpdate,
  VenueEnrichProgress,
  VenueEnrichComplete,
  VenueEnrichUpdate,
} from '@/shared/lib/streaming-types'

export interface LumaPreviewEvent {
  luma: LumaEvent
  transformed: EventInsert
  venueMatch: VenueMatchResult
}

// Re-export LumaEvent type for client use
export type { LumaEvent }

// Re-export streaming types
export type { ImportProgress, ImportComplete, ImportUpdate, DescriptionEnrichProgress, DescriptionEnrichComplete, DescriptionEnrichUpdate, VenueEnrichProgress, VenueEnrichComplete, VenueEnrichUpdate }

/**
 * Fetch Luma events server-side
 * Includes filtering by date range and venue matching
 */
export const fetchLumaEventsAction = createServerFn({ method: 'POST' })
  .inputValidator((data: { startDate: string; endDate: string }) => data)
  .handler(async ({ data: { startDate, endDate } }): Promise<{ events: LumaPreviewEvent[] }> => {
    console.log('[Admin] Fetching Luma events server-side...')

    // Fetch all events from Luma
    const allEvents = await fetchLumaEvents()
    console.log(`[Admin] Fetched ${allEvents.length} total events from Luma`)

    // Filter by date range
    const filteredEvents = filterLumaByDateRange(allEvents, startDate, endDate)
    console.log(`[Admin] ${filteredEvents.length} events in date range ${startDate} to ${endDate}`)

    // Match venues and transform events
    const previews: LumaPreviewEvent[] = await Promise.all(
      filteredEvents.map(async (event) => {
        const venueName = event.venue?.name || ''
        const venueMatch = await matchVenue(venueName)
        const transformed = transformLumaEvent(
          event,
          venueMatch.venue?.id || null
        )

        return {
          luma: event,
          transformed,
          venueMatch,
        }
      })
    )

    return { events: previews }
  })

/**
 * Import a batch of events from Luma data
 * Processes events with AI categorization and embeddings
 * Uses async generator to stream progress updates to the client
 */
export const importLumaEventsBatchAction = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: { events: Array<{ lumaEvent: LumaEvent; venueId: string | null }> }) => data
  )
  .handler(async function* ({ data }): AsyncGenerator<ImportUpdate> {
    const client = await requireAdminAccess()

    if (data.events.length === 0) {
      yield { type: 'complete', inserted: 0, updated: 0, venuesCreated: 0 } as ImportComplete
      return
    }

    let venuesCreated = 0
    const total = data.events.length

    // Transform events, auto-creating venues when needed
    const eventsToImport: EventInsert[] = []
    for (const { lumaEvent, venueId } of data.events) {
      let finalVenueId = venueId

      // If no venue matched but we have venue data, try to match or create
      if (!finalVenueId && lumaEvent.venue?.name) {
        const venueName = lumaEvent.venue.name
        // Try to match venue by name first
        const venueMatch = await matchVenue(venueName)
        if (venueMatch.venue) {
          finalVenueId = venueMatch.venue.id
        } else {
          // Auto-create venue with full details from Luma
          try {
            const addressParts = [
              lumaEvent.venue.address,
              lumaEvent.venue.city,
            ].filter(Boolean)

            const newVenue = await createVenue({
              name: venueName,
              neighborhood: null, // Could try to infer from city/address
              address: addressParts.length > 0 ? addressParts.join(', ') : null,
            }, client)
            finalVenueId = newVenue.id
            venuesCreated++
            console.log(`[Admin] Auto-created venue for Luma: "${venueName}"`)
          } catch (error) {
            console.error(`[Admin] Failed to create venue "${venueName}":`, error)
          }
        }
      }

      eventsToImport.push(transformLumaEvent(lumaEvent, finalVenueId))
    }

    // AI categorize and generate embeddings sequentially to avoid rate limits
    const eventsWithEmbeddings: EventInsert[] = []
    for (let i = 0; i < eventsToImport.length; i++) {
      const event = eventsToImport[i]

      // Yield categorizing progress
      yield {
        type: 'progress',
        current: i + 1,
        total,
        eventName: event.name,
        phase: 'categorizing',
      } as ImportProgress

      // Categorize via AI
      const category = await categorizeEvent(event.name, event.description_es)

      // Yield embedding progress
      yield {
        type: 'progress',
        current: i + 1,
        total,
        eventName: event.name,
        phase: 'embedding',
      } as ImportProgress

      const embedding = await generateEventEmbedding({
        name: event.name,
        description_es: event.description_es,
        categories: [category],
      })
      eventsWithEmbeddings.push({ ...event, categories: [category], embedding })
    }

    // Yield importing progress
    yield {
      type: 'progress',
      current: total,
      total,
      eventName: 'Saving to database...',
      phase: 'importing',
    } as ImportProgress

    // Upsert events (insert new, update existing)
    const result = await upsertEvents(eventsWithEmbeddings, client)

    // Yield final completion result
    yield {
      type: 'complete',
      ...result,
      venuesCreated,
    } as ImportComplete
  })

// ============================================================================
// LUMA DESCRIPTION ENRICHMENT
// ============================================================================

/**
 * Fetch Luma events that need description enrichment
 * Returns events where description is null or empty
 */
export const getLumaEventsNeedingDescriptionEnrichmentAction = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ events: Array<{ id: string; source_url: string; name: string }> }> => {
    const { data, error } = await supabase
      .from('events')
      .select('id, source_url, name')
      .eq('source', 'luma')
      .or('description_es.is.null,description_es.eq.')
      .not('source_url', 'is', null)
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) {
      console.error('[Admin] Error fetching Luma events needing description enrichment:', error)
      return { events: [] }
    }

    return { events: (data || []).filter(e => e.source_url) as Array<{ id: string; source_url: string; name: string }> }
  }
)

export interface LumaDescriptionEnrichmentInput {
  eventId: string
  source_url: string
  name: string
}

/**
 * Enrich Luma events with descriptions by visiting individual event pages.
 * This is Phase 2 of the two-phase import process for Luma.
 * Uses async generator to stream progress updates to the client
 *
 * For each event:
 * 1. Fetches description from the Luma event detail page
 * 2. Updates the event with the description
 * 3. Regenerates the embedding with the new description
 */
export const enrichLumaDescriptionsAction = createServerFn({ method: 'POST' })
  .inputValidator((data: { events: LumaDescriptionEnrichmentInput[] }) => data)
  .handler(async function* ({ data }): AsyncGenerator<DescriptionEnrichUpdate> {
    const client = await requireAdminAccess()
    const { events } = data

    if (events.length === 0) {
      yield { type: 'complete', enriched: 0, total: 0 } as DescriptionEnrichComplete
      return
    }

    console.log(`[Admin] Starting Luma description enrichment for ${events.length} events...`)

    const { chromium } = await import('playwright')
    const { fetchLumaDescriptionFromDetailPage } = await import('../scrapers/luma')

    const browser = await chromium.launch({ headless: true })
    let enriched = 0
    const errors: Array<{ id: string; error: string }> = []

    try {
      const concurrency = 3
      const delayMs = 1000

      // Process in batches for concurrency control
      for (let i = 0; i < events.length; i += concurrency) {
        const batch = events.slice(i, i + concurrency)

        // Process batch in parallel
        const batchResults = await Promise.all(
          batch.map(async (event) => {
            const page = await browser.newPage()
            try {
              const description = await fetchLumaDescriptionFromDetailPage(page, event.source_url)

              if (description) {
                // Update event with description
                await updateEvent(event.eventId, { description_es: description }, client)

                // Regenerate embedding with new description
                const { data: eventData } = await supabase
                  .from('events')
                  .select('name, categories')
                  .eq('id', event.eventId)
                  .single()

                if (eventData) {
                  const embedding = await generateEventEmbedding({
                    name: eventData.name,
                    description_es: description,
                    categories: eventData.categories || [],
                  })
                  await updateEvent(event.eventId, { embedding }, client)
                }

                console.log(`[Admin] Enriched description for: ${event.name}`)
                return { event, success: true, error: undefined }
              } else {
                return { event, success: false, error: 'No description found on page' }
              }
            } catch (error) {
              const errorMsg = error instanceof Error ? error.message : 'Unknown error'
              console.error(`[Admin] Error enriching ${event.name}:`, errorMsg)
              return { event, success: false, error: errorMsg }
            } finally {
              await page.close()
            }
          })
        )

        // Process results and yield progress
        for (const result of batchResults) {
          if (result.success) {
            enriched++
          } else if (result.error) {
            errors.push({ id: result.event.eventId, error: result.error })
          }

          // Calculate current progress (account for batch position)
          const currentIndex = events.indexOf(result.event) + 1

          yield {
            type: 'progress',
            current: currentIndex,
            total: events.length,
            eventName: result.event.name,
            success: result.success,
            error: result.error,
          } as DescriptionEnrichProgress
        }

        // Delay between batches (except after last batch)
        if (i + concurrency < events.length) {
          await new Promise((resolve) => setTimeout(resolve, delayMs))
        }
      }
    } finally {
      await browser.close()
    }

    console.log(`[Admin] Luma description enrichment complete: ${enriched} enriched, ${errors.length} errors`)

    // Yield final completion result
    yield {
      type: 'complete',
      enriched,
      total: events.length,
      errors: errors.length > 0 ? errors : undefined,
    } as DescriptionEnrichComplete
  })

// ============================================================================
// LUMA VENUE ENRICHMENT
// ============================================================================

export interface LumaVenueEnrichmentInput {
  eventId: string
  eventUrl: string
  eventName?: string
}

/**
 * Enrich Luma events with venue data by visiting individual event pages.
 * Used for events that were imported without venue information.
 *
 * For each event:
 * 1. Fetches venue from the Luma event detail page
 * 2. Matches to existing venue or creates a new one
 * 3. Updates the event with the venue_id
 */
export const enrichLumaVenuesAction = createServerFn({ method: 'POST' })
  .inputValidator((data: { events: LumaVenueEnrichmentInput[] }) => data)
  .handler(async function* ({ data }): AsyncGenerator<VenueEnrichUpdate> {
    const client = await requireAdminAccess()
    const { events } = data

    if (events.length === 0) {
      yield { type: 'complete', enriched: 0, venuesCreated: 0, total: 0, errors: [] } as VenueEnrichComplete
      return
    }

    console.log(`[Admin] Starting Luma venue enrichment for ${events.length} events...`)

    const { chromium } = await import('playwright')
    const { fetchLumaVenueFromDetailPage } = await import('../scrapers/luma')

    const browser = await chromium.launch({ headless: true })
    let enriched = 0
    let venuesCreated = 0
    const errors: Array<{ id: string; error: string }> = []

    try {
      const concurrency = 3
      const delayMs = 1000

      // Process in batches for concurrency control
      for (let i = 0; i < events.length; i += concurrency) {
        const batch = events.slice(i, i + concurrency)

        // Process batch in parallel
        const batchResults = await Promise.all(
          batch.map(async (event) => {
            const page = await browser.newPage()
            try {
              const venue = await fetchLumaVenueFromDetailPage(page, event.eventUrl)

              if (venue) {
                // Try to match existing venue first
                const venueMatch = await matchVenue(venue.name)
                let venueId: string
                let action: 'matched' | 'created' = 'matched'

                if (venueMatch.venue) {
                  venueId = venueMatch.venue.id
                } else {
                  // Create new venue
                  const newVenue = await createVenue({
                    name: venue.name,
                    address: venue.address,
                    neighborhood: null,
                  }, client)
                  venueId = newVenue.id
                  action = 'created'
                }

                // Update event with venue_id
                await updateEvent(event.eventId, { venue_id: venueId }, client)

                console.log(`[Admin] ${action === 'created' ? 'Created' : 'Matched'} venue "${venue.name}" for: ${event.eventName || event.eventId}`)
                return { event, venue, venueId, action, success: true, error: undefined }
              } else {
                return { event, venue: null, venueId: null, action: 'error' as const, success: false, error: 'No venue found on page' }
              }
            } catch (error) {
              const errorMsg = error instanceof Error ? error.message : 'Unknown error'
              console.error(`[Admin] Error enriching venue for ${event.eventName || event.eventId}:`, errorMsg)
              return { event, venue: null, venueId: null, action: 'error' as const, success: false, error: errorMsg }
            } finally {
              await page.close()
            }
          })
        )

        // Process results and yield progress
        for (const result of batchResults) {
          if (result.success && result.venue) {
            enriched++
            if (result.action === 'created') {
              venuesCreated++
            }
          } else if (result.error) {
            errors.push({ id: result.event.eventId, error: result.error })
          }

          // Calculate current progress (account for batch position)
          const currentIndex = events.indexOf(result.event) + 1

          yield {
            type: 'progress',
            current: currentIndex,
            total: events.length,
            eventName: result.event.eventName || result.event.eventId,
            action: result.action,
            venueName: result.venue?.name,
          } as VenueEnrichProgress
        }

        // Delay between batches (except after last batch)
        if (i + concurrency < events.length) {
          await new Promise((resolve) => setTimeout(resolve, delayMs))
        }
      }
    } finally {
      await browser.close()
    }

    console.log(`[Admin] Luma venue enrichment complete: ${enriched} enriched, ${venuesCreated} created, ${errors.length} errors`)

    // Yield final completion result
    yield {
      type: 'complete',
      enriched,
      venuesCreated,
      total: events.length,
      errors,
    } as VenueEnrichComplete
  })
