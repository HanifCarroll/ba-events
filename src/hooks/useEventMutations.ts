import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createEventAction, updateEventAction, deleteEventAction } from '@/lib/admin'
import { queryKeys } from '@/lib/query'
import type { EventInsert, EventUpdate } from '@/lib/types'

export function useCreateEvent() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: EventInsert) => createEventAction({ data }),
    onSuccess: () => {
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
      queryClient.invalidateQueries({ queryKey: queryKeys.events.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.events.detail(variables.id) })
    },
  })
}

export function useDeleteEvent() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => deleteEventAction({ data: id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.events.all })
    },
  })
}
