import { ColumnDef } from '@tanstack/react-table'
import { CheckCircle2, HelpCircle, AlertCircle, RefreshCw } from 'lucide-react'
import { Badge } from '@/shared/ui/badge'
import type { PasslinePreviewEvent, EventbritePreviewEvent, BATourismPreviewEvent, MeetupPreviewEvent } from '@/features/import'

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
export type EventbriteEventWithId = EventbritePreviewEvent & { id: string }
export type BaTourismEventWithId = BATourismPreviewEvent & { id: string }
export type MeetupEventWithId = MeetupPreviewEvent & { id: string }

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

function EventbriteVenueMatchIndicator({ event }: { event: EventbritePreviewEvent }) {
  const { matchType, confidence, venue } = event.venueMatch
  const originalName = event.eventbrite.location?.name || 'Unknown Venue'

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
      <span className="text-sm text-muted-foreground">{originalName}</span>
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

// Eventbrite events columns
export function getEventbriteColumns(): ColumnDef<EventbriteEventWithId>[] {
  return [
    {
      id: 'name',
      accessorFn: (row) => row.eventbrite.name,
      size: 280,
      minSize: 180,
      enableSorting: true,
      header: 'Event',
      cell: ({ row }) => {
        const event = row.original
        return (
          <div className="flex flex-col gap-1">
            <span className="font-medium line-clamp-1">
              {event.eventbrite.name}
            </span>
            {event.eventbrite.description && (
              <span className="text-xs text-muted-foreground line-clamp-1">
                {event.eventbrite.description}
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
      accessorFn: (row) => row.venueMatch.venue?.name || row.eventbrite.location?.name || '',
      size: 200,
      minSize: 150,
      enableSorting: true,
      header: 'Venue',
      cell: ({ row }) => <EventbriteVenueMatchIndicator event={row.original} />,
    },
    {
      id: 'source',
      accessorFn: () => 'Eventbrite',
      size: 100,
      minSize: 80,
      enableSorting: false,
      header: 'Source',
      cell: () => (
        <Badge variant="outline" className="text-xs border-orange-500/30 text-orange-500">
          Eventbrite
        </Badge>
      ),
    },
    {
      id: 'hasDescription',
      accessorFn: (row) => row.eventbrite.description ? 'Yes' : 'No',
      size: 100,
      minSize: 80,
      enableSorting: false,
      header: 'Description',
      cell: ({ row }) => (
        row.original.eventbrite.description ? (
          <CheckCircle2 className="h-4 w-4 text-green-500" />
        ) : (
          <span className="text-muted-foreground text-sm">-</span>
        )
      ),
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

function BaTourismVenueMatchIndicator({ event }: { event: BATourismPreviewEvent }) {
  const { matchType, confidence, venue } = event.venueMatch
  const originalName = event.baTourism.venueName

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
      <span className="text-sm text-muted-foreground">{originalName}</span>
    </div>
  )
}

// BA Tourism events columns
export function getBaTourismColumns(): ColumnDef<BaTourismEventWithId>[] {
  return [
    {
      id: 'name',
      accessorFn: (row) => row.baTourism.name,
      size: 280,
      minSize: 180,
      enableSorting: true,
      header: 'Event',
      cell: ({ row }) => {
        const event = row.original
        return (
          <div className="flex flex-col gap-1">
            <span className="font-medium line-clamp-1">
              {event.baTourism.name}
            </span>
            {event.baTourism.description && (
              <span className="text-xs text-muted-foreground line-clamp-1">
                {event.baTourism.description}
              </span>
            )}
          </div>
        )
      },
    },
    {
      id: 'category',
      accessorFn: (row) => row.baTourism.category,
      size: 120,
      minSize: 80,
      enableSorting: true,
      header: 'Category',
      cell: ({ row }) => (
        <Badge variant="secondary" className="text-xs">
          {row.original.baTourism.category}
        </Badge>
      ),
    },
    {
      id: 'when',
      accessorFn: (row) => row.baTourism.whenText,
      size: 200,
      minSize: 150,
      enableSorting: false,
      header: 'When',
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground line-clamp-2">
          {row.original.baTourism.whenText}
        </span>
      ),
    },
    {
      id: 'dateCount',
      accessorFn: (row) => row.dateCount,
      size: 80,
      minSize: 60,
      enableSorting: true,
      header: 'Dates',
      cell: ({ row }) => (
        <Badge variant="outline" className="text-xs">
          {row.original.dateCount}
        </Badge>
      ),
    },
    {
      id: 'venue',
      accessorFn: (row) => row.venueMatch.venue?.name || row.baTourism.venueName,
      size: 200,
      minSize: 150,
      enableSorting: true,
      header: 'Venue',
      cell: ({ row }) => <BaTourismVenueMatchIndicator event={row.original} />,
    },
    {
      id: 'neighborhood',
      accessorFn: (row) => row.baTourism.neighborhood,
      size: 120,
      minSize: 80,
      enableSorting: true,
      header: 'Barrio',
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.baTourism.neighborhood}
        </span>
      ),
    },
    {
      id: 'price',
      accessorFn: (row) => row.baTourism.isFree ? 0 : 1,
      size: 80,
      minSize: 60,
      enableSorting: true,
      header: 'Price',
      cell: ({ row }) => (
        row.original.baTourism.isFree ? (
          <Badge variant="outline" className="text-green-500 border-green-500/30">
            Free
          </Badge>
        ) : (
          <span className="text-muted-foreground text-sm">Paid</span>
        )
      ),
    },
  ]
}

function MeetupVenueMatchIndicator({ event }: { event: MeetupPreviewEvent }) {
  const { matchType, confidence, venue } = event.venueMatch
  const originalName = event.meetup.venue?.name || 'No venue'

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
      <span className="text-sm text-muted-foreground">{originalName}</span>
    </div>
  )
}

// Meetup events columns
export function getMeetupColumns(): ColumnDef<MeetupEventWithId>[] {
  return [
    {
      id: 'name',
      accessorFn: (row) => row.meetup.name,
      size: 280,
      minSize: 180,
      enableSorting: true,
      header: 'Event',
      cell: ({ row }) => {
        const event = row.original
        return (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="font-medium line-clamp-1">
                {event.meetup.name}
              </span>
              {event.alreadyImported && (
                <Badge variant="outline" className="text-xs shrink-0 border-blue-500/30 text-blue-500">
                  <RefreshCw className="h-3 w-3 mr-1" />
                  Update
                </Badge>
              )}
            </div>
            <span className="text-xs text-muted-foreground line-clamp-1">
              by {event.meetup.group.name}
            </span>
          </div>
        )
      },
    },
    {
      id: 'date',
      accessorFn: (row) => row.meetup.dateTime,
      size: 160,
      minSize: 130,
      enableSorting: true,
      header: 'Date',
      cell: ({ row }) => (
        <span className="text-sm">
          {formatDate(row.original.meetup.dateTime)}
        </span>
      ),
    },
    {
      id: 'venue',
      accessorFn: (row) => row.venueMatch.venue?.name || row.meetup.venue?.name || '',
      size: 200,
      minSize: 150,
      enableSorting: true,
      header: 'Venue',
      cell: ({ row }) => <MeetupVenueMatchIndicator event={row.original} />,
    },
    {
      id: 'attendees',
      accessorFn: (row) => row.meetup.attendeeCount,
      size: 100,
      minSize: 80,
      enableSorting: true,
      header: 'Attendees',
      cell: ({ row }) => (
        <Badge variant="outline" className="text-xs">
          {row.original.meetup.attendeeCount}
        </Badge>
      ),
    },
    {
      id: 'dateCount',
      accessorFn: (row) => row.dateCount,
      size: 80,
      minSize: 60,
      enableSorting: true,
      header: 'Dates',
      cell: ({ row }) => (
        <Badge variant="outline" className="text-xs">
          {row.original.dateCount}
        </Badge>
      ),
    },
    {
      id: 'recurring',
      accessorFn: (row) => row.meetup.isRecurring ? 'Yes' : 'No',
      size: 100,
      minSize: 80,
      enableSorting: true,
      header: 'Recurring',
      cell: ({ row }) => (
        row.original.meetup.isRecurring ? (
          <Badge variant="secondary" className="text-xs">
            {row.original.meetup.recurrencePattern || 'Yes'}
          </Badge>
        ) : (
          <span className="text-muted-foreground text-sm">-</span>
        )
      ),
    },
  ]
}
