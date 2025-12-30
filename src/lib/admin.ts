import { createServerFn } from '@tanstack/react-start'
import {
  getVenues,
  getVenueById,
  createVenue,
  createVenues,
  updateVenue,
  deleteVenue,
  getEventsWithVenues,
  getEventById,
  createEvent,
  createEvents,
  updateEvent,
  deleteEvent,
  bulkUpdateEventStatus,
  bulkDeleteEvents,
  markPastEvents,
  countPastEvents,
} from './supabase'
import { generateEmbedding } from './embeddings'
import { getSessionUser } from './session'
import type { VenueInsert, VenueUpdate, EventInsert, EventUpdate, EventWithVenue, EventStatus } from './types'

// Helper to validate admin access in server functions
async function requireAdminAccess(): Promise<void> {
  const session = await getSessionUser()
  if (!session?.isAdmin) {
    throw new Error('Unauthorized: Admin access required')
  }
}

// ============================================================================
// STATS
// ============================================================================

export const getAdminStats = createServerFn({ method: 'GET' }).handler(async () => {
  const [venues, events] = await Promise.all([
    getVenues(1000),
    getEventsWithVenues(1000),
  ])

  const now = new Date()
  const upcomingEvents = events.filter(e => new Date(e.starts_at) > now)
  const scheduledEvents = events.filter(e => e.status === 'scheduled')

  return {
    venueCount: venues.length,
    eventCount: events.length,
    upcomingCount: upcomingEvents.length,
    scheduledCount: scheduledEvents.length,
  }
})

// ============================================================================
// VENUE OPERATIONS
// ============================================================================

export const listVenues = createServerFn({ method: 'GET' }).handler(async () => {
  return getVenues(1000)
})

export const getVenue = createServerFn({ method: 'GET' })
  .inputValidator((id: string) => id)
  .handler(async ({ data: id }) => {
    return getVenueById(id)
  })

export const createVenueAction = createServerFn({ method: 'POST' })
  .inputValidator((data: VenueInsert) => data)
  .handler(async ({ data }) => {
    await requireAdminAccess()
    return createVenue(data)
  })

export const updateVenueAction = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: string; data: VenueUpdate }) => input)
  .handler(async ({ data: { id, data } }) => {
    await requireAdminAccess()
    return updateVenue(id, data)
  })

export const deleteVenueAction = createServerFn({ method: 'POST' })
  .inputValidator((id: string) => id)
  .handler(async ({ data: id }) => {
    await requireAdminAccess()
    await deleteVenue(id)
    return { success: true }
  })

export const bulkCreateVenuesAction = createServerFn({ method: 'POST' })
  .inputValidator((data: VenueInsert[]) => data)
  .handler(async ({ data: venues }) => {
    await requireAdminAccess()
    const created = await createVenues(venues)
    return {
      success: true,
      count: created.length,
    }
  })

// ============================================================================
// EVENT OPERATIONS
// ============================================================================

export const listEvents = createServerFn({ method: 'GET' }).handler(async (): Promise<EventWithVenue[]> => {
  return getEventsWithVenues(1000)
})

export const getEventAction = createServerFn({ method: 'GET' })
  .inputValidator((id: string) => id)
  .handler(async ({ data: id }) => {
    return getEventById(id)
  })

export const createEventAction = createServerFn({ method: 'POST' })
  .inputValidator((data: EventInsert) => data)
  .handler(async ({ data }) => {
    await requireAdminAccess()
    // Generate embedding from name and Spanish description (cross-lingual model)
    const textForEmbedding = [
      data.name,
      data.description_es,
      ...(data.categories || []),
      ...(data.vibes || []),
    ]
      .filter(Boolean)
      .join(' ')

    const embedding = await generateEmbedding(textForEmbedding)

    return createEvent({
      ...data,
      embedding,
    })
  })

export const updateEventAction = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: string; data: EventUpdate }) => input)
  .handler(async ({ data: { id, data } }) => {
    await requireAdminAccess()
    // If name, description_es, categories, or vibes changed, regenerate embedding
    const existingEvent = await getEventById(id)
    const needsNewEmbedding =
      data.name !== undefined ||
      data.description_es !== undefined ||
      data.categories !== undefined ||
      data.vibes !== undefined

    let embedding: number[] | undefined

    if (needsNewEmbedding) {
      // Use Spanish description for embedding (cross-lingual model)
      const textForEmbedding = [
        data.name ?? existingEvent.name,
        data.description_es ?? existingEvent.description_es,
        ...(data.categories ?? existingEvent.categories),
        ...(data.vibes ?? existingEvent.vibes),
      ]
        .filter(Boolean)
        .join(' ')

      embedding = await generateEmbedding(textForEmbedding)
    }

    return updateEvent(id, {
      ...data,
      ...(embedding && { embedding }),
    })
  })

export const deleteEventAction = createServerFn({ method: 'POST' })
  .inputValidator((id: string) => id)
  .handler(async ({ data: id }) => {
    await requireAdminAccess()
    await deleteEvent(id)
    return { success: true }
  })

export const bulkCreateEventsAction = createServerFn({ method: 'POST' })
  .inputValidator((data: EventInsert[]) => data)
  .handler(async ({ data: events }) => {
    await requireAdminAccess()
    // Generate embeddings for all events using Spanish description
    const eventsWithEmbeddings = await Promise.all(
      events.map(async (event) => {
        const textForEmbedding = [
          event.name,
          event.description_es,
          ...(event.categories || []),
          ...(event.vibes || []),
        ]
          .filter(Boolean)
          .join(' ')

        const embedding = await generateEmbedding(textForEmbedding)

        return {
          ...event,
          embedding,
        }
      })
    )

    // Insert all events
    const created = await createEvents(eventsWithEmbeddings)

    return {
      success: true,
      count: created.length,
    }
  })

export const bulkUpdateEventStatusAction = createServerFn({ method: 'POST' })
  .inputValidator((input: { eventIds: string[]; status: EventStatus }) => input)
  .handler(async ({ data: { eventIds, status } }) => {
    await requireAdminAccess()
    const updated = await bulkUpdateEventStatus(eventIds, status)
    return {
      success: true,
      count: updated.length,
    }
  })

export const bulkDeleteEventsAction = createServerFn({ method: 'POST' })
  .inputValidator((eventIds: string[]) => eventIds)
  .handler(async ({ data: eventIds }) => {
    await requireAdminAccess()
    await bulkDeleteEvents(eventIds)
    return {
      success: true,
      count: eventIds.length,
    }
  })

export const countPastEventsAction = createServerFn({ method: 'GET' }).handler(async () => {
  const count = await countPastEvents()
  return { count }
})

export const markPastEventsAction = createServerFn({ method: 'POST' }).handler(async () => {
  const updated = await markPastEvents()
  return {
    success: true,
    count: updated.length,
  }
})

// ============================================================================
// VENUE LOOKUP (for event form)
// ============================================================================

export const getVenuesForSelect = createServerFn({ method: 'GET' }).handler(async (): Promise<{ id: string; name: string; neighborhood: string | null }[]> => {
  const venues = await getVenues(1000)
  return venues.map(v => ({
    id: v.id,
    name: v.name,
    neighborhood: v.neighborhood,
  }))
})

// ============================================================================
// PASSLINE SCRAPER
// ============================================================================

import {
  transformPasslineEvent,
  type PasslineEvent,
} from './scrapers/passline'
import { matchVenue, type VenueMatchResult } from './scrapers/venue-matcher'
import { upsertEvents, supabase } from './supabase'

export interface PasslinePreviewEvent {
  passline: PasslineEvent
  transformed: EventInsert
  venueMatch: VenueMatchResult
}

// Re-export PasslineEvent type for client use
export type { PasslineEvent }

/**
 * Process raw Passline events (client-side fetched) and do venue matching
 * This is used when the browser fetches events directly to bypass Cloudflare
 */
export const processPasslineEventsAction = createServerFn({ method: 'POST' })
  .inputValidator((data: { events: PasslineEvent[] }) => data)
  .handler(async ({ data: { events } }): Promise<PasslinePreviewEvent[]> => {
    // Match venues and transform events
    const previews: PasslinePreviewEvent[] = await Promise.all(
      events.map(async (event) => {
        const venueMatch = await matchVenue(event.lugar)
        const transformed = transformPasslineEvent(
          event,
          venueMatch.venue?.id || null
        )

        return {
          passline: event,
          transformed,
          venueMatch,
        }
      })
    )

    return previews
  })

/**
 * Import a batch of events from client-provided Passline data
 * Processes events in small batches to avoid timeouts
 */
export const importPasslineEventsBatchAction = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: { events: Array<{ passlineEvent: PasslineEvent; venueId: string | null }> }) => data
  )
  .handler(async ({ data }) => {
    // Transform events
    const eventsToImport: EventInsert[] = data.events.map(({ passlineEvent, venueId }) =>
      transformPasslineEvent(passlineEvent, venueId)
    )

    if (eventsToImport.length === 0) {
      return { success: true, inserted: 0, updated: 0 }
    }

    // Generate embeddings sequentially to avoid rate limits
    // Uses Spanish description for embedding (cross-lingual model)
    const eventsWithEmbeddings: EventInsert[] = []
    for (const event of eventsToImport) {
      const textForEmbedding = [
        event.name,
        event.description_es,
        ...(event.categories || []),
        ...(event.vibes || []),
      ]
        .filter(Boolean)
        .join(' ')

      const embedding = await generateEmbedding(textForEmbedding)
      eventsWithEmbeddings.push({ ...event, embedding })
    }

    // Upsert events (insert new, update existing)
    const result = await upsertEvents(eventsWithEmbeddings)

    return {
      success: true,
      ...result,
    }
  })

// ============================================================================
// PENDING EVENT MANAGEMENT
// ============================================================================

export const getPendingEventsAction = createServerFn({ method: 'GET' }).handler(
  async (): Promise<EventWithVenue[]> => {
    const events = await getEventsWithVenues(1000)
    return events.filter((e) => e.status === 'pending_review')
  }
)

export const approveEventAction = createServerFn({ method: 'POST' })
  .inputValidator((data: { eventId: string; venueId?: string }) => data)
  .handler(async ({ data: { eventId, venueId } }) => {
    const updates: EventUpdate = { status: 'scheduled' }
    if (venueId) {
      updates.venue_id = venueId
    }
    await updateEvent(eventId, updates)
    return { success: true }
  })

export const rejectEventAction = createServerFn({ method: 'POST' })
  .inputValidator((data: { eventId: string }) => data)
  .handler(async ({ data: { eventId } }) => {
    await deleteEvent(eventId)
    return { success: true }
  })

// ============================================================================
// DESCRIPTION ENRICHMENT (Bilingual: Spanish + English)
// ============================================================================

import { enrichEventDescriptionBilingual } from './enrichment'

/**
 * Enrich event descriptions using Jina Reader + Haiku 4.5
 * Extracts semantic description in Spanish, translates to English
 * Uses Spanish description for embedding (cross-lingual model handles it)
 */
export const enrichEventDescriptionsAction = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: { events: Array<{ id: string; link: string }> }) => data
  )
  .handler(async ({ data: { events } }) => {
    console.log(`[server] enrichEventDescriptionsAction called with ${events.length} events`)
    let enriched = 0
    const errors: Array<{ id: string; error: string }> = []

    for (const { id, link } of events) {
      console.log(`[server] Processing event ${id}: ${link}`)
      try {
        // Fetch and extract bilingual descriptions using Jina + Haiku
        const bilingual = await enrichEventDescriptionBilingual(link)
        console.log(`[server] Got descriptions for ${id}: ES=${bilingual?.description_es ? 'yes' : 'no'}, EN=${bilingual?.description_en ? 'yes' : 'no'}`)

        if (!bilingual?.description_es) {
          errors.push({ id, error: 'Failed to extract description' })
          continue
        }

        // Get existing event to merge with new description
        const existingEvent = await getEventById(id)

        // Generate new embedding with Spanish description (cross-lingual model)
        const textForEmbedding = [
          existingEvent.name,
          bilingual.description_es,
          ...(existingEvent.categories || []),
          ...(existingEvent.vibes || []),
        ]
          .filter(Boolean)
          .join(' ')

        const embedding = await generateEmbedding(textForEmbedding)

        // Update event with both descriptions and new embedding
        await updateEvent(id, {
          description_es: bilingual.description_es,
          description_en: bilingual.description_en,
          embedding,
        })

        enriched++
      } catch (error) {
        console.error(`Failed to enrich event ${id}:`, error)
        errors.push({
          id,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }

    return {
      success: true,
      enriched,
      total: events.length,
      errors: errors.length > 0 ? errors : undefined,
    }
  })

/**
 * Get events that are missing descriptions (no Spanish description)
 */
export const getEventsWithoutDescriptions = createServerFn({ method: 'GET' }).handler(
  async (): Promise<EventWithVenue[]> => {
    const events = await getEventsWithVenues(1000)
    return events.filter((e) => !e.description_es)
  }
)

/**
 * Update event descriptions in batch (bilingual)
 * Regenerates embeddings for each updated event using Spanish description
 */
export const updateEventDescriptionsAction = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: { updates: Array<{ id: string; description_es: string; description_en: string }> }) => data
  )
  .handler(async ({ data: { updates } }) => {
    let updated = 0

    for (const { id, description_es, description_en } of updates) {
      try {
        // Get existing event to merge with new description
        const existingEvent = await getEventById(id)

        // Generate new embedding with Spanish description (cross-lingual model)
        const textForEmbedding = [
          existingEvent.name,
          description_es,
          ...(existingEvent.categories || []),
          ...(existingEvent.vibes || []),
        ]
          .filter(Boolean)
          .join(' ')

        const embedding = await generateEmbedding(textForEmbedding)

        // Update event with both descriptions and new embedding
        await updateEvent(id, {
          description_es,
          description_en,
          embedding,
        })

        updated++
      } catch (error) {
        console.error(`Failed to update description for event ${id}:`, error)
      }
    }

    return {
      success: true,
      updated,
      total: updates.length,
    }
  })

// ============================================================================
// EVENTBRITE SCRAPER
// ============================================================================

import {
  type EventbriteEvent,
  transformEventbriteEvent,
} from './scrapers/eventbrite'
import { enrichEventbriteEventsBatch } from './scrapers/eventbrite/enrichment'

export interface EventbritePreviewEvent {
  eventbrite: EventbriteEvent
  transformed: EventInsert
  venueMatch: VenueMatchResult
}

// Re-export EventbriteEvent type for client use
export type { EventbriteEvent }

/**
 * Process raw Eventbrite events and do venue matching
 * Events are fetched directly in the browser (JSON-LD from listing page)
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
 */
export const importEventbriteEventsBatchAction = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: { events: Array<{ eventbriteEvent: EventbriteEvent; venueId: string | null }> }) => data
  )
  .handler(async ({ data }) => {
    // Transform events
    const eventsToImport: EventInsert[] = data.events.map(({ eventbriteEvent, venueId }) =>
      transformEventbriteEvent(eventbriteEvent, venueId)
    )

    if (eventsToImport.length === 0) {
      return { success: true, inserted: 0, updated: 0 }
    }

    // Generate embeddings sequentially to avoid rate limits
    // Eventbrite events already have description_es from JSON-LD
    const eventsWithEmbeddings: EventInsert[] = []
    for (const event of eventsToImport) {
      const textForEmbedding = [
        event.name,
        event.description_es,
        ...(event.categories || []),
        ...(event.vibes || []),
      ]
        .filter(Boolean)
        .join(' ')

      const embedding = await generateEmbedding(textForEmbedding)
      eventsWithEmbeddings.push({ ...event, embedding })
    }

    // Upsert events (insert new, update existing)
    const result = await upsertEvents(eventsWithEmbeddings)

    return {
      success: true,
      ...result,
    }
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
 * Enrich Eventbrite events with price, categories, and vibes
 * Uses web scraping for price and AI inference for categories/vibes
 */
export const enrichEventbriteEventsAction = createServerFn({ method: 'POST' })
  .inputValidator((data: { events: EventbriteEnrichmentInput[] }) => data)
  .handler(async ({ data }): Promise<EventbriteEnrichmentOutput> => {
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

        // Generate new embedding with updated categories/vibes
        const textForEmbedding = [
          existingEvent.name,
          existingEvent.description_es,
          ...result.categories,
          ...result.vibes,
        ]
          .filter(Boolean)
          .join(' ')

        const embedding = await generateEmbedding(textForEmbedding)

        // Update event with enriched data
        await updateEvent(result.id, {
          price: result.price,
          is_free: result.is_free,
          categories: result.categories,
          vibes: result.vibes,
          embedding,
        })

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
// BA TOURISM SCRAPER
// ============================================================================

import {
  type BATourismEvent,
  type WeekContext,
  scrapeBATourismEventsWithBrowser,
  transformBATourismEvent,
  parseWeekContext,
} from './scrapers/ba-tourism'

// ============================================================================
// MEETUP SCRAPER
// ============================================================================

import {
  type MeetupEvent,
  scrapeMeetupEvents,
  filterInPersonEvents as filterMeetupInPersonEvents,
  transformMeetupEventWithExpansion,
  enrichMeetupEventsWithVenues,
} from './scrapers/meetup'

export interface BATourismPreviewEvent {
  baTourism: BATourismEvent
  transformed: EventInsert[]
  venueMatch: VenueMatchResult
  dateCount: number
}

export type { BATourismEvent, WeekContext }

export const fetchBATourismEventsAction = createServerFn({ method: 'POST' })
  .inputValidator((data: { weekContextText?: string }) => data)
  .handler(async ({ data }): Promise<{ events: BATourismPreviewEvent[]; weekContext: WeekContext }> => {
    try {
      console.log('[Admin] Starting BA Tourism fetch...')
      const { events: rawEvents, weekContext: fetchedContext } = await scrapeBATourismEventsWithBrowser()
      console.log(`[Admin] Scraped ${rawEvents.length} raw events`)

      const weekContext = data.weekContextText
        ? parseWeekContext(data.weekContextText)
        : fetchedContext

      const previews: BATourismPreviewEvent[] = await Promise.all(
        rawEvents.map(async (event) => {
          const venueMatch = await matchVenue(event.venueName)
          const transformed = transformBATourismEvent(
            event,
            weekContext,
            venueMatch.venue?.id || null,
            new Date()
          )

          return {
            baTourism: event,
            transformed,
            venueMatch,
            dateCount: transformed.length,
          }
        })
      )

      console.log(`[Admin] Returning ${previews.length} preview events`)
      return { events: previews, weekContext }
    } catch (error) {
      console.error('[Admin] BA Tourism fetch error:', error)
      throw error
    }
  })

export const importBATourismEventsBatchAction = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: {
      events: Array<{
        baTourismEvent: BATourismEvent
        venueId: string | null
        weekContext: WeekContext
      }>
    }) => data
  )
  .handler(async ({ data }) => {
    const eventsToImport: EventInsert[] = data.events.flatMap(({ baTourismEvent, venueId, weekContext }) =>
      transformBATourismEvent(baTourismEvent, weekContext, venueId, new Date())
    )

    if (eventsToImport.length === 0) {
      return { success: true, inserted: 0, updated: 0 }
    }

    const eventsWithEmbeddings: EventInsert[] = []
    for (const event of eventsToImport) {
      const textForEmbedding = [
        event.name,
        event.description_es,
        ...(event.categories || []),
        ...(event.vibes || []),
      ]
        .filter(Boolean)
        .join(' ')

      const embedding = await generateEmbedding(textForEmbedding)
      eventsWithEmbeddings.push({ ...event, embedding })
    }

    const result = await upsertEvents(eventsWithEmbeddings)

    return {
      success: true,
      ...result,
    }
  })

// ============================================================================
// MEETUP SCRAPER ACTIONS
// ============================================================================

export interface MeetupPreviewEvent {
  meetup: MeetupEvent
  transformed: EventInsert[]
  venueMatch: VenueMatchResult
  dateCount: number
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
        }
      })
    )

    return previews
  })

export const fetchMeetupEventsAction = createServerFn({ method: 'POST' })
  .inputValidator((data: { startDate?: string; endDate?: string }) => data)
  .handler(async ({ data }): Promise<{ events: MeetupPreviewEvent[] }> => {
    try {
      console.log('[Admin] Starting Meetup fetch...')
      const rawEvents = await scrapeMeetupEvents()
      console.log(`[Admin] Scraped ${rawEvents.length} raw Meetup events`)

      // Filter in-person events
      const inPersonEvents = filterMeetupInPersonEvents(rawEvents)
      console.log(`[Admin] ${inPersonEvents.length} in-person events`)

      // Filter by date range if provided
      let filteredEvents = inPersonEvents
      if (data.startDate && data.endDate) {
        const start = new Date(data.startDate)
        const end = new Date(data.endDate)
        filteredEvents = inPersonEvents.filter((event) => {
          const eventDate = new Date(event.dateTime)
          return eventDate >= start && eventDate <= end
        })
        console.log(`[Admin] ${filteredEvents.length} events in date range`)
      }

      const previews: MeetupPreviewEvent[] = await Promise.all(
        filteredEvents.map(async (event) => {
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

      console.log(`[Admin] Returning ${previews.length} Meetup preview events`)
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
    const eventsToImport: EventInsert[] = data.events.flatMap(({ meetupEvent, venueId }) =>
      transformMeetupEventWithExpansion(meetupEvent, venueId, 4)
    )

    if (eventsToImport.length === 0) {
      return { success: true, inserted: 0, updated: 0 }
    }

    const eventsWithEmbeddings: EventInsert[] = []
    for (const event of eventsToImport) {
      const textForEmbedding = [
        event.name,
        event.description_es,
        ...(event.categories || []),
        ...(event.vibes || []),
      ]
        .filter(Boolean)
        .join(' ')

      const embedding = await generateEmbedding(textForEmbedding)
      eventsWithEmbeddings.push({ ...event, embedding })
    }

    const result = await upsertEvents(eventsWithEmbeddings)

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
          })
          venueId = newVenue.id
          venuesCreated++
          console.log(`[Admin] Created new venue: ${result.venue.name}`)
        }

        // Update event with venue_id
        await updateEvent(result.eventId, { venue_id: venueId })
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
