import { Link } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { DataTableColumnHeader } from '@/shared/ui/data-table/DataTableColumnHeader'
import type { ImportBlocklistEntry, BlocklistTargetField, BlocklistSource } from '@/shared/lib/types'

const TARGET_FIELD_LABELS: Record<BlocklistTargetField, string> = {
  event_name: 'Event Name',
  venue_name: 'Venue Name',
}

const SOURCE_LABELS: Record<BlocklistSource, string> = {
  passline: 'Passline',
  eventbrite: 'Eventbrite',
  ba_tourism: 'BA Tourism',
  meetup: 'Meetup',
  luma: 'Luma',
  all: 'All Sources',
}

interface BlocklistColumnsOptions {
  onDelete?: (entry: ImportBlocklistEntry) => void
}

export function getBlocklistColumns(
  options?: BlocklistColumnsOptions
): ColumnDef<ImportBlocklistEntry>[] {
  const { onDelete } = options || {}

  return [
    {
      id: 'pattern',
      accessorKey: 'pattern',
      size: 200,
      minSize: 100,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Pattern" />,
      cell: ({ row }) => (
        <span className="font-mono text-sm">{row.original.pattern}</span>
      ),
    },
    {
      id: 'target_field',
      accessorKey: 'target_field',
      size: 120,
      minSize: 100,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Match Against" />,
      cell: ({ row }) => (
        <Badge variant="outline" className="border-primary/30 text-primary">
          {TARGET_FIELD_LABELS[row.original.target_field]}
        </Badge>
      ),
    },
    {
      id: 'source',
      accessorKey: 'source',
      size: 120,
      minSize: 80,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Source" />,
      cell: ({ row }) => (
        <Badge
          variant="secondary"
          className={
            row.original.source === 'all'
              ? 'bg-amber-500/20 text-amber-400'
              : 'bg-muted text-muted-foreground'
          }
        >
          {SOURCE_LABELS[row.original.source]}
        </Badge>
      ),
    },
    {
      id: 'reason',
      accessorKey: 'reason',
      size: 250,
      minSize: 100,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Reason" />,
      cell: ({ row }) => (
        <span className="text-muted-foreground text-sm truncate block max-w-[250px]">
          {row.original.reason || '—'}
        </span>
      ),
    },
    {
      id: 'actions',
      size: 100,
      enableResizing: false,
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
          >
            <Link to="/admin/blocklist/$id" params={{ id: row.original.id }}>
              <Pencil className="h-4 w-4" />
            </Link>
          </Button>
          {onDelete && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              onClick={() => onDelete(row.original)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      ),
    },
  ]
}
