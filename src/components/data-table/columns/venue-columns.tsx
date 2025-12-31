import { ColumnDef } from '@tanstack/react-table'
import { Link } from '@tanstack/react-router'
import { Pencil, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DataTableColumnHeader } from '../DataTableColumnHeader'
import type { Venue } from '@/lib/types'

interface VenueColumnsOptions {
  onDelete?: (venue: Venue) => void
}

export function getVenueColumns(options?: VenueColumnsOptions): ColumnDef<Venue>[] {
  const { onDelete } = options || {}

  return [
    {
      id: 'name',
      accessorKey: 'name',
      size: 250,
      minSize: 150,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Name" />
      ),
      cell: ({ row }) => (
        <span className="font-medium text-foreground">{row.original.name}</span>
      ),
    },
    {
      id: 'neighborhood',
      accessorKey: 'neighborhood',
      size: 180,
      minSize: 120,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Neighborhood" />
      ),
      cell: ({ row }) => (
        <Badge variant="outline" className="border-primary/30 text-primary">
          {row.original.neighborhood}
        </Badge>
      ),
    },
    {
      id: 'actions',
      size: 100,
      minSize: 100,
      maxSize: 100,
      enableResizing: false,
      enableSorting: false,
      enableHiding: false,
      header: () => <span className="text-right w-full block">Actions</span>,
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-2">
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
          >
            <Link to="/admin/venues/$id" params={{ id: row.original.id }}>
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
