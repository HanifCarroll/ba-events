import { createServerFn } from '@tanstack/react-start'
import {
  getEventsWithVenues,
  getTrendingEvents,
  getActiveEventsForList,
  getPastEventsForList,
  getEventById,
  getEventWithVenue,
  createEvent,
  createEvents,
  updateEvent,
  deleteEvent,
  bulkUpdateEventStatus,
  bulkUpdateLocationTba,
  bulkUpdateDescriptionUnavailable,
  bulkDeleteEvents,
  markPastEvents,
  countPastEvents,
} from '@/shared/lib/db/client'
import { generateEventEmbedding } from '@/shared/lib/ai/embeddings'
import { requireAdminAccess } from '@/shared/lib/admin-utils'
import { buildDescriptionPresentationFields } from '@/features/events/lib/description-presentation.server'
import { queryEventsPaginated, queryEventTabCounts } from './queries'
import type { EventInsert, EventUpdate, EventWithVenue, EventListItem, EventStatus, ChatEventPayload } from '@/shared/lib/types'
import type { EventListParams, EventFilterParams, PaginatedResponse, EventTabCounts } from '@/shared/lib/types/pagination'

export const listEvents = createServerFn({ method: 'GET' }).handler(async (): Promise<EventWithVenue[]> => {
  return getEventsWithVenues(1000)
})

/**
 * Next upcoming events for the chat home "Happening soon" grid.
 * Public — no auth, lightweight chat columns only.
 */
export const getTrendingEventsAction = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ChatEventPayload[]> => {
    return getTrendingEvents(3)
  }
)

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
 * Uses lightweight view that excludes heavy columns (descriptions).
 * Reduces payload from ~2-10MB to ~200-400KB for 2000 events.
 */
export const listActiveEventsAdmin = createServerFn({ method: 'GET' }).handler(async (): Promise<EventListItem[]> => {
  await requireAdminAccess()
  return getActiveEventsForList(5000)
})

/**
 * List past events for admin - lazy loaded when Past tab is clicked
 * Uses lightweight view that excludes heavy columns (descriptions).
 */
export const listPastEventsAdmin = createServerFn({ method: 'GET' }).handler(async (): Promise<EventListItem[]> => {
  await requireAdminAccess()
  return getPastEventsForList(5000)
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
    const presentationFields = await buildDescriptionPresentationFields({
      description_es: data.description_es,
      description_en: data.description_en,
    })
    const embedding = await generateEventEmbedding(data)

    return createEvent({
      ...data,
      ...presentationFields,
      embedding,
    }, client)
  })

export const updateEventAction = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: string; data: EventUpdate }) => input)
  .handler(async ({ data: { id, data } }) => {
    const client = await requireAdminAccess()
    const existingEvent = await getEventById(id)
    // If name, description_es, or categories changed, regenerate embedding
    const needsNewEmbedding =
      data.name !== undefined ||
      data.description_es !== undefined ||
      data.categories !== undefined

    const descriptionsChanged =
      data.description_es !== undefined || data.description_en !== undefined

    let presentationUpdates: Partial<EventUpdate> = {}
    let embedding: number[] | undefined

    if (descriptionsChanged) {
      presentationUpdates = await buildDescriptionPresentationFields({
        description_es:
          data.description_es !== undefined ? data.description_es : existingEvent.description_es,
        description_en:
          data.description_en !== undefined ? data.description_en : existingEvent.description_en,
      })
    }

    if (needsNewEmbedding) {
      embedding = await generateEventEmbedding({
        name: data.name ?? existingEvent.name,
        description_es: data.description_es ?? existingEvent.description_es,
        categories: data.categories ?? existingEvent.categories,
      })
    }

    return updateEvent(id, {
      ...data,
      ...presentationUpdates,
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

export const bulkUpdateLocationTbaAction = createServerFn({ method: 'POST' })
  .inputValidator((input: { eventIds: string[]; locationTba: boolean }) => input)
  .handler(async ({ data: { eventIds, locationTba } }) => {
    const client = await requireAdminAccess()
    const updated = await bulkUpdateLocationTba(eventIds, locationTba, client)
    return {
      success: true,
      count: updated.length,
    }
  })

export const bulkUpdateDescriptionUnavailableAction = createServerFn({ method: 'POST' })
  .inputValidator((input: { eventIds: string[]; descriptionUnavailable: boolean }) => input)
  .handler(async ({ data: { eventIds, descriptionUnavailable } }) => {
    const client = await requireAdminAccess()
    const updated = await bulkUpdateDescriptionUnavailable(eventIds, descriptionUnavailable, client)
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
