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
  checkEventExists,
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

export const getVenuesForSelect = createServerFn({ method: 'GET' }).handler(async (): Promise<{ id: string; name: string; neighborhood: string }[]> => {
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
  fetchPasslineEvents,
  filterCABAEvents,
  filterByDateRange,
  transformPasslineEvent,
  type PasslineEvent,
  type DateRange,
} from './scrapers/passline'
import { matchVenue, type VenueMatchResult } from './scrapers/venue-matcher'
import { upsertEvents } from './supabase'

export interface PasslinePreviewEvent {
  passline: PasslineEvent
  transformed: EventInsert
  venueMatch: VenueMatchResult
}

export const fetchPasslinePreviewAction = createServerFn({ method: 'GET' })
  .inputValidator((data: DateRange) => data)
  .handler(async ({ data: dateRange }): Promise<PasslinePreviewEvent[]> => {
    // Fetch all events from Passline
    const allEvents = await fetchPasslineEvents()

    // Filter to CABA only
    const cabaEvents = filterCABAEvents(allEvents)

    // Filter by date range
    const dateFiltered = filterByDateRange(cabaEvents, dateRange)

    // Match venues and transform events
    const previews: PasslinePreviewEvent[] = await Promise.all(
      dateFiltered.map(async (event) => {
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

export const importPasslineEventsAction = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: { events: Array<{ passlineId: string; venueId: string | null }> }) => data
  )
  .handler(async ({ data }) => {
    // Fetch fresh data from Passline
    const allEvents = await fetchPasslineEvents()
    const cabaEvents = filterCABAEvents(allEvents)

    // Create lookup map by Passline ID
    const eventMap = new Map(cabaEvents.map((e) => [e.id, e]))

    // Transform selected events
    const eventsToImport: EventInsert[] = []

    for (const { passlineId, venueId } of data.events) {
      const passlineEvent = eventMap.get(passlineId)
      if (!passlineEvent) continue

      const transformed = transformPasslineEvent(passlineEvent, venueId)
      eventsToImport.push(transformed)
    }

    if (eventsToImport.length === 0) {
      return { success: true, inserted: 0, updated: 0 }
    }

    // Generate embeddings for all events
    const eventsWithEmbeddings = await Promise.all(
      eventsToImport.map(async (event) => {
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

    // Upsert events (insert new, update existing)
    const result = await upsertEvents(eventsWithEmbeddings)

    return {
      success: true,
      ...result,
    }
  })

// ============================================================================
// AUTOMATED PASSLINE IMPORT (for GitHub Actions)
// ============================================================================

export const autoImportPasslineEventsAction = createServerFn({ method: 'POST' })
  .inputValidator((data: { apiKey: string }) => data)
  .handler(async ({ data: { apiKey } }) => {
    // Verify API key
    if (apiKey !== process.env.SCRAPER_API_KEY) {
      throw new Error('Unauthorized')
    }

    // Calculate date range (next 30 days)
    const today = new Date()
    const startDate = today.toISOString().split('T')[0]
    const endDate = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0]

    // Fetch and filter events
    const allEvents = await fetchPasslineEvents()
    const cabaEvents = filterCABAEvents(allEvents)
    const dateFiltered = filterByDateRange(cabaEvents, { startDate, endDate })

    let imported = 0
    let pending = 0
    let skipped = 0

    for (const event of dateFiltered) {
      // Check if already exists
      const exists = await checkEventExists('passline', event.id)
      if (exists) {
        skipped++
        continue
      }

      // Match venue
      const venueMatch = await matchVenue(event.lugar)

      // Determine status based on venue match
      const status: EventStatus =
        venueMatch.matchType === 'none' ? 'pending_review' : 'scheduled'

      // Transform event
      const transformed = transformPasslineEvent(
        event,
        venueMatch.venue?.id || null
      )

      // Generate embedding
      const textForEmbedding = [
        transformed.name,
        transformed.description,
        ...(transformed.categories || []),
        ...(transformed.vibes || []),
      ]
        .filter(Boolean)
        .join(' ')

      const embedding = await generateEmbedding(textForEmbedding)

      // Insert event with appropriate status
      await createEvent({
        ...transformed,
        status,
        embedding,
      })

      if (status === 'pending_review') {
        pending++
      } else {
        imported++
      }
    }

    return { imported, pending, skipped, total: dateFiltered.length }
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
