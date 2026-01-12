import { useState, useMemo, useCallback, useRef, ReactNode, CSSProperties, MouseEvent } from 'react'
import {
  ColumnDef,
  ColumnFiltersState,
  ColumnOrderState,
  ColumnSizingState,
  PaginationState,
  SortingState,
  VisibilityState,
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  Row,
  RowSelectionState,
  Table,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { restrictToHorizontalAxis } from '@dnd-kit/modifiers'
import { GripVertical } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { Checkbox } from '@/shared/ui/checkbox'
import { useColumnPreferences } from './hooks/useColumnPreferences'
import { DataTableViewOptions } from './DataTableViewOptions'

// Selection adapter functions
function setToRowSelection(ids: Set<string>): RowSelectionState {
  const state: RowSelectionState = {}
  ids.forEach((id) => {
    state[id] = true
  })
  return state
}

function rowSelectionToSet(state: RowSelectionState): Set<string> {
  const ids = new Set<string>()
  Object.keys(state).forEach((id) => {
    if (state[id]) {
      ids.add(id)
    }
  })
  return ids
}

// Helper to get row range between two row IDs for shift-click selection
function getRowRange<T>(rows: Row<T>[], idA: string, idB: string): Row<T>[] {
  const range: Row<T>[] = []
  let foundStart = false
  let foundEnd = false

  for (const row of rows) {
    if (row.id === idA || row.id === idB) {
      if (foundStart) {
        foundEnd = true
      }
      if (!foundStart) {
        foundStart = true
      }
    }

    if (foundStart) {
      range.push(row)
    }

    if (foundEnd) {
      break
    }
  }

  return range
}

// Selection checkbox cell with shift-click support
function SelectCell<T>({
  row,
  table,
  lastSelectedIdRef,
}: {
  row: Row<T>
  table: Table<T>
  lastSelectedIdRef: React.MutableRefObject<string | null>
}) {
  const handleCheckedChange = useCallback(
    (checked: boolean) => {
      // Normal toggle - this handles keyboard and non-shift clicks
      row.toggleSelected(checked)
      lastSelectedIdRef.current = row.id
    },
    [row, lastSelectedIdRef]
  )

  const handleClick = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      if (e.shiftKey && lastSelectedIdRef.current && lastSelectedIdRef.current !== row.id) {
        // Prevent default checkbox behavior - we'll handle selection manually
        e.preventDefault()

        // Shift-click: select range
        const { rows } = table.getRowModel()
        const rowsInRange = getRowRange(rows, row.id, lastSelectedIdRef.current)

        if (rowsInRange.length > 0) {
          // Determine selection state based on the last selected row
          const lastRow = rows.find((r) => r.id === lastSelectedIdRef.current)
          const shouldSelect = lastRow ? lastRow.getIsSelected() : true

          // Apply selection to all rows in range
          rowsInRange.forEach((r) => {
            if (r.getIsSelected() !== shouldSelect) {
              r.toggleSelected(shouldSelect)
            }
          })
        }

        // Update last selected reference
        lastSelectedIdRef.current = row.id
      }
      // For non-shift clicks, let onCheckedChange handle it
    },
    [row, table, lastSelectedIdRef]
  )

  return (
    <Checkbox
      checked={row.getIsSelected()}
      onClick={handleClick}
      onCheckedChange={handleCheckedChange}
      aria-label="Select row"
    />
  )
}

// Drag handle for column reordering - positioned absolutely to not affect content alignment
function DragHandle({ column }: { column: { id: string } }) {
  const { attributes, listeners, setNodeRef, isDragging } = useSortable({
    id: column.id,
  })

  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn(
        'absolute left-1 top-1/2 -translate-y-1/2 cursor-grab p-0.5 hover:text-foreground rounded transition-all',
        isDragging ? 'cursor-grabbing opacity-50' : 'opacity-0 group-hover:opacity-40 hover:!opacity-100'
      )}
      aria-label="Reorder column"
    >
      <GripVertical className="h-3 w-3" />
    </button>
  )
}

// Sortable header cell component for use with <th>
function SortableHeaderCell({
  headerId,
  columnId,
  width,
  children,
  enableReordering,
  enableResizing,
  isResizing,
  onResize,
}: {
  headerId: string
  columnId: string
  width: number
  children: ReactNode
  enableReordering?: boolean
  enableResizing?: boolean
  isResizing?: boolean
  onResize?: (e: React.MouseEvent | React.TouchEvent) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: columnId,
    })

  const style: CSSProperties = {
    width,
    minWidth: width,
    maxWidth: width,
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.8 : 1,
    position: 'relative' as const,
  }

  return (
    <th
      key={headerId}
      ref={setNodeRef}
      style={style}
      className={cn(
        'px-4 py-3 text-left text-muted-foreground font-medium text-sm',
        'bg-muted/20 select-none group',
        isDragging && 'z-10'
      )}
      {...(enableReordering ? { ...attributes, ...listeners } : {})}
    >
      {enableReordering && <DragHandle column={{ id: columnId }} />}
      {children}
      {enableResizing && (
        <div
          className={cn(
            'absolute right-0 top-0 h-full w-1 cursor-col-resize select-none touch-none',
            'hover:bg-primary/50 transition-colors',
            isResizing && 'bg-primary'
          )}
          onMouseDown={onResize}
          onTouchStart={onResize}
        />
      )}
    </th>
  )
}

export interface DataTableProps<TData extends { id: string }> {
  columns: ColumnDef<TData>[]
  data: TData[]

  // Feature flags
  enableRowSelection?: boolean
  enableColumnResizing?: boolean
  enableColumnReordering?: boolean
  enableColumnFiltering?: boolean
  enableMultiSort?: boolean
  enableVirtualization?: boolean
  enablePagination?: boolean

  // Selection (controlled)
  selectedIds?: Set<string>
  onSelectionChange?: (ids: Set<string>) => void

  // Filtering (controlled, optional)
  columnFilters?: ColumnFiltersState
  onColumnFiltersChange?: (filters: ColumnFiltersState) => void

  // Sorting (controlled, optional)
  sorting?: SortingState
  onSortingChange?: (sorting: SortingState) => void

  // Pagination (controlled, optional) - for server-side pagination
  manualPagination?: boolean
  pageCount?: number
  pagination?: PaginationState
  onPaginationChange?: (pagination: PaginationState) => void

  // Loading state - shows dimmed content while fetching new data
  isLoading?: boolean

  // Persistence
  tableId?: string

  // Virtualization
  estimatedRowHeight?: number
  containerHeight?: string

  // Row props
  rowClassName?: (row: Row<TData>) => string

  // Toolbar slots
  toolbarLeft?: ReactNode
  toolbarRight?: ReactNode

  // Empty state
  emptyState?: ReactNode

  // Pagination slot - for custom pagination controls
  paginationSlot?: ReactNode

  // Custom meta passed to table (accessible in cell renderers via table.options.meta)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  meta?: any
}

export function DataTable<TData extends { id: string }>({
  columns: userColumns,
  data,
  enableRowSelection = false,
  enableColumnResizing = true,
  enableColumnReordering = true,
  enableColumnFiltering = false,
  enableMultiSort = true,
  enableVirtualization = false,
  enablePagination = true,
  selectedIds,
  onSelectionChange,
  columnFilters: controlledColumnFilters,
  onColumnFiltersChange,
  sorting: controlledSorting,
  onSortingChange,
  manualPagination = false,
  pageCount,
  pagination: controlledPagination,
  onPaginationChange,
  isLoading = false,
  tableId = 'default',
  estimatedRowHeight = 64,
  containerHeight = 'calc(100vh - 420px)',
  rowClassName,
  toolbarLeft,
  toolbarRight,
  emptyState,
  paginationSlot,
  meta,
}: DataTableProps<TData>) {
  // Preferences (persisted)
  const preferences = useColumnPreferences(tableId)

  // Track last selected row for shift-click range selection
  const lastSelectedIdRef = useRef<string | null>(null)

  // Local state for uncontrolled modes
  const [internalSorting, setInternalSorting] = useState<SortingState>([])
  const [internalColumnFilters, setInternalColumnFilters] = useState<ColumnFiltersState>([])

  // Support both controlled and uncontrolled sorting
  const sorting = controlledSorting ?? internalSorting
  const setSorting = useCallback(
    (updater: SortingState | ((prev: SortingState) => SortingState)) => {
      const newSorting = typeof updater === 'function' ? updater(sorting) : updater
      if (onSortingChange) {
        onSortingChange(newSorting)
      } else {
        setInternalSorting(newSorting)
      }
    },
    [sorting, onSortingChange]
  )

  // Support both controlled and uncontrolled column filters
  const columnFilters = controlledColumnFilters ?? internalColumnFilters
  const setColumnFilters = useCallback(
    (updater: ColumnFiltersState | ((prev: ColumnFiltersState) => ColumnFiltersState)) => {
      const newFilters = typeof updater === 'function' ? updater(columnFilters) : updater
      if (onColumnFiltersChange) {
        onColumnFiltersChange(newFilters)
      } else {
        setInternalColumnFilters(newFilters)
      }
    },
    [columnFilters, onColumnFiltersChange]
  )

  // Support controlled pagination (for server-side pagination)
  const [internalPagination, setInternalPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 25,
  })

  const pagination = controlledPagination ?? internalPagination
  const setPagination = useCallback(
    (updater: PaginationState | ((prev: PaginationState) => PaginationState)) => {
      const newPagination = typeof updater === 'function' ? updater(pagination) : updater
      if (onPaginationChange) {
        onPaginationChange(newPagination)
      } else {
        setInternalPagination(newPagination)
      }
    },
    [pagination, onPaginationChange]
  )

  // Selection state
  const rowSelection = useMemo(() => {
    if (!selectedIds) return {}
    return setToRowSelection(selectedIds)
  }, [selectedIds])

  const handleSelectionChange = useCallback(
    (updater: RowSelectionState | ((prev: RowSelectionState) => RowSelectionState)) => {
      if (!onSelectionChange) return
      const newState = typeof updater === 'function' ? updater(rowSelection) : updater
      onSelectionChange(rowSelectionToSet(newState))
    },
    [onSelectionChange, rowSelection]
  )

  // Column order
  const columnIds = useMemo(
    () => userColumns.map((col) => col.id || String(col.header)),
    [userColumns]
  )

  const [columnOrder, setColumnOrderState] = useState<ColumnOrderState>(() => {
    if (preferences.order.length > 0) {
      const savedOrder = preferences.order.filter((id) => columnIds.includes(id))
      const newColumns = columnIds.filter((id) => !preferences.order.includes(id))
      return [...savedOrder, ...newColumns]
    }
    return columnIds
  })

  const setColumnOrder = useCallback(
    (order: ColumnOrderState | ((prev: ColumnOrderState) => ColumnOrderState)) => {
      setColumnOrderState((prev) => {
        const newOrder = typeof order === 'function' ? order(prev) : order
        preferences.setOrder(newOrder)
        return newOrder
      })
    },
    [preferences]
  )

  // Prepend checkbox column if selection is enabled
  const columns = useMemo(() => {
    if (!enableRowSelection) return userColumns

    const selectColumn: ColumnDef<TData> = {
      id: 'select',
      size: 50,
      minSize: 50,
      maxSize: 50,
      enableResizing: false,
      enableSorting: false,
      enableHiding: false,
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && 'indeterminate')
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Select all"
        />
      ),
      cell: ({ row, table }) => (
        <SelectCell row={row} table={table} lastSelectedIdRef={lastSelectedIdRef} />
      ),
    }

    return [selectColumn, ...userColumns]
  }, [userColumns, enableRowSelection])

  // Column sizing
  const [columnSizing, setColumnSizingState] = useState<ColumnSizingState>(
    preferences.sizing
  )

  const setColumnSizing = useCallback(
    (sizing: ColumnSizingState | ((prev: ColumnSizingState) => ColumnSizingState)) => {
      setColumnSizingState((prev) => {
        const newSizing = typeof sizing === 'function' ? sizing(prev) : sizing
        preferences.setSizing(newSizing)
        return newSizing
      })
    },
    [preferences]
  )

  // Column visibility
  const [columnVisibility, setColumnVisibilityState] = useState<VisibilityState>(
    preferences.visibility
  )

  const setColumnVisibility = useCallback(
    (visibility: VisibilityState | ((prev: VisibilityState) => VisibilityState)) => {
      setColumnVisibilityState((prev) => {
        const newVisibility = typeof visibility === 'function' ? visibility(prev) : visibility
        preferences.setVisibility(newVisibility)
        return newVisibility
      })
    },
    [preferences]
  )

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      columnFilters,
      columnSizing,
      columnVisibility,
      columnOrder: enableRowSelection ? ['select', ...columnOrder] : columnOrder,
      rowSelection,
      ...(enablePagination ? { pagination } : {}),
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnSizingChange: setColumnSizing,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnOrderChange: (order) => {
      const filtered = (typeof order === 'function' ? order(columnOrder) : order).filter(
        (id) => id !== 'select'
      )
      setColumnOrder(filtered)
    },
    onRowSelectionChange: handleSelectionChange,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: enableColumnFiltering ? getFilteredRowModel() : undefined,
    getFacetedRowModel: enableColumnFiltering ? getFacetedRowModel() : undefined,
    getFacetedUniqueValues: enableColumnFiltering ? getFacetedUniqueValues() : undefined,
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel:
      enablePagination && !manualPagination ? getPaginationRowModel() : undefined,
    columnResizeMode: 'onChange',
    enableMultiSort,
    enableRowSelection,
    enableColumnFilters: enableColumnFiltering,
    manualPagination,
    pageCount: manualPagination ? pageCount : undefined,
    getRowId: (row) => row.id,
    meta,
  })

  // DnD sensors
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 100, tolerance: 5 },
    }),
    useSensor(KeyboardSensor)
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (active && over && active.id !== over.id) {
        setColumnOrder((prev) => {
          const oldIndex = prev.indexOf(String(active.id))
          const newIndex = prev.indexOf(String(over.id))
          return arrayMove(prev, oldIndex, newIndex)
        })
      }
    },
    [setColumnOrder]
  )

  // Virtualization
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const { rows } = table.getRowModel()

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => estimatedRowHeight,
    overscan: 10,
  })

  // Get visible column IDs for sortable context
  const visibleColumnIds = table.getVisibleLeafColumns().map((col) => col.id)

  // Calculate total table width
  const totalTableWidth = table.getVisibleLeafColumns().reduce((sum, col) => sum + col.getSize(), 0)

  // Empty state
  if (data.length === 0 && emptyState) {
    return <>{emptyState}</>
  }

  // Check if using percentage-based height (needs special handling for flex containers)
  const isPercentageHeight = enableVirtualization && containerHeight.includes('%')

  return (
    <div className={cn(
      isPercentageHeight ? 'h-full flex flex-col' : 'space-y-4'
    )}>
      {/* Toolbar */}
      {(toolbarLeft || toolbarRight) && (
        <div className={cn(
          'flex items-center justify-between gap-4',
          isPercentageHeight && 'shrink-0 mb-4'
        )}>
          <div className="flex items-center gap-4">{toolbarLeft}</div>
          <div className="flex items-center gap-2">
            {toolbarRight}
            <DataTableViewOptions table={table} />
          </div>
        </div>
      )}

      {/* Table container - single scroll container for both header and body */}
      <div className={cn(
        'bg-card/50 rounded-xl border border-border/50 overflow-hidden transition-opacity',
        isLoading && 'opacity-60',
        isPercentageHeight && 'flex-1 min-h-0 flex flex-col'
      )}>
        <div
          ref={scrollContainerRef}
          className={cn(
            'overflow-auto',
            isPercentageHeight && 'flex-1 min-h-0'
          )}
          style={{
            ...(!isPercentageHeight && enableVirtualization
              ? { maxHeight: containerHeight }
              : {}),
          }}
        >
          <DndContext
            sensors={enableColumnReordering ? sensors : undefined}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
            modifiers={[restrictToHorizontalAxis]}
          >
            <SortableContext
              items={visibleColumnIds}
              strategy={horizontalListSortingStrategy}
              disabled={!enableColumnReordering}
            >
              <table
                className="w-full border-collapse"
                style={{ minWidth: totalTableWidth }}
              >
                {/* Sticky header */}
                <thead className="sticky top-0 z-10 bg-card/95 backdrop-blur-sm">
                  {table.getHeaderGroups().map((headerGroup) => (
                    <tr key={headerGroup.id} className="border-b border-border/50">
                      {headerGroup.headers.map((header) => {
                        const canReorder =
                          enableColumnReordering &&
                          header.column.id !== 'select' &&
                          header.column.getCanHide()

                        return (
                          <SortableHeaderCell
                            key={header.id}
                            headerId={header.id}
                            columnId={header.column.id}
                            width={header.column.getSize()}
                            enableReordering={canReorder}
                            enableResizing={enableColumnResizing && header.column.getCanResize()}
                            isResizing={header.column.getIsResizing()}
                            onResize={header.getResizeHandler()}
                          >
                            {header.isPlaceholder
                              ? null
                              : flexRender(header.column.columnDef.header, header.getContext())}
                          </SortableHeaderCell>
                        )
                      })}
                    </tr>
                  ))}
                </thead>

                {/* Body */}
                <tbody>
                  {enableVirtualization ? (
                    // Virtualized rows
                    <>
                      {/* Spacer for virtualization */}
                      {virtualizer.getVirtualItems().length > 0 && (
                        <tr>
                          <td
                            colSpan={table.getVisibleLeafColumns().length}
                            style={{ height: virtualizer.getVirtualItems()[0]?.start || 0 }}
                          />
                        </tr>
                      )}
                      {virtualizer.getVirtualItems().map((virtualRow) => {
                        const row = rows[virtualRow.index]
                        return (
                          <tr
                            key={row.id}
                            className={cn(
                              'border-b border-border/30 hover:bg-muted/30 transition-colors',
                              row.getIsSelected() && 'bg-primary/5',
                              rowClassName?.(row)
                            )}
                          >
                            {row.getVisibleCells().map((cell) => (
                              <td
                                key={cell.id}
                                style={{
                                  width: cell.column.getSize(),
                                  minWidth: cell.column.getSize(),
                                  maxWidth: cell.column.getSize(),
                                }}
                                className="px-4 py-3"
                              >
                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                              </td>
                            ))}
                          </tr>
                        )
                      })}
                      {/* Bottom spacer for virtualization */}
                      {virtualizer.getVirtualItems().length > 0 && (
                        <tr>
                          <td
                            colSpan={table.getVisibleLeafColumns().length}
                            style={{
                              height:
                                virtualizer.getTotalSize() -
                                (virtualizer.getVirtualItems()[virtualizer.getVirtualItems().length - 1]?.end || 0),
                            }}
                          />
                        </tr>
                      )}
                    </>
                  ) : (
                    // Standard rows
                    rows.map((row) => (
                      <tr
                        key={row.id}
                        className={cn(
                          'border-b border-border/30 hover:bg-muted/30 transition-colors',
                          row.getIsSelected() && 'bg-primary/5',
                          rowClassName?.(row)
                        )}
                      >
                        {row.getVisibleCells().map((cell) => (
                          <td
                            key={cell.id}
                            style={{
                              width: cell.column.getSize(),
                              minWidth: cell.column.getSize(),
                              maxWidth: cell.column.getSize(),
                            }}
                            className="px-4 py-3"
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </SortableContext>
          </DndContext>
        </div>
      </div>

      {/* Pagination controls */}
      {paginationSlot}
    </div>
  )
}
