import { useState, useCallback } from 'react'
import { useRouter } from '@tanstack/react-router'
import { bulkDeleteVenuesAction } from '@/lib/admin'
import type { Venue } from '@/lib/types'

export type VenueBulkActionType = 'delete' | null

export function useVenueBulkActions(filteredVenues: Venue[]) {
  const router = useRouter()
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkAction, setBulkAction] = useState<VenueBulkActionType>(null)
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
      if (prev.size === filteredVenues.length) {
        return new Set()
      } else {
        return new Set(filteredVenues.map((v) => v.id))
      }
    })
  }, [filteredVenues])

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  const handleBulkAction = useCallback(async () => {
    if (!bulkAction || selectedIds.size === 0) return
    setIsBulkProcessing(true)

    try {
      const ids = Array.from(selectedIds)

      if (bulkAction === 'delete') {
        await bulkDeleteVenuesAction({ data: ids })
        // Invalidate router to refresh venues list
        router.invalidate()
      }

      setSelectedIds(new Set())
      setBulkAction(null)
    } catch (err) {
      console.error('Bulk action failed:', err)
    } finally {
      setIsBulkProcessing(false)
    }
  }, [bulkAction, selectedIds, router])

  // Handle selection change from DataTable
  const handleSelectionChange = useCallback(
    (newIds: Set<string>) => {
      setSelectedIds(newIds)
    },
    []
  )

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
    handleSelectionChange,
  }
}

export type UseVenueBulkActionsReturn = ReturnType<typeof useVenueBulkActions>
