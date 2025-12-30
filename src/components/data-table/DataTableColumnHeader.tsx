import { Column } from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ArrowUpDown, EyeOff, Filter, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export type FilterType = 'text' | 'select'

export interface FilterOption {
  label: string
  value: string
}

interface DataTableColumnHeaderProps<TData, TValue> {
  column: Column<TData, TValue>
  title: string
  className?: string
  /** Enable filtering for this column */
  enableFilter?: boolean
  /** Type of filter: 'text' for free text, 'select' for dropdown */
  filterType?: FilterType
  /**
   * For select filters: map of value -> display label.
   * Options are derived from actual data via getFacetedUniqueValues().
   * If not provided, raw values are used as labels.
   */
  filterLabelMap?: Record<string, string>
  /** Placeholder text for filter input */
  filterPlaceholder?: string
}

export function DataTableColumnHeader<TData, TValue>({
  column,
  title,
  className,
  enableFilter = false,
  filterType = 'text',
  filterLabelMap = {},
  filterPlaceholder,
}: DataTableColumnHeaderProps<TData, TValue>) {
  const canFilter = enableFilter && column.getCanFilter()
  const filterValue = column.getFilterValue() as string | undefined
  const isFiltered = filterValue !== undefined && filterValue !== ''

  // Get unique values from the data for select filters
  const facetedValues = column.getFacetedUniqueValues()
  const selectOptions: FilterOption[] = filterType === 'select'
    ? Array.from(facetedValues.keys())
        .filter((value): value is string => typeof value === 'string' && value !== '')
        .sort()
        .map((value) => ({
          value,
          label: filterLabelMap[value] || value,
        }))
    : []

  if (!column.getCanSort() && !column.getCanHide() && !canFilter) {
    return <div className={cn(className)}>{title}</div>
  }

  const sorted = column.getIsSorted()
  const sortIndex = column.getSortIndex()

  return (
    <div className={cn('flex items-center', className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'h-7 px-2 data-[state=open]:bg-accent hover:bg-muted/50',
              isFiltered && 'text-primary'
            )}
          >
            <span>{title}</span>
            {isFiltered && <Filter className="ml-1.5 h-3 w-3 text-primary" />}
            {sorted === 'desc' ? (
              <ArrowDown className="ml-1.5 h-4 w-4" />
            ) : sorted === 'asc' ? (
              <ArrowUp className="ml-1.5 h-4 w-4" />
            ) : (
              <ArrowUpDown className="ml-1.5 h-4 w-4 opacity-50" />
            )}
            {/* Multi-sort index indicator */}
            {sortIndex > 0 && (
              <span className="ml-1 text-xs text-muted-foreground">
                {sortIndex + 1}
              </span>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="bg-card border-border/50 min-w-[180px]">
          {/* Filter section */}
          {canFilter && (
            <>
              <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
                Filter
              </DropdownMenuLabel>
              <div className="px-2 pb-2">
                {filterType === 'text' ? (
                  <div className="relative">
                    <Input
                      placeholder={filterPlaceholder || `Filter ${title.toLowerCase()}...`}
                      value={filterValue ?? ''}
                      onChange={(e) => column.setFilterValue(e.target.value || undefined)}
                      className="h-8 text-sm"
                    />
                    {isFiltered && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0 h-8 w-8 p-0 hover:bg-transparent"
                        onClick={() => column.setFilterValue(undefined)}
                      >
                        <X className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    )}
                  </div>
                ) : (
                  <Select
                    value={filterValue ?? '__all__'}
                    onValueChange={(value) => column.setFilterValue(value === '__all__' ? undefined : value)}
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue placeholder={filterPlaceholder || 'Select...'} />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border/50">
                      <SelectItem value="__all__">All</SelectItem>
                      {selectOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              {(column.getCanSort() || column.getCanHide()) && (
                <DropdownMenuSeparator className="bg-border/50" />
              )}
            </>
          )}

          {/* Sort section */}
          {column.getCanSort() && (
            <>
              <DropdownMenuItem
                onClick={() => column.toggleSorting(false)}
                className={cn(
                  'cursor-pointer',
                  sorted === 'asc' && 'bg-primary/10 text-primary'
                )}
              >
                <ArrowUp className="mr-2 h-3.5 w-3.5" />
                Asc
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => column.toggleSorting(true)}
                className={cn(
                  'cursor-pointer',
                  sorted === 'desc' && 'bg-primary/10 text-primary'
                )}
              >
                <ArrowDown className="mr-2 h-3.5 w-3.5" />
                Desc
              </DropdownMenuItem>
              {sorted && (
                <DropdownMenuItem
                  onClick={() => column.clearSorting()}
                  className="cursor-pointer"
                >
                  <ArrowUpDown className="mr-2 h-3.5 w-3.5 opacity-50" />
                  Clear
                </DropdownMenuItem>
              )}
            </>
          )}
          {column.getCanSort() && column.getCanHide() && (
            <DropdownMenuSeparator className="bg-border/50" />
          )}

          {/* Hide section */}
          {column.getCanHide() && (
            <DropdownMenuItem
              onClick={() => column.toggleVisibility(false)}
              className="cursor-pointer"
            >
              <EyeOff className="mr-2 h-3.5 w-3.5" />
              Hide
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
