import { useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { deleteEventAction, approveEventAction, rejectEventAction } from '@/lib/admin'
import { queryKeys } from '@/lib/query'
import type { EventWithVenue } from '@/lib/types'

export function useSingleEventActions() {
  const queryClient = useQueryClient()
  const [deleteTarget, setDeleteTarget] = useState<EventWithVenue | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isApproving, setIsApproving] = useState<string | null>(null)
  const [isRejecting, setIsRejecting] = useState<string | null>(null)

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return
    setIsDeleting(true)

    try {
      await deleteEventAction({ data: deleteTarget.id })
      // Remove from cache directly
      queryClient.setQueriesData<EventWithVenue[]>(
        { queryKey: queryKeys.events.all },
        (old) => old?.filter((e) => e.id !== deleteTarget.id)
      )
      setDeleteTarget(null)
    } catch (err) {
      console.error('Delete failed:', err)
    } finally {
      setIsDeleting(false)
    }
  }, [deleteTarget, queryClient])

  const handleApprove = useCallback(async (eventId: string) => {
    setIsApproving(eventId)
    try {
      await approveEventAction({ data: { eventId } })
      // Update status in cache directly
      queryClient.setQueriesData<EventWithVenue[]>(
        { queryKey: queryKeys.events.all },
        (old) => old?.map((e) => (e.id === eventId ? { ...e, status: 'scheduled' } : e))
      )
    } catch (err) {
      console.error('Approve failed:', err)
    } finally {
      setIsApproving(null)
    }
  }, [queryClient])

  const handleReject = useCallback(async (eventId: string) => {
    setIsRejecting(eventId)
    try {
      await rejectEventAction({ data: { eventId } })
      // Update status in cache directly
      queryClient.setQueriesData<EventWithVenue[]>(
        { queryKey: queryKeys.events.all },
        (old) => old?.map((e) => (e.id === eventId ? { ...e, status: 'cancelled' } : e))
      )
    } catch (err) {
      console.error('Reject failed:', err)
    } finally {
      setIsRejecting(null)
    }
  }, [queryClient])

  return {
    deleteTarget,
    setDeleteTarget,
    isDeleting,
    isApproving,
    isRejecting,
    handleDelete,
    handleApprove,
    handleReject,
  }
}

export type UseSingleEventActionsReturn = ReturnType<typeof useSingleEventActions>
