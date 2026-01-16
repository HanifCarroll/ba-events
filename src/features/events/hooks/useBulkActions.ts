import { useState, useCallback } from 'react'
import { useRouter } from '@tanstack/react-router'
import { bulkUpdateEventStatusAction, bulkUpdateLocationTbaAction, bulkDeleteEventsAction } from '../api/crud'
import { useBulkSelection } from '@/shared/hooks/useBulkSelection'

export type BulkActionType = 'delete' | 'past' | 'canceled' | 'location_tba' | null

export function useBulkActions<T extends { id: string }>(filteredEvents: T[]) {
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
      } else if (bulkAction === 'past' || bulkAction === 'canceled') {
        await bulkUpdateEventStatusAction({ data: { eventIds: ids, status: bulkAction } })
      } else if (bulkAction === 'location_tba') {
        await bulkUpdateLocationTbaAction({ data: { eventIds: ids, locationTba: true } })
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
