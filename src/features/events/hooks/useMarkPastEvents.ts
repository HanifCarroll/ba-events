import { useState } from 'react'
import { toast } from 'sonner'
import { useInvalidateCache } from '@/shared/hooks/useInvalidateCache'
import { countPastEventsAction, markPastEventsAction } from '../api/crud'

export function useMarkPastEvents() {
  const { invalidateEvents } = useInvalidateCache()
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
      await invalidateEvents()
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
