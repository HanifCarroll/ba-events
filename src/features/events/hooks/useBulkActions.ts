import { useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { bulkUpdateEventStatusAction, bulkDeleteEventsAction } from '../api/crud'
import { queryKeys } from '@/shared/lib/query'
import { useBulkSelection } from '@/shared/hooks/useBulkSelection'
import type { EventWithVenue, EventStatus } from '@/shared/lib/types'

export type BulkActionType = 'delete' | 'past' | 'cancelled' | null

export function useBulkActions(filteredEvents: EventWithVenue[]) {
  const queryClient = useQueryClient()
  const selection = useBulkSelection(filteredEvents)
  const [bulkAction, setBulkAction] = useState<BulkActionType>(null)
  const [isBulkProcessing, setIsBulkProcessing] = useState(false)

  const handleBulkAction = useCallback(async () => {
    if (!bulkAction || selection.selectedIds.size === 0) return
    setIsBulkProcessing(true)

    try {
      const ids = Array.from(selection.selectedIds)

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

      selection.clearSelection()
      setBulkAction(null)
    } catch (err) {
      console.error('Bulk action failed:', err)
    } finally {
      setIsBulkProcessing(false)
    }
  }, [bulkAction, selection, queryClient])

  return {
    // Selection state and methods (spread from shared hook)
    selectedIds: selection.selectedIds,
    setSelectedIds: selection.setSelectedIds,
    toggleSelect: selection.toggleSelect,
    toggleSelectAll: selection.toggleSelectAll,
    clearSelection: selection.clearSelection,
    handleSelectionChange: selection.handleSelectionChange,
    isAllSelected: selection.isAllSelected,
    // Action state and methods (event-specific)
    bulkAction,
    setBulkAction,
    isBulkProcessing,
    handleBulkAction,
  }
}

export type UseBulkActionsReturn = ReturnType<typeof useBulkActions>
