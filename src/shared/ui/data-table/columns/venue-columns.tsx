import { ColumnDef } from '@tanstack/react-table'
import { Link } from '@tanstack/react-router'
import { Pencil, Trash2 } from 'lucide-react'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { DataTableColumnHeader } from '../DataTableColumnHeader'
import type { Venue } from '@/shared/lib/types'
import * as m from '@/paraglide/messages'

interface VenueColumnsOptions {
  onEdit?: (venue: Venue) => void
  onDelete?: (venue: Venue) => void
  venuesMap?: Map<string, Venue>
}

export function getVenueColumns(options?: VenueColumnsOptions): ColumnDef<Venue>[] {
  const { onEdit, onDelete, venuesMap } = options || {}

  return [
    {
      id: 'name',
      accessorKey: 'name',
      size: 250,
      minSize: 150,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Name" />
      ),
      cell: ({ row }) => {
        const parentVenue = row.original.parent_id && venuesMap?.get(row.original.parent_id)
        return (
          <div>
            <span className="font-medium text-foreground">{row.original.name}</span>
            {parentVenue && (
              <span className="block text-xs text-muted-foreground">
                {m.admin_part_of({ name: parentVenue.name })}
              </span>
            )}
          </div>
        )
      },
    },
    {
      id: 'neighborhood',
      accessorKey: 'neighborhood',
      size: 180,
      minSize: 120,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Neighborhood" />
      ),
      cell: ({ row }) =>
        row.original.neighborhood ? (
          <Badge variant="outline" className="border-primary/30 text-primary">
            {row.original.neighborhood}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
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
      cell: ({ row }) => {
        const venue = row.original

        return (
          <div className="flex items-center justify-end gap-2">
            {onEdit ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={() => onEdit(venue)}
              >
                <Pencil className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                asChild
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
              >
                <Link to="/admin/venues/$id" params={{ id: venue.id }}>
                  <Pencil className="h-4 w-4" />
                </Link>
              </Button>
            )}
            {onDelete && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                onClick={() => onDelete(venue)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        )
      },
    },
  ]
}
