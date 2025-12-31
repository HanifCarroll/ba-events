import { useState, useCallback } from 'react'
import { useRouter } from '@tanstack/react-router'
import { bulkDeleteVenuesAction } from '@/lib/admin'
import { useBulkSelection } from './useBulkSelection'
import type { Venue } from '@/lib/types'

export type VenueBulkActionType = 'delete' | 'enrich' | null

export function useVenueBulkActions(filteredVenues: Venue[]) {
  const router = useRouter()
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
        // Invalidate router to refresh venues list
        router.invalidate()
      }

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
    // Action state and methods (venue-specific)
    bulkAction,
    setBulkAction,
    isBulkProcessing,
    handleBulkAction,
  }
}

export type UseVenueBulkActionsReturn = ReturnType<typeof useVenueBulkActions>
