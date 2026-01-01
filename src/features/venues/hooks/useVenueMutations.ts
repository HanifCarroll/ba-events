import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
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
      toast.success('Venue created successfully')
    },
    onError: () => {
      toast.error('Failed to create venue')
    },
  })
}

export function useUpdateVenue() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: VenueUpdate }) =>
      updateVenueAction({ data: { id, data } }),
    onSuccess: (updatedVenue, variables) => {
      track('admin:venue_updated', { venue_id: variables.id })
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
      toast.success('Venue updated successfully')
    },
    onError: () => {
      toast.error('Failed to update venue')
    },
  })
}

export function useDeleteVenue() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => deleteVenueAction({ data: id }),
    onSuccess: (_, venueId) => {
      track('admin:venue_deleted', { venue_id: venueId })
      // Remove from cache directly - no refetch needed
      queryClient.setQueriesData<Venue[]>(
        { queryKey: queryKeys.venues.all },
        (old) => old?.filter((v) => v.id !== venueId)
      )
      toast.success('Venue deleted successfully')
    },
    onError: () => {
      toast.error('Failed to delete venue')
    },
  })
}
