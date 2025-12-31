import { useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { bulkUpdateEventStatusAction, bulkDeleteEventsAction } from '@/lib/admin'
import { queryKeys } from '@/lib/query'
import type { EventWithVenue, EventStatus } from '@/lib/types'

export type BulkActionType = 'delete' | 'past' | 'cancelled' | null

export function useBulkActions(filteredEvents: EventWithVenue[]) {
  const queryClient = useQueryClient()
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
        // Remove deleted events from cache
        const idsSet = new Set(ids)
        queryClient.setQueriesData<EventWithVenue[]>(
          { queryKey: queryKeys.events.all },
          (old) => old?.filter((e) => !idsSet.has(e.id))
        )
      } else if (bulkAction === 'past' || bulkAction === 'cancelled') {
        await bulkUpdateEventStatusAction({ data: { eventIds: ids, status: bulkAction } })
        // Update status in cache
        const idsSet = new Set(ids)
        const newStatus: EventStatus = bulkAction
        queryClient.setQueriesData<EventWithVenue[]>(
          { queryKey: queryKeys.events.all },
          (old) => old?.map((e) => (idsSet.has(e.id) ? { ...e, status: newStatus } : e))
        )
      }

      setSelectedIds(new Set())
      setBulkAction(null)
    } catch (err) {
      console.error('Bulk action failed:', err)
    } finally {
      setIsBulkProcessing(false)
    }
  }, [bulkAction, selectedIds, queryClient])

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
