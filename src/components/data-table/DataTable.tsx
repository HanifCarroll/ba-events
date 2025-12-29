import { useState, useMemo, useCallback, useRef, ReactNode, CSSProperties } from 'react'
import {
  ColumnDef,
  ColumnOrderState,
  ColumnSizingState,
  SortingState,
  VisibilityState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  Row,
  RowSelectionState,
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
import { cn } from '@/lib/utils'
import { Checkbox } from '@/components/ui/checkbox'
import { useColumnPreferences } from './hooks/useColumnPreferences'
import { DataTableViewOptions } from './DataTableViewOptions'

// Selection adapter functions
function setToRowSelection(ids: Set<string>, data: { id: string }[]): RowSelectionState {
  const state: RowSelectionState = {}
  data.forEach((row, index) => {
    if (ids.has(row.id)) {
      state[index] = true
    }
  })
  return state
}

function rowSelectionToSet(
  state: RowSelectionState,
  data: { id: string }[]
): Set<string> {
  const ids = new Set<string>()
  Object.keys(state).forEach((indexStr) => {
    const index = parseInt(indexStr, 10)
    if (state[index] && data[index]) {
      ids.add(data[index].id)
    }
  })
  return ids
}

// Drag handle for column reordering
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
        'cursor-grab p-0.5 hover:text-foreground rounded transition-colors',
        isDragging ? 'cursor-grabbing opacity-50' : 'opacity-40 hover:opacity-100'
      )}
      aria-label="Reorder column"
    >
      <GripVertical className="h-3 w-3" />
    </button>
  )
}

// Sortable header cell
function SortableHeader({
  header,
  children,
  enableReordering,
}: {
  header: {
    column: { id: string; getSize: () => number }
    getContext: () => unknown
  }
  children: ReactNode
  enableReordering?: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: header.column.id,
    })

  const style: CSSProperties = {
    width: header.column.getSize(),
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.8 : 1,
    position: 'relative' as const,
    zIndex: isDragging ? 1 : 0,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center gap-1.5 px-4 py-3 text-muted-foreground font-medium text-sm',
        'select-none shrink-0'
      )}
      {...(enableReordering ? { ...attributes, ...listeners } : {})}
    >
      {children}
    </div>
  )
}

// Resize handle component
function ResizeHandle({
  isResizing,
  onMouseDown,
  onTouchStart,
}: {
  isResizing: boolean
  onMouseDown: (e: React.MouseEvent) => void
  onTouchStart: (e: React.TouchEvent) => void
}) {
  return (
    <div
      className={cn(
        'absolute right-0 top-0 h-full w-1 cursor-col-resize select-none touch-none',
        'hover:bg-primary/50 transition-colors',
        isResizing && 'bg-primary'
      )}
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
    />
  )
}

export interface DataTableProps<TData extends { id: string }> {
  columns: ColumnDef<TData>[]
  data: TData[]

  // Feature flags
  enableRowSelection?: boolean
  enableColumnResizing?: boolean
  enableColumnReordering?: boolean
  enableMultiSort?: boolean
  enableVirtualization?: boolean

  // Selection (controlled)
  selectedIds?: Set<string>
  onSelectionChange?: (ids: Set<string>) => void

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
}

export function DataTable<TData extends { id: string }>({
  columns: userColumns,
  data,
  enableRowSelection = false,
  enableColumnResizing = true,
  enableColumnReordering = true,
  enableMultiSort = true,
  enableVirtualization = false,
  selectedIds,
  onSelectionChange,
  tableId = 'default',
  estimatedRowHeight = 64,
  containerHeight = 'calc(100vh - 420px)',
  rowClassName,
  toolbarLeft,
  toolbarRight,
  emptyState,
}: DataTableProps<TData>) {
  // Preferences (persisted)
  const preferences = useColumnPreferences(tableId)

  // Local state
  const [sorting, setSorting] = useState<SortingState>([])

  // Selection state - convert Set<string> to RowSelectionState for internal use
  const rowSelection = useMemo(() => {
    if (!selectedIds) return {}
    return setToRowSelection(selectedIds, data)
  }, [selectedIds, data])

  // Handle selection change
  const handleSelectionChange = useCallback(
    (updater: RowSelectionState | ((prev: RowSelectionState) => RowSelectionState)) => {
      if (!onSelectionChange) return
      const newState = typeof updater === 'function' ? updater(rowSelection) : updater
      onSelectionChange(rowSelectionToSet(newState, data))
    },
    [onSelectionChange, rowSelection, data]
  )

  // Column order - use preferences or default to column order
  const columnIds = useMemo(
    () => userColumns.map((col) => col.id || String(col.header)),
    [userColumns]
  )

  const [columnOrder, setColumnOrderState] = useState<ColumnOrderState>(() => {
    if (preferences.order.length > 0) {
      // Use saved order, but include any new columns
      const savedOrder = preferences.order.filter((id) => columnIds.includes(id))
      const newColumns = columnIds.filter((id) => !preferences.order.includes(id))
      return [...savedOrder, ...newColumns]
    }
    return columnIds
  })

  // Update column order in preferences
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
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label="Select row"
        />
      ),
    }

    return [selectColumn, ...userColumns]
  }, [userColumns, enableRowSelection])

  // Initialize column sizing from preferences
  const [columnSizing, setColumnSizingState] = useState<ColumnSizingState>(
    preferences.sizing
  )

  // Update sizing preferences on change
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

  // Initialize visibility from preferences
  const [columnVisibility, setColumnVisibilityState] = useState<VisibilityState>(
    preferences.visibility
  )

  // Update visibility preferences on change
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
      columnSizing,
      columnVisibility,
      columnOrder: enableRowSelection ? ['select', ...columnOrder] : columnOrder,
      rowSelection,
    },
    onSortingChange: setSorting,
    onColumnSizingChange: setColumnSizing,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnOrderChange: (order) => {
      // Remove 'select' column from persisted order
      const filtered = (typeof order === 'function' ? order(columnOrder) : order).filter(
        (id) => id !== 'select'
      )
      setColumnOrder(filtered)
    },
    onRowSelectionChange: handleSelectionChange,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    columnResizeMode: 'onChange',
    enableMultiSort,
    enableRowSelection,
    getRowId: (row) => row.id,
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

  // Handle drag end for column reordering
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
  const parentRef = useRef<HTMLDivElement>(null)
  const { rows } = table.getRowModel()

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimatedRowHeight,
    overscan: 10,
  })

  // Get visible column IDs for sortable context
  const visibleColumnIds = table.getVisibleLeafColumns().map((col) => col.id)

  // Render header
  const renderHeader = () => (
    <DndContext
      sensors={enableColumnReordering ? sensors : undefined}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
      modifiers={[restrictToHorizontalAxis]}
    >
      <div className="flex border-b border-border/50 bg-muted/20">
        <SortableContext
          items={visibleColumnIds}
          strategy={horizontalListSortingStrategy}
          disabled={!enableColumnReordering}
        >
          {table.getHeaderGroups().map((headerGroup) =>
            headerGroup.headers.map((header) => {
              const canReorder =
                enableColumnReordering &&
                header.column.id !== 'select' &&
                header.column.getCanHide()

              return (
                <SortableHeader
                  key={header.id}
                  header={header}
                  enableReordering={canReorder}
                >
                  {canReorder && <DragHandle column={header.column} />}
                  <div className="flex-1">
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </div>
                  {enableColumnResizing && header.column.getCanResize() && (
                    <ResizeHandle
                      isResizing={header.column.getIsResizing()}
                      onMouseDown={header.getResizeHandler()}
                      onTouchStart={header.getResizeHandler()}
                    />
                  )}
                </SortableHeader>
              )
            })
          )}
        </SortableContext>
      </div>
    </DndContext>
  )

  // Render virtualized body
  const renderVirtualizedBody = () => (
    <div
      ref={parentRef}
      style={{ height: containerHeight }}
      className="overflow-auto"
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const row = rows[virtualRow.index]
          return (
            <div
              key={row.id}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <div
                className={cn(
                  'flex items-center border-b border-border/30 hover:bg-muted/30 transition-colors',
                  row.getIsSelected() && 'bg-primary/5',
                  rowClassName?.(row)
                )}
              >
                {row.getVisibleCells().map((cell) => (
                  <div
                    key={cell.id}
                    style={{ width: cell.column.getSize() }}
                    className="shrink-0 px-4 py-3"
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )

  // Render standard body
  const renderStandardBody = () => (
    <div>
      {rows.map((row) => (
        <div
          key={row.id}
          className={cn(
            'flex items-center border-b border-border/30 hover:bg-muted/30 transition-colors',
            row.getIsSelected() && 'bg-primary/5',
            rowClassName?.(row)
          )}
        >
          {row.getVisibleCells().map((cell) => (
            <div
              key={cell.id}
              style={{ width: cell.column.getSize() }}
              className="shrink-0 px-4 py-3"
            >
              {flexRender(cell.column.columnDef.cell, cell.getContext())}
            </div>
          ))}
        </div>
      ))}
    </div>
  )

  // Empty state
  if (data.length === 0 && emptyState) {
    return <>{emptyState}</>
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      {(toolbarLeft || toolbarRight) && (
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">{toolbarLeft}</div>
          <div className="flex items-center gap-2">
            {toolbarRight}
            <DataTableViewOptions table={table} />
          </div>
        </div>
      )}

      {/* Table container */}
      <div className="bg-card/50 rounded-xl border border-border/50 overflow-hidden">
        {renderHeader()}
        {enableVirtualization ? renderVirtualizedBody() : renderStandardBody()}
      </div>
    </div>
  )
}
