import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { createEventAction, updateEventAction, deleteEventAction } from '../api/crud'
import { queryKeys } from '@/shared/lib/query'
import { track } from '@/lib/analytics'
import { getErrorMessage } from '@/shared/lib/error-messages'
import type { EventInsert, EventUpdate, EventWithVenue } from '@/shared/lib/types'

export function useCreateEvent() {
  const router = useRouter()

  return useMutation({
    mutationFn: (data: EventInsert) => createEventAction({ data }),
    onSuccess: (result, variables) => {
      track('admin:event_created', {
        event_id: result.id,
        has_venue: !!variables.venue_id,
        categories_count: variables.categories?.length ?? 0,
      })
      // Events are loaded via route loaders, so invalidate the router
      router.invalidate()
      toast.success('Event created successfully')
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, { operation: 'create', entity: 'event' }))
    },
  })
}

export function useUpdateEvent() {
  const queryClient = useQueryClient()
  const router = useRouter()

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: EventUpdate }) =>
      updateEventAction({ data: { id, data } }),
    onSuccess: (updatedEvent, variables) => {
      track('admin:event_updated', { event_id: variables.id })
      // Events are loaded via route loaders, so invalidate the router
      router.invalidate()
      // Also update detail cache for the EditEventSheet
      queryClient.setQueryData<EventWithVenue>(
        queryKeys.events.detail(variables.id),
        (old) => old ? { ...old, ...updatedEvent } : undefined
      )
      toast.success('Event updated successfully')
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, { operation: 'update', entity: 'event' }))
    },
  })
}

export function useDeleteEvent() {
  const router = useRouter()

  return useMutation({
    mutationFn: (id: string) => deleteEventAction({ data: id }),
    onSuccess: (_, eventId) => {
      track('admin:event_deleted', { event_id: eventId })
      // Events are loaded via route loaders, so invalidate the router
      router.invalidate()
      toast.success('Event deleted successfully')
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, { operation: 'delete', entity: 'event' }))
    },
  })
}
