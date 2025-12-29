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
import type { VenueInsert, VenueUpdate, EventInsert, EventUpdate, EventWithVenue, EventStatus } from './types'

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
    return createVenue(data)
  })

export const updateVenueAction = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: string; data: VenueUpdate }) => input)
  .handler(async ({ data: { id, data } }) => {
    return updateVenue(id, data)
  })

export const deleteVenueAction = createServerFn({ method: 'POST' })
  .inputValidator((id: string) => id)
  .handler(async ({ data: id }) => {
    await deleteVenue(id)
    return { success: true }
  })

export const bulkCreateVenuesAction = createServerFn({ method: 'POST' })
  .inputValidator((data: VenueInsert[]) => data)
  .handler(async ({ data: venues }) => {
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
    // Generate embedding from name and description
    const textForEmbedding = [
      data.name,
      data.description,
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
    // If name, description, categories, or vibes changed, regenerate embedding
    const existingEvent = await getEventById(id)
    const needsNewEmbedding =
      data.name !== undefined ||
      data.description !== undefined ||
      data.categories !== undefined ||
      data.vibes !== undefined

    let embedding: number[] | undefined

    if (needsNewEmbedding) {
      const textForEmbedding = [
        data.name ?? existingEvent.name,
        data.description ?? existingEvent.description,
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
    await deleteEvent(id)
    return { success: true }
  })

export const bulkCreateEventsAction = createServerFn({ method: 'POST' })
  .inputValidator((data: EventInsert[]) => data)
  .handler(async ({ data: events }) => {
    // Generate embeddings for all events
    const eventsWithEmbeddings = await Promise.all(
      events.map(async (event) => {
        const textForEmbedding = [
          event.name,
          event.description,
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
    const updated = await bulkUpdateEventStatus(eventIds, status)
    return {
      success: true,
      count: updated.length,
    }
  })

export const bulkDeleteEventsAction = createServerFn({ method: 'POST' })
  .inputValidator((eventIds: string[]) => eventIds)
  .handler(async ({ data: eventIds }) => {
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
import { upsertEvents } from './supabase'

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
    const eventsWithEmbeddings: EventInsert[] = []
    for (const event of eventsToImport) {
      const textForEmbedding = [
        event.name,
        event.description,
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
