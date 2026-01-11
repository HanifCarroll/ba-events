import { createServerFn } from '@tanstack/react-start'
import {
  getEventsWithVenues,
  getActiveEventsWithVenues,
  getPastEventsWithVenues,
  getEventById,
  getEventWithVenue,
  createEvent,
  createEvents,
  updateEvent,
  deleteEvent,
  bulkUpdateEventStatus,
  bulkDeleteEvents,
  markPastEvents,
  countPastEvents,
} from '@/shared/lib/db/client'
import { generateEventEmbedding } from '@/shared/lib/ai/embeddings'
import { requireAdminAccess } from '@/shared/lib/admin-utils'
import { queryEventsPaginated, queryEventTabCounts } from './queries'
import type { EventInsert, EventUpdate, EventWithVenue, EventStatus } from '@/shared/lib/types'
import type { EventListParams, EventFilterParams, PaginatedResponse, EventTabCounts } from '@/shared/lib/types/pagination'

export const listEvents = createServerFn({ method: 'GET' }).handler(async (): Promise<EventWithVenue[]> => {
  return getEventsWithVenues(1000)
})

/**
 * List all events for admin with no pagination (client-side filtering)
 * Returns all events ordered by starts_at descending
 * @deprecated Use listActiveEventsAdmin + listPastEventsAdmin for better performance
 */
export const listAllEventsAdmin = createServerFn({ method: 'GET' }).handler(async (): Promise<EventWithVenue[]> => {
  await requireAdminAccess()
  // Fetch all events - reasonable limit for client-side handling
  return getEventsWithVenues(5000)
})

/**
 * List active (non-past) events for admin - initial page load
 * Excludes embedding column for better performance
 */
export const listActiveEventsAdmin = createServerFn({ method: 'GET' }).handler(async (): Promise<EventWithVenue[]> => {
  await requireAdminAccess()
  return getActiveEventsWithVenues(5000)
})

/**
 * List past events for admin - lazy loaded when Past tab is clicked
 * Excludes embedding column for better performance
 */
export const listPastEventsAdmin = createServerFn({ method: 'GET' }).handler(async (): Promise<EventWithVenue[]> => {
  await requireAdminAccess()
  return getPastEventsWithVenues(5000)
})

/**
 * Paginated event list with server-side filtering
 * Returns events matching filters with pagination metadata
 */
export const listEventsPaginated = createServerFn({ method: 'GET' })
  .inputValidator((params: EventListParams) => params)
  .handler(async ({ data }): Promise<PaginatedResponse<EventWithVenue>> => {
    await requireAdminAccess()
    const { page = 1, pageSize = 25, ...filters } = data
    return queryEventsPaginated(filters, { page, pageSize })
  })

/**
 * Get event tab counts for admin sidebar badges
 * Returns counts for all, needs_attention, pending_review, past tabs
 */
export const getEventTabCountsAction = createServerFn({ method: 'GET' })
  .inputValidator((filters: Omit<EventFilterParams, 'tab'>) => filters)
  .handler(async ({ data }): Promise<EventTabCounts> => {
    await requireAdminAccess()
    return queryEventTabCounts(data)
  })

export const getEventAction = createServerFn({ method: 'GET' })
  .inputValidator((id: string) => id)
  .handler(async ({ data: id }) => {
    return getEventById(id)
  })

export const getEventWithVenueAction = createServerFn({ method: 'GET' })
  .inputValidator((id: string) => id)
  .handler(async ({ data: id }) => {
    return getEventWithVenue(id)
  })

export const createEventAction = createServerFn({ method: 'POST' })
  .inputValidator((data: EventInsert) => data)
  .handler(async ({ data }) => {
    const client = await requireAdminAccess()
    const embedding = await generateEventEmbedding(data)

    return createEvent({
      ...data,
      embedding,
    }, client)
  })

export const updateEventAction = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: string; data: EventUpdate }) => input)
  .handler(async ({ data: { id, data } }) => {
    const client = await requireAdminAccess()
    // If name, description_es, or categories changed, regenerate embedding
    const existingEvent = await getEventById(id)
    const needsNewEmbedding =
      data.name !== undefined ||
      data.description_es !== undefined ||
      data.categories !== undefined

    let embedding: number[] | undefined

    if (needsNewEmbedding) {
      embedding = await generateEventEmbedding({
        name: data.name ?? existingEvent.name,
        description_es: data.description_es ?? existingEvent.description_es,
        categories: data.categories ?? existingEvent.categories,
      })
    }

    return updateEvent(id, {
      ...data,
      ...(embedding && { embedding }),
    }, client)
  })

export const deleteEventAction = createServerFn({ method: 'POST' })
  .inputValidator((id: string) => id)
  .handler(async ({ data: id }) => {
    const client = await requireAdminAccess()
    await deleteEvent(id, client)
    return { success: true }
  })

export const bulkCreateEventsAction = createServerFn({ method: 'POST' })
  .inputValidator((data: EventInsert[]) => data)
  .handler(async ({ data: events }) => {
    const client = await requireAdminAccess()
    // Generate embeddings for all events
    const eventsWithEmbeddings = await Promise.all(
      events.map(async (event) => {
        const embedding = await generateEventEmbedding(event)
        return { ...event, embedding }
      })
    )

    // Insert all events
    const created = await createEvents(eventsWithEmbeddings, client)

    return {
      success: true,
      count: created.length,
    }
  })

export const bulkUpdateEventStatusAction = createServerFn({ method: 'POST' })
  .inputValidator((input: { eventIds: string[]; status: EventStatus }) => input)
  .handler(async ({ data: { eventIds, status } }) => {
    const client = await requireAdminAccess()
    const updated = await bulkUpdateEventStatus(eventIds, status, client)
    return {
      success: true,
      count: updated.length,
    }
  })

export const bulkDeleteEventsAction = createServerFn({ method: 'POST' })
  .inputValidator((eventIds: string[]) => eventIds)
  .handler(async ({ data: eventIds }) => {
    const client = await requireAdminAccess()
    await bulkDeleteEvents(eventIds, client)
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
  const client = await requireAdminAccess()
  const updated = await markPastEvents(client)
  return {
    success: true,
    count: updated.length,
  }
})
