import { createServerFn } from '@tanstack/react-start'
import {
  getVenues,
  getVenueById,
  createVenue,
  createVenues,
  updateVenue,
  deleteVenue,
  bulkDeleteVenues,
} from '@/shared/lib/db/client'
import { requireAdminAccess } from '@/shared/lib/admin-utils'
import type { VenueInsert, VenueUpdate } from '@/shared/lib/types'

export const listVenues = createServerFn({ method: 'GET' }).handler(async () => {
  return getVenues(1000)
})

export const getVenue = createServerFn({ method: 'GET' })
  .inputValidator((id: string) => id)
  .handler(async ({ data: id }) => {
    return getVenueById(id)
  })

export const getVenuesForSelect = createServerFn({ method: 'GET' }).handler(async (): Promise<{ id: string; name: string; neighborhood: string | null }[]> => {
  const venues = await getVenues(1000)
  return venues.map(v => ({
    id: v.id,
    name: v.name,
    neighborhood: v.neighborhood,
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
