import { createServerFn } from '@tanstack/react-start'
import { getEventsWithVenues, updateEvent, deleteEvent } from '@/shared/lib/db/client'
import { requireAdminAccess } from '@/shared/lib/admin-utils'
import type { EventWithVenue, EventUpdate } from '@/shared/lib/types'

export const getPendingEventsAction = createServerFn({ method: 'GET' }).handler(
  async (): Promise<EventWithVenue[]> => {
    const events = await getEventsWithVenues(1000)
    return events.filter((e) => e.status === 'pending_review')
  }
)

export const approveEventAction = createServerFn({ method: 'POST' })
  .inputValidator((data: { eventId: string; venueId?: string }) => data)
  .handler(async ({ data: { eventId, venueId } }) => {
    const client = await requireAdminAccess()
    const updates: EventUpdate = { status: 'scheduled' }
    if (venueId) {
      updates.venue_id = venueId
    }
    await updateEvent(eventId, updates, client)
    return { success: true }
  })

export const rejectEventAction = createServerFn({ method: 'POST' })
  .inputValidator((data: { eventId: string }) => data)
  .handler(async ({ data: { eventId } }) => {
    const client = await requireAdminAccess()
    await deleteEvent(eventId, client)
    return { success: true }
  })
