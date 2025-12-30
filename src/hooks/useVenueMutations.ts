import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createVenueAction, updateVenueAction, deleteVenueAction } from '@/lib/admin'
import { queryKeys } from '@/lib/query'
import { track } from '@/lib/analytics'
import type { VenueInsert, VenueUpdate } from '@/lib/types'

export function useCreateVenue() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: VenueInsert) => createVenueAction({ data }),
    onSuccess: (result, variables) => {
      track('admin:venue_created', {
        venue_id: result.id,
        neighborhood: variables.neighborhood,
      })
      queryClient.invalidateQueries({ queryKey: queryKeys.venues.all })
    },
  })
}

export function useUpdateVenue() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: VenueUpdate }) =>
      updateVenueAction({ data: { id, data } }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.venues.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.venues.detail(variables.id) })
    },
  })
}

export function useDeleteVenue() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => deleteVenueAction({ data: id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.venues.all })
    },
  })
}
