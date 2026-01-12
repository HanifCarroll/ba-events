import { createServerFn } from '@tanstack/react-start'
import {
  getVenues,
  getVenueById,
  createVenue,
  createVenues,
  updateVenue,
  deleteVenue,
  bulkDeleteVenues,
  getVenueEventCounts,
  getAllEventsByVenue,
} from '@/shared/lib/db/client'
import { requireAdminAccess } from '@/shared/lib/admin-utils'
import type { VenueInsert, VenueUpdate, Event } from '@/shared/lib/types'

// Type for venue event preview (subset of Event) - different from review.ts VenueEventPreview
export type VenueEventItem = Pick<Event, 'id' | 'name' | 'starts_at' | 'status' | 'link' | 'source'>

export const listVenues = createServerFn({ method: 'GET' }).handler(async () => {
  return getVenues(1000)
})

export const getVenue = createServerFn({ method: 'GET' })
  .inputValidator((id: string) => id)
  .handler(async ({ data: id }) => {
    return getVenueById(id)
  })

export const getVenuesForSelect = createServerFn({ method: 'GET' }).handler(async (): Promise<{ id: string; name: string; neighborhood: string | null; parent_id: string | null }[]> => {
  const venues = await getVenues(1000)
  return venues.map(v => ({
    id: v.id,
    name: v.name,
    neighborhood: v.neighborhood,
    parent_id: v.parent_id,
  }))
})

export const createVenueAction = createServerFn({ method: 'POST' })
  .inputValidator((data: VenueInsert) => data)
  .handler(async ({ data }) => {
    const client = await requireAdminAccess()
    return createVenue(data, client)
  })

export const updateVenueAction = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: string; data: VenueUpdate }) => input)
  .handler(async ({ data: { id, data } }) => {
    const client = await requireAdminAccess()
    return updateVenue(id, data, client)
  })

export const deleteVenueAction = createServerFn({ method: 'POST' })
  .inputValidator((id: string) => id)
  .handler(async ({ data: id }) => {
    const client = await requireAdminAccess()
    await deleteVenue(id, client)
    return { success: true }
  })

export const bulkCreateVenuesAction = createServerFn({ method: 'POST' })
  .inputValidator((data: VenueInsert[]) => data)
  .handler(async ({ data: venues }) => {
    const client = await requireAdminAccess()
    const created = await createVenues(venues, client)
    return {
      success: true,
      count: created.length,
    }
  })

export const bulkDeleteVenuesAction = createServerFn({ method: 'POST' })
  .inputValidator((ids: string[]) => ids)
  .handler(async ({ data: ids }) => {
    const client = await requireAdminAccess()
    await bulkDeleteVenues(ids, client)
    return { success: true, count: ids.length }
  })

// Get event counts for all venues (different from review.ts which takes specific IDs)
export const listAllVenueEventCountsAction = createServerFn({ method: 'GET' }).handler(async () => {
  return getVenueEventCounts()
})

// Get all events for a specific venue (different from review.ts which takes array of IDs)
export const listVenueEventsAction = createServerFn({ method: 'GET' })
  .inputValidator((venueId: string) => venueId)
  .handler(async ({ data: venueId }): Promise<VenueEventItem[]> => {
    return getAllEventsByVenue(venueId)
  })
