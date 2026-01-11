import { useState, useCallback } from 'react'
import { useRouter } from '@tanstack/react-router'
import { bulkUpdateEventStatusAction, bulkDeleteEventsAction } from '../api/crud'
import { useBulkSelection } from '@/shared/hooks/useBulkSelection'
import type { EventWithVenue } from '@/shared/lib/types'

export type BulkActionType = 'delete' | 'past' | 'cancelled' | null

export function useBulkActions(filteredEvents: EventWithVenue[]) {
  const router = useRouter()
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
      } else if (bulkAction === 'past' || bulkAction === 'cancelled') {
        await bulkUpdateEventStatusAction({ data: { eventIds: ids, status: bulkAction } })
      }

      // Invalidate router loader to refresh events data
      await router.invalidate()
      selection.clearSelection()
      setBulkAction(null)
    } catch (err) {
      console.error('Bulk action failed:', err)
    } finally {
      setIsBulkProcessing(false)
    }
  }, [bulkAction, selection, router])

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
