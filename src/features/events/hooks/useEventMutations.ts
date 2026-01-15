import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { createEventAction, updateEventAction, deleteEventAction } from '../api/crud'
import { queryKeys } from '@/shared/lib/query'
import { track } from '@/lib/analytics'
import { getErrorMessage } from '@/shared/lib/error-messages'
import type { EventInsert, EventUpdate, EventWithVenue, EventListItem } from '@/shared/lib/types'

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

      // Add to admin events list cache (convert to EventListItem shape)
      queryClient.setQueryData<EventListItem[]>(
        queryKeys.events.adminList(),
        (old) => {
          if (!old) return old
          // Create a lightweight list item from the result
          // Note: createEvent returns Event (not EventWithVenue), so venue_name isn't available
          const newItem: EventListItem = {
            id: result.id,
            name: result.name,
            starts_at: result.starts_at,
            status: result.status,
            link: result.link,
            venue_id: result.venue_id,
            venue_name: null, // Will be populated on next refetch
            categories: result.categories ?? [],
            source: result.source,
            enrichment_status: result.enrichment_status,
            has_description_es: !!result.description_es,
            has_description_en: !!result.description_en,
            location_tba: result.location_tba ?? false,
            created_at: result.created_at,
          }
          return [newItem, ...old]
        }
      )

      // Background refresh tab counts
      queryClient.invalidateQueries({ queryKey: queryKeys.events.tabCounts({}) })

      toast.success('Event created successfully')
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, { operation: 'create', entity: 'event' }))
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

      // Instant update: modify event in the admin list cache
      queryClient.setQueryData<EventListItem[]>(
        queryKeys.events.adminList(),
        (old) => old?.map(e => e.id === updatedEvent.id
          ? {
              ...e,
              name: updatedEvent.name,
              starts_at: updatedEvent.starts_at,
              status: updatedEvent.status,
              link: updatedEvent.link,
              venue_id: updatedEvent.venue_id,
              venue_name: updatedEvent.venue_name ?? e.venue_name,
              categories: updatedEvent.categories ?? e.categories,
              has_description_es: !!updatedEvent.description_es,
              has_description_en: !!updatedEvent.description_en,
              location_tba: updatedEvent.location_tba ?? e.location_tba,
            }
          : e
        )
      )

      // Also update detail cache for the EditEventSheet
      queryClient.setQueryData<EventWithVenue>(
        queryKeys.events.detail(variables.id),
        (old) => old ? { ...old, ...updatedEvent } : undefined
      )

      // Background refresh tab counts (fast, just counts)
      queryClient.invalidateQueries({ queryKey: queryKeys.events.tabCounts({}) })

      toast.success('Event updated successfully')
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, { operation: 'update', entity: 'event' }))
    },
  })
}

export function useDeleteEvent() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => deleteEventAction({ data: id }),
    onSuccess: (_, eventId) => {
      track('admin:event_deleted', { event_id: eventId })

      // Remove from admin list cache
      queryClient.setQueryData<EventListItem[]>(
        queryKeys.events.adminList(),
        (old) => old?.filter(e => e.id !== eventId)
      )

      // Also remove from past events cache if present
      queryClient.setQueryData<EventListItem[]>(
        queryKeys.events.adminPastList(),
        (old) => old?.filter(e => e.id !== eventId)
      )

      // Background refresh tab counts
      queryClient.invalidateQueries({ queryKey: queryKeys.events.tabCounts({}) })

      toast.success('Event deleted successfully')
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, { operation: 'delete', entity: 'event' }))
    },
  })
}
