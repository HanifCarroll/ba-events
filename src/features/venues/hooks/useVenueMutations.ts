import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createVenueAction, updateVenueAction, deleteVenueAction } from '../api/crud'
import { queryKeys } from '@/shared/lib/query'
import { track } from '@/lib/analytics'
import type { Venue, VenueInsert, VenueUpdate } from '@/shared/lib/types'

export function useCreateVenue() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: VenueInsert) => createVenueAction({ data }),
    onSuccess: (newVenue, variables) => {
      track('admin:venue_created', {
        venue_id: newVenue.id,
        neighborhood: variables.neighborhood,
      })
      // Add new venue to cache directly
      queryClient.setQueriesData<Venue[]>(
        { queryKey: queryKeys.venues.all },
        (old) => old ? [newVenue, ...old] : [newVenue]
      )
    },
  })
}

export function useUpdateVenue() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: VenueUpdate }) =>
      updateVenueAction({ data: { id, data } }),
    onSuccess: (updatedVenue, variables) => {
      // Update venue in cache directly
      queryClient.setQueriesData<Venue[]>(
        { queryKey: queryKeys.venues.all },
        (old) => old?.map((v) => (v.id === variables.id ? { ...v, ...updatedVenue } : v))
      )
      // Update detail cache if it exists
      queryClient.setQueryData<Venue>(
        queryKeys.venues.detail(variables.id),
        (old) => old ? { ...old, ...updatedVenue } : undefined
      )
    },
  })
}

export function useDeleteVenue() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => deleteVenueAction({ data: id }),
    onSuccess: (_, venueId) => {
      // Remove from cache directly - no refetch needed
      queryClient.setQueriesData<Venue[]>(
        { queryKey: queryKeys.venues.all },
        (old) => old?.filter((v) => v.id !== venueId)
      )
    },
  })
}
