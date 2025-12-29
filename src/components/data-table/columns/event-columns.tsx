import { ColumnDef } from '@tanstack/react-table'
import { Link } from '@tanstack/react-router'
import { Pencil, Trash2, MapPin, CheckCircle2, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DataTableColumnHeader } from '../DataTableColumnHeader'
import type { EventWithVenue } from '@/lib/types'

function formatDate(dateString: string) {
  const date = new Date(dateString)
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function getStatusBadge(status: string) {
  const variants: Record<string, { className: string; label: string }> = {
    scheduled: {
      className: 'bg-green-500/10 text-green-400 border-green-500/30',
      label: 'Scheduled',
    },
    pending_review: {
      className: 'bg-orange-500/10 text-orange-400 border-orange-500/30',
      label: 'Pending',
    },
    cancelled: {
      className: 'bg-destructive/10 text-destructive border-destructive/30',
      label: 'Cancelled',
    },
    postponed: {
      className: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
      label: 'Postponed',
    },
    past: {
      className: 'bg-muted/50 text-muted-foreground border-border/50',
      label: 'Past',
    },
  }
  const variant = variants[status] || variants.scheduled
  return (
    <Badge variant="outline" className={variant.className}>
      {variant.label}
    </Badge>
  )
}

interface EventColumnsOptions {
  onDelete?: (event: EventWithVenue) => void
  onApprove?: (id: string) => void
  onReject?: (id: string) => void
  isApproving?: string | null
  isRejecting?: string | null
  showNeedsAttention?: boolean
}

export function getEventColumns(options?: EventColumnsOptions): ColumnDef<EventWithVenue>[] {
  const {
    onDelete,
    onApprove,
    onReject,
    isApproving,
    isRejecting,
    showNeedsAttention,
  } = options || {}

  return [
    {
      id: 'name',
      accessorKey: 'name',
      size: 280,
      minSize: 180,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Event" />
      ),
      cell: ({ row }) => {
        const event = row.original
        const needsDescription = !event.description && event.link

        return (
          <div className="min-w-0">
            <p className="font-medium text-foreground truncate">{event.name}</p>
            <div className="flex flex-wrap gap-1 mt-1">
              {showNeedsAttention && needsDescription && (
                <Badge
                  variant="outline"
                  className="text-xs bg-orange-500/10 text-orange-400 border-orange-500/30"
                >
                  No Description
                </Badge>
              )}
              {event.categories.slice(0, 2).map((cat) => (
                <Badge
                  key={cat}
                  variant="outline"
                  className="text-xs border-border/50 text-muted-foreground"
                >
                  {cat}
                </Badge>
              ))}
              {event.categories.length > 2 && (
                <span className="text-xs text-muted-foreground">
                  +{event.categories.length - 2}
                </span>
              )}
            </div>
          </div>
        )
      },
    },
    {
      id: 'venue',
      accessorKey: 'venue_name',
      size: 180,
      minSize: 120,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Venue" />
      ),
      cell: ({ row }) => {
        const venueName = row.original.venue_name
        return venueName ? (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{venueName}</span>
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        )
      },
    },
    {
      id: 'date',
      accessorKey: 'starts_at',
      size: 160,
      minSize: 130,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Date" />
      ),
      cell: ({ row }) => (
        <span className="text-muted-foreground text-sm">
          {formatDate(row.original.starts_at)}
        </span>
      ),
    },
    {
      id: 'status',
      accessorKey: 'status',
      size: 110,
      minSize: 90,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Status" />
      ),
      cell: ({ row }) => getStatusBadge(row.original.status),
    },
    {
      id: 'actions',
      size: 140,
      minSize: 140,
      maxSize: 140,
      enableResizing: false,
      enableSorting: false,
      enableHiding: false,
      header: () => <span className="text-right w-full block">Actions</span>,
      cell: ({ row }) => {
        const event = row.original

        return (
          <div className="flex items-center justify-end gap-1">
            {event.status === 'pending_review' && onApprove && onReject && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-green-500 hover:text-green-400 hover:bg-green-500/10"
                  onClick={() => onApprove(event.id)}
                  disabled={isApproving === event.id}
                  title="Approve"
                >
                  <CheckCircle2 className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => onReject(event.id)}
                  disabled={isRejecting === event.id}
                  title="Reject"
                >
                  <XCircle className="h-4 w-4" />
                </Button>
              </>
            )}
            <Button
              asChild
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
            >
              <Link to="/admin/events/$id" params={{ id: event.id }}>
                <Pencil className="h-4 w-4" />
              </Link>
            </Button>
            {onDelete && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                onClick={() => onDelete(event)}
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
