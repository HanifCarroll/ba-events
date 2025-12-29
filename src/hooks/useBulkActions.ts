import { useState, useCallback } from 'react'
import { useRouter } from '@tanstack/react-router'
import { bulkUpdateEventStatusAction, bulkDeleteEventsAction } from '@/lib/admin'
import type { EventWithVenue } from '@/lib/types'

export type BulkActionType = 'delete' | 'past' | 'cancelled' | null

export function useBulkActions(filteredEvents: EventWithVenue[]) {
  const router = useRouter()
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkAction, setBulkAction] = useState<BulkActionType>(null)
  const [isBulkProcessing, setIsBulkProcessing] = useState(false)

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (prev.size === filteredEvents.length) {
        return new Set()
      } else {
        return new Set(filteredEvents.map((e) => e.id))
      }
    })
  }, [filteredEvents])

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  const handleBulkAction = useCallback(async () => {
    if (!bulkAction || selectedIds.size === 0) return
    setIsBulkProcessing(true)

    try {
      const ids = Array.from(selectedIds)

      if (bulkAction === 'delete') {
        await bulkDeleteEventsAction({ data: ids })
      } else if (bulkAction === 'past' || bulkAction === 'cancelled') {
        await bulkUpdateEventStatusAction({ data: { eventIds: ids, status: bulkAction } })
      }

      setSelectedIds(new Set())
      setBulkAction(null)
      router.invalidate()
    } catch (err) {
      console.error('Bulk action failed:', err)
    } finally {
      setIsBulkProcessing(false)
    }
  }, [bulkAction, selectedIds, router])

  return {
    selectedIds,
    setSelectedIds,
    bulkAction,
    setBulkAction,
    isBulkProcessing,
    toggleSelect,
    toggleSelectAll,
    clearSelection,
    handleBulkAction,
  }
}

export type UseBulkActionsReturn = ReturnType<typeof useBulkActions>
