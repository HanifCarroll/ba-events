import { useState, useCallback } from 'react'
import { useRouter } from '@tanstack/react-router'
import { deleteEventAction } from '../api/crud'
import { approveEventAction, rejectEventAction } from '../api/moderation'
import type { EventDeleteTarget } from '@/shared/lib/types'

export function useSingleEventActions() {
  const router = useRouter()
  const [deleteTarget, setDeleteTarget] = useState<EventDeleteTarget | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isApproving, setIsApproving] = useState<string | null>(null)
  const [isRejecting, setIsRejecting] = useState<string | null>(null)

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return
    setIsDeleting(true)

    try {
      await deleteEventAction({ data: deleteTarget.id })
      // Invalidate router loader to refresh events data
      await router.invalidate()
      setDeleteTarget(null)
    } catch (err) {
      console.error('Delete failed:', err)
    } finally {
      setIsDeleting(false)
    }
  }, [deleteTarget, router])

  const handleApprove = useCallback(async (eventId: string) => {
    setIsApproving(eventId)
    try {
      await approveEventAction({ data: { eventId } })
      // Invalidate router loader to refresh events data
      await router.invalidate()
    } catch (err) {
      console.error('Approve failed:', err)
    } finally {
      setIsApproving(null)
    }
  }, [router])

  const handleReject = useCallback(async (eventId: string) => {
    setIsRejecting(eventId)
    try {
      await rejectEventAction({ data: { eventId } })
      // Invalidate router loader to refresh events data
      await router.invalidate()
    } catch (err) {
      console.error('Reject failed:', err)
    } finally {
      setIsRejecting(null)
    }
  }, [router])

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
