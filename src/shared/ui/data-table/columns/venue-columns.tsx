import { useState } from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { Link } from '@tanstack/react-router'
import { Pencil, Trash2, ExternalLink, Loader2, Calendar } from 'lucide-react'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover'
import { DataTableColumnHeader } from '../DataTableColumnHeader'
import type { Venue } from '@/shared/lib/types'
import type { VenueEventItem } from '@/features/venues/api/crud'
import { listVenueEventsAction } from '@/features/venues/api/crud'
import * as m from '@/paraglide/messages'

interface VenueColumnsOptions {
  onEdit?: (venue: Venue) => void
  onDelete?: (venue: Venue) => void
  venuesMap?: Map<string, Venue>
  eventCounts?: Record<string, number>
}

// Format date for display
function formatEventDate(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
  })
}

// Component to display venue events in a popover
function VenueEventsPopover({
  venueId,
  eventCount,
}: {
  venueId: string
  eventCount: number
}) {
  const [open, setOpen] = useState(false)
  const [events, setEvents] = useState<VenueEventItem[] | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const handleOpenChange = async (isOpen: boolean) => {
    setOpen(isOpen)
    if (isOpen && events === null && eventCount > 0) {
      setIsLoading(true)
      try {
        const result = await listVenueEventsAction({ data: venueId })
        setEvents(result)
      } catch (error) {
        console.error('Failed to load venue events:', error)
        setEvents([])
      } finally {
        setIsLoading(false)
      }
    }
  }

  if (eventCount === 0) {
    return (
      <span className="text-xs text-muted-foreground">{m.admin_no_events()}</span>
    )
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs font-normal hover:bg-primary/10"
        >
          <Calendar className="h-3 w-3 mr-1" />
          {eventCount} {eventCount === 1 ? m.admin_event_singular() : m.admin_events_plural()}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <div className="p-3 border-b border-border">
          <h4 className="font-medium text-sm">
            {m.admin_venue_events({ count: eventCount })}
          </h4>
        </div>
        <div className="max-h-64 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : events && events.length > 0 ? (
            <div className="divide-y divide-border">
              {events.map((event) => (
                <div
                  key={event.id}
                  className="p-3 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" title={event.name}>
                        {event.name}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-muted-foreground">
                          {formatEventDate(event.starts_at)}
                        </span>
                        <Badge
                          variant="outline"
                          className="text-[10px] px-1.5 py-0 h-4"
                        >
                          {event.source}
                        </Badge>
                        {event.status === 'past' && (
                          <Badge
                            variant="secondary"
                            className="text-[10px] px-1.5 py-0 h-4 bg-muted"
                          >
                            past
                          </Badge>
                        )}
                      </div>
                    </div>
                    {event.link && (
                      <a
                        href={event.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 p-1 text-muted-foreground hover:text-primary transition-colors"
                        title={m.admin_view_external()}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-6 text-center text-sm text-muted-foreground">
              {m.admin_no_events()}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function getVenueColumns(options?: VenueColumnsOptions): ColumnDef<Venue>[] {
  const { onEdit, onDelete, venuesMap, eventCounts } = options || {}

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
      id: 'events',
      size: 110,
      minSize: 90,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={m.admin_events_column()} />
      ),
      cell: ({ row }) => {
        const venue = row.original
        const count = eventCounts?.[venue.id] ?? 0
        return <VenueEventsPopover venueId={venue.id} eventCount={count} />
      },
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
