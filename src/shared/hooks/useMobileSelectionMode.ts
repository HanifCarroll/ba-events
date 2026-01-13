import { useState, useCallback, useEffect } from 'react'
import { useBulkSelection } from './useBulkSelection'

interface ExternalSelectionState {
  selectedIds: Set<string>
  toggleSelect: (id: string) => void
  clearSelection: () => void
  toggleSelectAll: () => void
  isAllSelected: boolean
  handleSelectionChange: (ids: Set<string>) => void
  setSelectedIds: (ids: Set<string>) => void
}

interface UseMobileSelectionModeOptions<T extends { id: string }> {
  /** Items to manage selection for */
  items: T[]
  /**
   * Optional external selection state (e.g., from useBulkActions).
   * If provided, the hook will use this instead of creating its own selection state.
   */
  externalSelection?: ExternalSelectionState
  /**
   * Auto-exit selection mode when selection becomes empty.
   * Default: true
   */
  autoExitOnEmpty?: boolean
}

/**
 * Hook for managing iOS Photos-style mobile selection mode.
 *
 * Can work standalone (managing its own selection state) or integrate
 * with existing selection hooks like useBulkActions.
 *
 * @example
 * Standalone usage:
 * ```tsx
 * const selection = useMobileSelectionMode({ items })
 * ```
 *
 * @example
 * With existing selection hook (e.g., useBulkActions):
 * ```tsx
 * const bulk = useBulkActions(items)
 * const selection = useMobileSelectionMode({
 *   items,
 *   externalSelection: bulk,
 * })
 * // selection.isSelectionMode, selection.enterSelectionMode, etc.
 * // bulk.selectedIds, bulk.setBulkAction, etc. (for actions)
 * ```
 */
export function useMobileSelectionMode<T extends { id: string }>({
  items,
  externalSelection,
  autoExitOnEmpty = true,
}: UseMobileSelectionModeOptions<T>) {
  const [isSelectionMode, setIsSelectionMode] = useState(false)

  // Use external selection state if provided, otherwise create our own
  const internalSelection = useBulkSelection(items)
  const selection: ExternalSelectionState = externalSelection ?? internalSelection

  // Auto-exit selection mode when selection is cleared
  useEffect(() => {
    if (autoExitOnEmpty && isSelectionMode && selection.selectedIds.size === 0) {
      setIsSelectionMode(false)
    }
  }, [autoExitOnEmpty, isSelectionMode, selection.selectedIds.size])

  const enterSelectionMode = useCallback(() => {
    setIsSelectionMode(true)
  }, [])

  const exitSelectionMode = useCallback(() => {
    setIsSelectionMode(false)
    selection.clearSelection()
  }, [selection])

  /**
   * Handle long-press on an item.
   * Enters selection mode and auto-selects the pressed item.
   */
  const handleLongPress = useCallback(
    (itemId: string) => {
      setIsSelectionMode(true)
      // Auto-select the long-pressed item if not already selected
      if (!selection.selectedIds.has(itemId)) {
        selection.toggleSelect(itemId)
      }
    },
    [selection]
  )

  return {
    // Selection mode state
    isSelectionMode,
    enterSelectionMode,
    exitSelectionMode,
    handleLongPress,

    // Selection state (passthrough from internal or external)
    selectedIds: selection.selectedIds,
    setSelectedIds: selection.setSelectedIds,
    toggleSelect: selection.toggleSelect,
    toggleSelectAll: selection.toggleSelectAll,
    clearSelection: selection.clearSelection,
    handleSelectionChange: selection.handleSelectionChange,
    isAllSelected: selection.isAllSelected,
  }
}

export type UseMobileSelectionModeReturn<T extends { id: string }> = ReturnType<
  typeof useMobileSelectionMode<T>
>
