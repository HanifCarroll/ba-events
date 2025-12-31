import { createServerFn } from '@tanstack/react-start'
import {
  type MeetupEvent,
  scrapeMeetupEvents,
  transformMeetupEventWithExpansion,
  enrichMeetupEventsWithVenues,
} from '../../scrapers/meetup'
import { categorizeEvent } from '../../scrapers/ai-categorizer'
import { matchVenue, type VenueMatchResult } from '../../scrapers/venue-matcher'
import { upsertEvents, supabase, updateEvent, createVenue } from '../../db/client'
import { generateEmbedding } from '../../ai/embeddings'
import { requireAdminAccess } from '../utils'
import type { EventInsert } from '../../types'

export interface MeetupPreviewEvent {
  meetup: MeetupEvent
  transformed: EventInsert[]
  venueMatch: VenueMatchResult
  dateCount: number
  alreadyImported: boolean
}

export type { MeetupEvent }

export const processMeetupEventsAction = createServerFn({ method: 'POST' })
  .inputValidator((data: { events: MeetupEvent[] }) => data)
  .handler(async ({ data: { events } }): Promise<MeetupPreviewEvent[]> => {
    const previews: MeetupPreviewEvent[] = await Promise.all(
      events.map(async (event) => {
        const venueName = event.venue?.name || ''
        const venueMatch = await matchVenue(venueName)
        const transformed = transformMeetupEventWithExpansion(
          event,
          venueMatch.venue?.id || null,
          4 // 4 weeks ahead for recurring events
        )

        return {
          meetup: event,
          transformed,
          venueMatch,
          dateCount: transformed.length,
          alreadyImported: false, // This action doesn't check DB, so default to false
        }
      })
    )

    return previews
  })

export const fetchMeetupEventsAction = createServerFn({ method: 'POST' })
  .inputValidator((data: { startDate: string; endDate: string }) => data)
  .handler(async ({ data }): Promise<{ events: MeetupPreviewEvent[] }> => {
    try {
      console.log(`[Admin] Starting Meetup fetch for ${data.startDate} to ${data.endDate}...`)

      // Scraper now handles date range and in-person filtering via URL parameters
      const rawEvents = await scrapeMeetupEvents({
        startDate: data.startDate,
        endDate: data.endDate,
      })
      console.log(`[Admin] Scraped ${rawEvents.length} in-person Meetup events`)

      // Transform events first to get external_ids
      const previewsWithoutImportCheck = await Promise.all(
        rawEvents.map(async (event) => {
          const venueName = event.venue?.name || ''
          const venueMatch = await matchVenue(venueName)
          const transformed = transformMeetupEventWithExpansion(
            event,
            venueMatch.venue?.id || null,
            4
          )

          return {
            meetup: event,
            transformed,
            venueMatch,
            dateCount: transformed.length,
          }
        })
      )

      // Collect all external_ids to check against database
      const allExternalIds = previewsWithoutImportCheck.flatMap(
        (p) => p.transformed.map((t) => t.external_id).filter(Boolean)
      )

      // Check which external_ids already exist in database
      const existingIds = new Set<string>()
      if (allExternalIds.length > 0) {
        const { data: existingEvents } = await supabase
          .from('events')
          .select('external_id')
          .eq('source', 'meetup')
          .in('external_id', allExternalIds)

        if (existingEvents) {
          for (const e of existingEvents) {
            if (e.external_id) existingIds.add(e.external_id)
          }
        }
        console.log(`[Admin] Found ${existingIds.size} already imported events`)
      }

      // Add alreadyImported flag to each preview
      const previews: MeetupPreviewEvent[] = previewsWithoutImportCheck.map((p) => {
        // Check if ANY of the transformed events already exist
        const alreadyImported = p.transformed.some(
          (t) => t.external_id && existingIds.has(t.external_id)
        )
        return { ...p, alreadyImported }
      })

      const alreadyImportedCount = previews.filter((p) => p.alreadyImported).length
      console.log(`[Admin] Returning ${previews.length} Meetup preview events (${alreadyImportedCount} already imported)`)
      return { events: previews }
    } catch (error) {
      console.error('[Admin] Meetup fetch error:', error)
      throw error
    }
  })

export const importMeetupEventsBatchAction = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: {
      events: Array<{
        meetupEvent: MeetupEvent
        venueId: string | null
      }>
    }) => data
  )
  .handler(async ({ data }) => {
    const client = await requireAdminAccess()

    const eventsToImport: EventInsert[] = data.events.flatMap(({ meetupEvent, venueId }) =>
      transformMeetupEventWithExpansion(meetupEvent, venueId, 4)
    )

    if (eventsToImport.length === 0) {
      return { success: true, inserted: 0, updated: 0 }
    }

    // AI categorize and generate embeddings
    const eventsWithEmbeddings: EventInsert[] = []
    for (const event of eventsToImport) {
      // Categorize via AI
      const category = await categorizeEvent(event.name, event.description_es)

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

    const result = await upsertEvents(eventsWithEmbeddings, client)

    return {
      success: true,
      ...result,
    }
  })

// ============================================================================
// MEETUP VENUE ENRICHMENT
// ============================================================================

/**
 * Fetch Meetup events that need venue enrichment (no venue_id set)
 */
export const getMeetupEventsNeedingEnrichmentAction = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ events: Array<{ id: string; link: string }> }> => {
    const { data, error } = await supabase
      .from('events')
      .select('id, link')
      .eq('source', 'meetup')
      .is('venue_id', null)
      .not('link', 'is', null)
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) {
      console.error('[Admin] Error fetching Meetup events needing enrichment:', error)
      return { events: [] }
    }

    return { events: data || [] }
  }
)

export interface MeetupEnrichmentInput {
  eventId: string
  eventUrl: string
}

export interface MeetupEnrichmentOutput {
  success: boolean
  enriched: number
  venuesCreated: number
  errors: Array<{ eventId: string; error: string }>
}

/**
 * Enrich Meetup events with venue information by visiting detail pages.
 * This is Phase 2 of the two-phase import process.
 *
 * For each event:
 * 1. Fetches venue info from the Meetup event detail page
 * 2. Matches the venue to existing venues or creates a new one
 * 3. Updates the event with the venue_id
 */
export const enrichMeetupVenuesAction = createServerFn({ method: 'POST' })
  .inputValidator((data: { events: MeetupEnrichmentInput[] }) => data)
  .handler(async ({ data }): Promise<MeetupEnrichmentOutput> => {
    const client = await requireAdminAccess()
    const { events } = data

    if (events.length === 0) {
      return { success: true, enriched: 0, venuesCreated: 0, errors: [] }
    }

    console.log(`[Admin] Starting Meetup venue enrichment for ${events.length} events...`)

    // Fetch venues from detail pages
    const enrichmentResults = await enrichMeetupEventsWithVenues(
      events.map((e) => ({ id: e.eventId, eventUrl: e.eventUrl })),
      3, // concurrency
      1000 // delay between batches
    )

    let enriched = 0
    let venuesCreated = 0
    const errors: Array<{ eventId: string; error: string }> = []

    // Process each result
    for (const result of enrichmentResults) {
      if (result.error) {
        errors.push({ eventId: result.eventId, error: result.error })
        continue
      }

      if (!result.venue) {
        errors.push({ eventId: result.eventId, error: 'No venue found on detail page' })
        continue
      }

      try {
        // Try to match to existing venue
        const venueMatch = await matchVenue(result.venue.name)

        let venueId: string

        if (venueMatch.venue) {
          // Use existing venue
          venueId = venueMatch.venue.id
        } else {
          // Create new venue
          const newVenue = await createVenue({
            name: result.venue.name,
            address: result.venue.address,
            neighborhood: null,
          }, client)
          venueId = newVenue.id
          venuesCreated++
          console.log(`[Admin] Created new venue: ${result.venue.name}`)
        }

        // Update event with venue_id
        await updateEvent(result.eventId, { venue_id: venueId }, client)
        enriched++
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error'
        errors.push({ eventId: result.eventId, error: errorMsg })
      }
    }

    console.log(`[Admin] Meetup venue enrichment complete: ${enriched} enriched, ${venuesCreated} venues created, ${errors.length} errors`)

    return {
      success: true,
      enriched,
      venuesCreated,
      errors,
    }
  })
