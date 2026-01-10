import { useState, useCallback } from 'react'
import { bulkDeleteVenuesAction } from '../api/crud'
import { useInvalidateCache } from '@/shared/hooks/useInvalidateCache'
import { useBulkSelection } from '@/shared/hooks/useBulkSelection'
import type { Venue } from '@/shared/lib/types'

export type VenueBulkActionType = 'delete' | 'enrich' | null

export function useVenueBulkActions(filteredVenues: Venue[]) {
  const { invalidateVenues } = useInvalidateCache()
  const selection = useBulkSelection(filteredVenues)
  const [bulkAction, setBulkAction] = useState<VenueBulkActionType>(null)
  const [isBulkProcessing, setIsBulkProcessing] = useState(false)

  const handleBulkAction = useCallback(async () => {
    if (!bulkAction || selection.selectedIds.size === 0) return
    setIsBulkProcessing(true)

    try {
      const ids = Array.from(selection.selectedIds)

      if (bulkAction === 'delete') {
        await bulkDeleteVenuesAction({ data: ids })
        // Invalidate query cache to refresh venues list
        await invalidateVenues()
      }

      selection.clearSelection()
      setBulkAction(null)
    } catch (err) {
      console.error('Bulk action failed:', err)
    } finally {
      setIsBulkProcessing(false)
    }
  }, [bulkAction, selection, invalidateVenues])

  return {
    // Selection state and methods (spread from shared hook)
    selectedIds: selection.selectedIds,
    setSelectedIds: selection.setSelectedIds,
    toggleSelect: selection.toggleSelect,
    toggleSelectAll: selection.toggleSelectAll,
    clearSelection: selection.clearSelection,
    handleSelectionChange: selection.handleSelectionChange,
    isAllSelected: selection.isAllSelected,
    // Action state and methods (venue-specific)
    bulkAction,
    setBulkAction,
    isBulkProcessing,
    handleBulkAction,
  }
}

export type UseVenueBulkActionsReturn = ReturnType<typeof useVenueBulkActions>
