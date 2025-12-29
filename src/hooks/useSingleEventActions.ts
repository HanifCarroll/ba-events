import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { deleteEventAction, approveEventAction, rejectEventAction } from '@/lib/admin'
import type { EventWithVenue } from '@/lib/types'

export function useSingleEventActions() {
  const router = useRouter()
  const [deleteTarget, setDeleteTarget] = useState<EventWithVenue | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isApproving, setIsApproving] = useState<string | null>(null)
  const [isRejecting, setIsRejecting] = useState<string | null>(null)

  async function handleDelete() {
    if (!deleteTarget) return
    setIsDeleting(true)

    try {
      await deleteEventAction({ data: deleteTarget.id })
      setDeleteTarget(null)
      router.invalidate()
    } catch (err) {
      console.error('Delete failed:', err)
    } finally {
      setIsDeleting(false)
    }
  }

  async function handleApprove(eventId: string) {
    setIsApproving(eventId)
    try {
      await approveEventAction({ data: { eventId } })
      router.invalidate()
    } catch (err) {
      console.error('Approve failed:', err)
    } finally {
      setIsApproving(null)
    }
  }

  async function handleReject(eventId: string) {
    setIsRejecting(eventId)
    try {
      await rejectEventAction({ data: { eventId } })
      router.invalidate()
    } catch (err) {
      console.error('Reject failed:', err)
    } finally {
      setIsRejecting(null)
    }
  }

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
