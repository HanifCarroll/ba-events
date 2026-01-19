import { useState, useCallback } from 'react'
import { useDeleteEvent, useApproveEvent, useRejectEvent } from './useEventMutations'
import type { EventDeleteTarget } from '@/shared/lib/types'

export function useSingleEventActions() {
  const deleteEventMutation = useDeleteEvent()
  const approveEventMutation = useApproveEvent()
  const rejectEventMutation = useRejectEvent()
  const [deleteTarget, setDeleteTarget] = useState<EventDeleteTarget | null>(null)

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return

    try {
      await deleteEventMutation.mutateAsync(deleteTarget.id)
      setDeleteTarget(null)
    } catch (err) {
      console.error('Delete failed:', err)
    }
  }, [deleteTarget, deleteEventMutation])

  const handleApprove = useCallback(async (eventId: string) => {
    try {
      await approveEventMutation.mutateAsync({ eventId })
    } catch (err) {
      console.error('Approve failed:', err)
    }
  }, [approveEventMutation])

  const handleReject = useCallback(async (eventId: string) => {
    try {
      await rejectEventMutation.mutateAsync(eventId)
    } catch (err) {
      console.error('Reject failed:', err)
    }
  }, [rejectEventMutation])

  return {
    deleteTarget,
    setDeleteTarget,
    isDeleting: deleteEventMutation.isPending,
    isApproving: approveEventMutation.isPending ? 'pending' : null,
    isRejecting: rejectEventMutation.isPending ? 'pending' : null,
    handleDelete,
    handleApprove,
    handleReject,
  }
}

export type UseSingleEventActionsReturn = ReturnType<typeof useSingleEventActions>
