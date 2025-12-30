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
} from '../supabase'
import { generateEmbedding } from '../embeddings'
import { requireAdminAccess } from './utils'
import type { EventInsert, EventUpdate, EventWithVenue, EventStatus } from '../types'

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
