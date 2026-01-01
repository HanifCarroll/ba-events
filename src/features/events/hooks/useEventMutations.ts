import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { createEventAction, updateEventAction, deleteEventAction } from '../api/crud'
import { queryKeys } from '@/shared/lib/query'
import { track } from '@/lib/analytics'
import type { EventInsert, EventUpdate, EventWithVenue } from '@/shared/lib/types'

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
      // Invalidate to get fresh data with venue join
      queryClient.invalidateQueries({ queryKey: queryKeys.events.all })
      toast.success('Event created successfully')
    },
    onError: () => {
      toast.error('Failed to create event')
    },
  })
}

export function useUpdateEvent() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: EventUpdate }) =>
      updateEventAction({ data: { id, data } }),
    onSuccess: (updatedEvent, variables) => {
      track('admin:event_updated', { event_id: variables.id })
      // Update event in cache directly - merge with existing venue data
      queryClient.setQueriesData<EventWithVenue[]>(
        { queryKey: queryKeys.events.all },
        (old) => old?.map((e) => (e.id === variables.id ? { ...e, ...updatedEvent } : e))
      )
      // Update detail cache if it exists
      queryClient.setQueryData<EventWithVenue>(
        queryKeys.events.detail(variables.id),
        (old) => old ? { ...old, ...updatedEvent } : undefined
      )
      toast.success('Event updated successfully')
    },
    onError: () => {
      toast.error('Failed to update event')
    },
  })
}

export function useDeleteEvent() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => deleteEventAction({ data: id }),
    onSuccess: (_, eventId) => {
      track('admin:event_deleted', { event_id: eventId })
      // Remove from cache directly - no refetch needed
      queryClient.setQueriesData<EventWithVenue[]>(
        { queryKey: queryKeys.events.all },
        (old) => old?.filter((e) => e.id !== eventId)
      )
      toast.success('Event deleted successfully')
    },
    onError: () => {
      toast.error('Failed to delete event')
    },
  })
}
