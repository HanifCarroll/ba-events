import { Column } from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ArrowUpDown, EyeOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface DataTableColumnHeaderProps<TData, TValue> {
  column: Column<TData, TValue>
  title: string
  className?: string
}

export function DataTableColumnHeader<TData, TValue>({
  column,
  title,
  className,
}: DataTableColumnHeaderProps<TData, TValue>) {
  if (!column.getCanSort() && !column.getCanHide()) {
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
            className="h-7 px-2 data-[state=open]:bg-accent hover:bg-muted/50"
          >
            <span>{title}</span>
            {sorted === 'desc' ? (
              <ArrowDown className="ml-2 h-4 w-4" />
            ) : sorted === 'asc' ? (
              <ArrowUp className="ml-2 h-4 w-4" />
            ) : (
              <ArrowUpDown className="ml-2 h-4 w-4 opacity-50" />
            )}
            {/* Multi-sort index indicator */}
            {sortIndex > 0 && (
              <span className="ml-1 text-xs text-muted-foreground">
                {sortIndex + 1}
              </span>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="bg-card border-border/50">
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
