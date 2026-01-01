import { useState, useCallback } from 'react'

/**
 * Generic hook for managing bulk selection of items.
 * Extracts common selection logic that can be reused across
 * different entities (events, venues, etc.).
 */
export function useBulkSelection<T extends { id: string }>(items: T[]) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

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
      if (prev.size === items.length) {
        return new Set()
      } else {
        return new Set(items.map((item) => item.id))
      }
    })
  }, [items])

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  // Handle selection change from DataTable
  const handleSelectionChange = useCallback((newIds: Set<string>) => {
    setSelectedIds(newIds)
  }, [])

  const isAllSelected = selectedIds.size === items.length && items.length > 0

  return {
    selectedIds,
    setSelectedIds,
    toggleSelect,
    toggleSelectAll,
    clearSelection,
    handleSelectionChange,
    isAllSelected,
  }
}

export type UseBulkSelectionReturn = ReturnType<typeof useBulkSelection>
