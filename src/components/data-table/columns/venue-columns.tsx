import { ColumnDef } from '@tanstack/react-table'
import { Link } from '@tanstack/react-router'
import { Pencil, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DataTableColumnHeader } from '../DataTableColumnHeader'
import type { Venue } from '@/lib/types'

const venueTypeLabels: Record<string, string> = {
  club: 'Club',
  bar: 'Bar',
  theater: 'Theater',
  gallery: 'Gallery',
  cultural_center: 'Cultural Center',
  outdoor: 'Outdoor',
  restaurant: 'Restaurant',
  other: 'Other',
}

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
      id: 'type',
      accessorKey: 'type',
      size: 140,
      minSize: 100,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Type" />
      ),
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {venueTypeLabels[row.original.type] || row.original.type}
        </span>
      ),
    },
    {
      id: 'capacity',
      accessorKey: 'capacity',
      size: 100,
      minSize: 80,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Capacity" />
      ),
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {row.original.capacity || '—'}
        </span>
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
