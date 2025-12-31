import { createServerFn } from '@tanstack/react-start'
import {
  type EventbriteEvent,
  transformEventbriteEvent,
  fetchEventbriteEvents,
  filterInPersonEvents,
  filterByDateRange as filterEventbriteByDateRange,
} from '../../scrapers/eventbrite'
import { enrichEventbriteEventsBatch, extractEventbriteVenuesBatch } from '../../scrapers/eventbrite/enrichment'
import { categorizeEvent } from '../../scrapers/ai-categorizer'
import { matchVenue, type VenueMatchResult } from '../../scrapers/venue-matcher'
import { upsertEvents, supabase, getEventById, updateEvent, createVenue } from '../../db/client'
import { generateEmbedding } from '../../ai/embeddings'
import { requireAdminAccess } from '../utils'
import type { EventInsert } from '../../types'

export interface EventbritePreviewEvent {
  eventbrite: EventbriteEvent
  transformed: EventInsert
  venueMatch: VenueMatchResult
}

// Re-export EventbriteEvent type for client use
export type { EventbriteEvent }

// Import streaming types
export interface ImportProgress {
  type: 'progress'
  current: number
  total: number
  eventName: string
  phase: 'categorizing' | 'embedding' | 'importing'
}

export interface ImportComplete {
  type: 'complete'
  inserted: number
  updated: number
  venuesCreated: number
}

export type ImportUpdate = ImportProgress | ImportComplete

// Venue enrichment streaming types
export interface VenueEnrichProgress {
  type: 'progress'
  current: number
  total: number
  eventName: string
  action: 'matched' | 'created' | 'error'
  venueName?: string
}

export interface VenueEnrichComplete {
  type: 'complete'
  enriched: number
  venuesCreated: number
  total: number
  errors: Array<{ id: string; error: string }>
}

export type VenueEnrichUpdate = VenueEnrichProgress | VenueEnrichComplete

/**
 * Fetch Eventbrite events server-side (to avoid CORS/bot protection)
 * Includes filtering for in-person events and date range, plus venue matching
 */
export const fetchEventbriteEventsAction = createServerFn({ method: 'POST' })
  .inputValidator((data: { startDate: string; endDate: string }) => data)
  .handler(async ({ data: { startDate, endDate } }): Promise<{ events: EventbritePreviewEvent[] }> => {
    console.log('[Admin] Fetching Eventbrite events server-side...')

    // Fetch all events from Eventbrite (server-side to avoid 503 blocking)
    const allEvents = await fetchEventbriteEvents()
    console.log(`[Admin] Fetched ${allEvents.length} total events from Eventbrite`)

    // Filter for in-person events only
    const inPersonEvents = filterInPersonEvents(allEvents)
    console.log(`[Admin] ${inPersonEvents.length} in-person events after filtering`)

    // Filter by date range
    const filteredEvents = filterEventbriteByDateRange(inPersonEvents, startDate, endDate)
    console.log(`[Admin] ${filteredEvents.length} events in date range ${startDate} to ${endDate}`)

    // Match venues and transform events
    const previews: EventbritePreviewEvent[] = await Promise.all(
      filteredEvents.map(async (event) => {
        const venueName = event.location?.name || ''
        const venueMatch = await matchVenue(venueName)
        const transformed = transformEventbriteEvent(
          event,
          venueMatch.venue?.id || null
        )

        return {
          eventbrite: event,
          transformed,
          venueMatch,
        }
      })
    )

    return { events: previews }
  })

/**
 * Process raw Eventbrite events and do venue matching
 * @deprecated Use fetchEventbriteEventsAction instead which fetches server-side
 */
export const processEventbriteEventsAction = createServerFn({ method: 'POST' })
  .inputValidator((data: { events: EventbriteEvent[] }) => data)
  .handler(async ({ data: { events } }): Promise<EventbritePreviewEvent[]> => {
    // Match venues and transform events
    const previews: EventbritePreviewEvent[] = await Promise.all(
      events.map(async (event) => {
        // Use venue name for matching (Eventbrite provides full venue info)
        const venueName = event.location?.name || ''
        const venueMatch = await matchVenue(venueName)
        const transformed = transformEventbriteEvent(
          event,
          venueMatch.venue?.id || null
        )

        return {
          eventbrite: event,
          transformed,
          venueMatch,
        }
      })
    )

    return previews
  })

/**
 * Import a batch of events from Eventbrite data
 * Processes events in small batches to avoid timeouts
 * Uses async generator to stream progress updates to the client
 */
export const importEventbriteEventsBatchAction = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: { events: Array<{ eventbriteEvent: EventbriteEvent; venueId: string | null }> }) => data
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
    for (const { eventbriteEvent, venueId } of data.events) {
      let finalVenueId = venueId

      // If no venue matched but we have venue data, try to match or create
      if (!finalVenueId && eventbriteEvent.location?.name) {
        const venueName = eventbriteEvent.location.name
        // Try to match venue by name first
        const venueMatch = await matchVenue(venueName)
        if (venueMatch.venue) {
          finalVenueId = venueMatch.venue.id
        } else {
          // Auto-create venue with full details from JSON-LD
          try {
            const address = eventbriteEvent.location.address
            const addressParts = [
              address?.streetAddress,
              address?.addressLocality,
            ].filter(Boolean)

            const newVenue = await createVenue({
              name: venueName,
              neighborhood: null, // Could try to infer from addressLocality
              address: addressParts.length > 0 ? addressParts.join(', ') : null,
              // Note: lat/lng not stored - could add to Venue schema in future
            }, client)
            finalVenueId = newVenue.id
            venuesCreated++
            console.log(`[Admin] Auto-created venue for Eventbrite: "${venueName}"`)
          } catch (error) {
            console.error(`[Admin] Failed to create venue "${venueName}":`, error)
          }
        }
      }

      eventsToImport.push(transformEventbriteEvent(eventbriteEvent, finalVenueId))
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

      const textForEmbedding = [
        event.name,
        event.description_es,
        category,
      ]
        .filter(Boolean)
        .join(' ')

      const embedding = await generateEmbedding(textForEmbedding)
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
// EVENTBRITE ENRICHMENT
// ============================================================================

/**
 * Get Eventbrite events that need enrichment (missing categories or have empty categories)
 */
export const getEventbriteEventsNeedingEnrichmentAction = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ events: Array<{ id: string; link: string; name: string; description_es: string | null }> }> => {
    const { data, error } = await supabase
      .from('events')
      .select('id, link, name, description_es')
      .eq('source', 'eventbrite')
      .or('categories.is.null,categories.eq.{}')
      .not('link', 'is', null)
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) {
      console.error('[Admin] Error fetching Eventbrite events needing enrichment:', error)
      return { events: [] }
    }

    return { events: data || [] }
  }
)

export interface EventbriteEnrichmentInput {
  id: string
  link: string
  name: string
  description_es: string | null
}

export interface EventbriteEnrichmentOutput {
  success: boolean
  enriched: number
  total: number
  errors: Array<{ id: string; error: string }>
}

/**
 * Enrich Eventbrite events with price and categories
 * Uses web scraping for price and AI inference for categories
 */
export const enrichEventbriteEventsAction = createServerFn({ method: 'POST' })
  .inputValidator((data: { events: EventbriteEnrichmentInput[] }) => data)
  .handler(async ({ data }): Promise<EventbriteEnrichmentOutput> => {
    const client = await requireAdminAccess()
    const { events } = data

    if (events.length === 0) {
      return { success: true, enriched: 0, total: 0, errors: [] }
    }

    console.log(`[Admin] Starting Eventbrite enrichment for ${events.length} events...`)

    // Enrich events using batch function
    const results = await enrichEventbriteEventsBatch(events)

    let enriched = 0
    const errors: Array<{ id: string; error: string }> = []

    // Update each event with enriched data
    for (const result of results) {
      if (result.error) {
        errors.push({ id: result.id, error: result.error })
        continue
      }

      try {
        // Get existing event to regenerate embedding
        const existingEvent = await getEventById(result.id)

        // Generate new embedding with updated categories
        const textForEmbedding = [
          existingEvent.name,
          existingEvent.description_es,
          ...result.categories,
        ]
          .filter(Boolean)
          .join(' ')

        const embedding = await generateEmbedding(textForEmbedding)

        // Update event with enriched data
        await updateEvent(result.id, {
          price: result.price,
          is_free: result.is_free,
          categories: result.categories,
          embedding,
        }, client)

        enriched++
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error'
        errors.push({ id: result.id, error: errorMsg })
      }
    }

    console.log(`[Admin] Eventbrite enrichment complete: ${enriched} enriched, ${errors.length} errors`)

    return {
      success: true,
      enriched,
      total: events.length,
      errors,
    }
  })

// ============================================================================
// EVENTBRITE VENUE ENRICHMENT
// ============================================================================

interface EventbriteVenueEnrichmentInput {
  id: string
  link: string
}

/**
 * Enrich Eventbrite events with venue data from detail pages (JSON-LD)
 * Uses async generator to stream progress updates to the client
 */
export const enrichEventbriteVenuesAction = createServerFn({ method: 'POST' })
  .inputValidator((data: { events: EventbriteVenueEnrichmentInput[] }) => data)
  .handler(async function* ({ data }): AsyncGenerator<VenueEnrichUpdate> {
    const client = await requireAdminAccess()
    const { events } = data

    if (events.length === 0) {
      yield { type: 'complete', enriched: 0, venuesCreated: 0, total: 0, errors: [] } as VenueEnrichComplete
      return
    }

    console.log(`[Admin] Starting Eventbrite venue enrichment for ${events.length} events...`)

    // Extract venue info from detail pages
    const extractionResults = await extractEventbriteVenuesBatch(events, 500)

    let enriched = 0
    let venuesCreated = 0
    const errors: Array<{ id: string; error: string }> = []

    // Process each result
    for (let i = 0; i < extractionResults.length; i++) {
      const result = extractionResults[i]

      if (result.error) {
        errors.push({ id: result.id, error: result.error })
        yield {
          type: 'progress',
          current: i + 1,
          total: events.length,
          eventName: result.id,
          action: 'error',
        } as VenueEnrichProgress
        continue
      }

      if (!result.venue) {
        errors.push({ id: result.id, error: 'Could not extract venue from page JSON-LD' })
        yield {
          type: 'progress',
          current: i + 1,
          total: events.length,
          eventName: result.id,
          action: 'error',
        } as VenueEnrichProgress
        continue
      }

      try {
        // Try to match to existing venue
        const venueMatch = await matchVenue(result.venue.name)

        let venueId: string
        let action: 'matched' | 'created' = 'matched'

        if (venueMatch.venue) {
          // Use existing venue
          venueId = venueMatch.venue.id
        } else {
          // Create new venue with full details from JSON-LD
          const newVenue = await createVenue({
            name: result.venue.name,
            address: result.venue.address,
            neighborhood: null,
            // Note: lat/lng not stored - could add to Venue schema in future
          }, client)
          venueId = newVenue.id
          venuesCreated++
          action = 'created'
          console.log(`[Admin] Created new venue: ${result.venue.name}`)
        }

        // Update event with venue_id
        await updateEvent(result.id, { venue_id: venueId }, client)
        enriched++

        // Yield progress update
        yield {
          type: 'progress',
          current: i + 1,
          total: events.length,
          eventName: result.id,
          action,
          venueName: result.venue.name,
        } as VenueEnrichProgress
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error'
        errors.push({ id: result.id, error: errorMsg })

        // Yield error progress
        yield {
          type: 'progress',
          current: i + 1,
          total: events.length,
          eventName: result.id,
          action: 'error',
          venueName: result.venue.name,
        } as VenueEnrichProgress
      }
    }

    console.log(`[Admin] Eventbrite venue enrichment complete: ${enriched} enriched, ${venuesCreated} venues created, ${errors.length} errors`)

    // Yield final completion result
    yield {
      type: 'complete',
      enriched,
      venuesCreated,
      total: events.length,
      errors,
    } as VenueEnrichComplete
  })
