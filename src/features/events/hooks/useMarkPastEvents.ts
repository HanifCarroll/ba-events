import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { countPastEventsAction, markPastEventsAction } from '../api/crud'

export function useMarkPastEvents() {
  const router = useRouter()
  const [showMarkPastDialog, setShowMarkPastDialog] = useState(false)
  const [pastEventsCount, setPastEventsCount] = useState(0)
  const [isMarkingPast, setIsMarkingPast] = useState(false)

  async function handleOpenMarkPastDialog() {
    const { count } = await countPastEventsAction()
    setPastEventsCount(count)
    setShowMarkPastDialog(true)
  }

  async function handleMarkPastEvents() {
    setIsMarkingPast(true)
    try {
      await markPastEventsAction()
      setShowMarkPastDialog(false)
      router.invalidate()
    } catch (err) {
      console.error('Mark past failed:', err)
      toast.error('Failed to mark past events')
    } finally {
      setIsMarkingPast(false)
    }
  }

  return {
    showMarkPastDialog,
    setShowMarkPastDialog,
    pastEventsCount,
    isMarkingPast,
    handleOpenMarkPastDialog,
    handleMarkPastEvents,
  }
}

export type UseMarkPastEventsReturn = ReturnType<typeof useMarkPastEvents>
