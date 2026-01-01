import { createServerFn } from '@tanstack/react-start'
import {
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
} from '@/shared/lib/db/client'
import { generateEventEmbedding } from '@/shared/lib/ai/embeddings'
import { requireAdminAccess } from '@/shared/lib/admin-utils'
import type { EventInsert, EventUpdate, EventWithVenue, EventStatus } from '@/shared/lib/types'

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
