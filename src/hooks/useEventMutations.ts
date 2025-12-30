import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createEventAction, updateEventAction, deleteEventAction } from '@/lib/admin'
import { queryKeys } from '@/lib/query'
import { track } from '@/lib/analytics'
import type { EventInsert, EventUpdate } from '@/lib/types'

export function useCreateEvent() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: EventInsert) => createEventAction({ data }),
    onSuccess: (result, variables) => {
      track('admin:event_created', {
        event_id: result.id,
        has_venue: !!variables.venue_id,
        categories_count: variables.categories?.length ?? 0,
      })
      queryClient.invalidateQueries({ queryKey: queryKeys.events.all })
    },
  })
}

export function useUpdateEvent() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: EventUpdate }) =>
      updateEventAction({ data: { id, data } }),
    onSuccess: (_, variables) => {
      track('admin:event_updated', { event_id: variables.id })
      queryClient.invalidateQueries({ queryKey: queryKeys.events.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.events.detail(variables.id) })
    },
  })
}

export function useDeleteEvent() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => deleteEventAction({ data: id }),
    onSuccess: (_, eventId) => {
      track('admin:event_deleted', { event_id: eventId })
      queryClient.invalidateQueries({ queryKey: queryKeys.events.all })
    },
  })
}
