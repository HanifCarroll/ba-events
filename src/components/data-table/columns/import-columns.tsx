import { ColumnDef } from '@tanstack/react-table'
import { CheckCircle2, HelpCircle, AlertCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { PasslinePreviewEvent } from '@/lib/admin'

interface ParsedCSVRow {
  rowNumber: number
  data: {
    name?: string
    starts_at?: string
    venue_name?: string
    categories?: string
  }
  errors: string[]
}

// Extended types with id for DataTable compatibility
export type PasslineEventWithId = PasslinePreviewEvent & { id: string }

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('es-AR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function VenueMatchIndicator({ event }: { event: PasslinePreviewEvent }) {
  const { matchType, confidence, venue } = event.venueMatch

  if (matchType === 'exact') {
    return (
      <div className="flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 text-green-500" />
        <span className="text-sm">{venue?.name}</span>
      </div>
    )
  }

  if (matchType === 'fuzzy') {
    return (
      <div className="flex items-center gap-2">
        <HelpCircle className="h-4 w-4 text-yellow-500" />
        <span className="text-sm">
          {venue?.name}
          <span className="text-muted-foreground ml-1">
            ({Math.round(confidence * 100)}%)
          </span>
        </span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <AlertCircle className="h-4 w-4 text-red-500" />
      <span className="text-sm text-muted-foreground">{event.passline.lugar}</span>
    </div>
  )
}

// Passline events columns
export function getPasslineColumns(): ColumnDef<PasslineEventWithId>[] {
  return [
    {
      id: 'name',
      accessorFn: (row) => row.passline.nombre,
      size: 280,
      minSize: 180,
      enableSorting: true,
      header: 'Event',
      cell: ({ row }) => {
        const event = row.original
        return (
          <div className="flex flex-col gap-1">
            <span className="font-medium line-clamp-1">
              {event.passline.nombre}
            </span>
            {event.passline.artistas && (
              <span className="text-xs text-muted-foreground line-clamp-1">
                {event.passline.artistas}
              </span>
            )}
          </div>
        )
      },
    },
    {
      id: 'date',
      accessorFn: (row) => row.transformed.starts_at,
      size: 160,
      minSize: 130,
      enableSorting: true,
      header: 'Date',
      cell: ({ row }) => (
        <span className="text-sm">
          {formatDate(row.original.transformed.starts_at)}
        </span>
      ),
    },
    {
      id: 'venue',
      accessorFn: (row) => row.venueMatch.venue?.name || row.passline.lugar,
      size: 200,
      minSize: 150,
      enableSorting: true,
      header: 'Venue',
      cell: ({ row }) => <VenueMatchIndicator event={row.original} />,
    },
    {
      id: 'categories',
      accessorFn: (row) => row.transformed.categories?.join(', ') || '',
      size: 150,
      minSize: 100,
      enableSorting: false,
      header: 'Category',
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-1">
          {(row.original.transformed.categories || []).map((cat) => (
            <Badge key={cat} variant="secondary" className="text-xs">
              {cat}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      id: 'price',
      accessorFn: (row) => row.transformed.price ?? -1,
      size: 100,
      minSize: 80,
      enableSorting: true,
      header: () => <span className="text-right w-full block">Price</span>,
      cell: ({ row }) => {
        const event = row.original
        return (
          <div className="text-right">
            {event.transformed.is_free ? (
              <Badge variant="outline" className="text-green-500 border-green-500/30">
                Free
              </Badge>
            ) : event.transformed.price ? (
              <span className="text-sm">
                ${event.transformed.price.toLocaleString('es-AR')}
              </span>
            ) : (
              <span className="text-muted-foreground text-sm">-</span>
            )}
          </div>
        )
      },
    },
  ]
}

// Extend ParsedCSVRow with id for DataTable compatibility
export type ParsedCSVRowWithId = ParsedCSVRow & { id: string }

// CSV rows columns
export function getCSVColumns(): ColumnDef<ParsedCSVRowWithId>[] {
  return [
    {
      id: 'rowNumber',
      accessorKey: 'rowNumber',
      size: 70,
      minSize: 60,
      enableSorting: true,
      header: 'Row',
      cell: ({ row }) => (
        <span className="text-muted-foreground">{row.original.rowNumber}</span>
      ),
    },
    {
      id: 'status',
      accessorFn: (row) => (row.errors.length > 0 ? 'error' : 'valid'),
      size: 70,
      minSize: 60,
      enableSorting: true,
      header: 'Status',
      cell: ({ row }) => {
        const hasErrors = row.original.errors.length > 0
        return hasErrors ? (
          <AlertCircle className="h-4 w-4 text-destructive" />
        ) : (
          <CheckCircle2 className="h-4 w-4 text-green-400" />
        )
      },
    },
    {
      id: 'name',
      accessorFn: (row) => row.data.name || '',
      size: 200,
      minSize: 150,
      enableSorting: true,
      header: 'Name',
      cell: ({ row }) => (
        <span className="font-medium text-foreground">
          {row.original.data.name || '-'}
        </span>
      ),
    },
    {
      id: 'starts_at',
      accessorFn: (row) => row.data.starts_at || '',
      size: 150,
      minSize: 120,
      enableSorting: true,
      header: 'Start Date',
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {row.original.data.starts_at || '-'}
        </span>
      ),
    },
    {
      id: 'venue',
      accessorFn: (row) => row.data.venue_name || '',
      size: 150,
      minSize: 120,
      enableSorting: true,
      header: 'Venue',
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {row.original.data.venue_name || '-'}
        </span>
      ),
    },
    {
      id: 'errors',
      accessorFn: (row) => row.errors.join(', '),
      size: 200,
      minSize: 150,
      enableSorting: false,
      header: 'Errors',
      cell: ({ row }) => {
        if (row.original.errors.length === 0) return null
        return (
          <div className="flex flex-wrap gap-1">
            {row.original.errors.map((error, i) => (
              <Badge
                key={i}
                variant="outline"
                className="text-xs border-destructive/30 text-destructive"
              >
                {error}
              </Badge>
            ))}
          </div>
        )
      },
    },
  ]
}
