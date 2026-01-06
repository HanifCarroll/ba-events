import { ColumnDef } from '@tanstack/react-table'
import { CheckCircle2, HelpCircle, AlertCircle, Eye, ExternalLink } from 'lucide-react'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import type { PasslinePreviewEvent, EventbritePreviewEvent, BATourismPreviewEvent, MeetupPreviewEvent, LumaPreviewEvent, DuplicateInfo } from '@/features/import'

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
export type LumaEventWithId = LumaPreviewEvent & { id: string }

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

// Table meta type for passing handlers
export interface ImportTableMeta {
  onViewDiff?: (duplicateInfo: DuplicateInfo) => void
}

// Status badge component for import preview tables
function ImportStatusBadge({
  alreadyImported,
  duplicateInfo,
  onViewDiff,
}: {
  alreadyImported: boolean
  duplicateInfo?: DuplicateInfo
  onViewDiff?: (duplicateInfo: DuplicateInfo) => void
}) {
  if (!alreadyImported) {
    return (
      <Badge variant="outline" className="text-xs border-green-500/30 text-green-500">
        New
      </Badge>
    )
  }

  if (duplicateInfo?.hasChanges) {
    return (
      <div className="flex items-center gap-1">
        <Badge variant="outline" className="text-xs border-amber-500/30 text-amber-500">
          Changed
        </Badge>
        {onViewDiff && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-xs text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation()
              onViewDiff(duplicateInfo)
            }}
          >
            <Eye className="h-3 w-3 mr-1" />
            Diff
          </Button>
        )}
      </div>
    )
  }

  return (
    <Badge variant="outline" className="text-xs border-blue-500/30 text-blue-500">
      Exists
    </Badge>
  )
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
      id: 'status',
      accessorFn: (row) => row.alreadyImported ? (row.duplicateInfo?.hasChanges ? 'changed' : 'exists') : 'new',
      size: 100,
      minSize: 80,
      enableSorting: true,
      header: 'Status',
      cell: ({ row, table }) => {
        const event = row.original
        const meta = table.options.meta as ImportTableMeta | undefined
        return (
          <ImportStatusBadge
            alreadyImported={event.alreadyImported}
            duplicateInfo={event.duplicateInfo}
            onViewDiff={meta?.onViewDiff}
          />
        )
      },
    },
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
    {
      id: 'link',
      accessorFn: (row) => row.transformed.link,
      size: 60,
      minSize: 50,
      enableSorting: false,
      header: 'Link',
      cell: ({ row }) => {
        const link = row.original.transformed.link
        if (!link) return null
        return (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={(e) => {
              e.stopPropagation()
              window.open(link, '_blank', 'noopener,noreferrer')
            }}
          >
            <ExternalLink className="h-4 w-4" />
          </Button>
        )
      },
    },
    // Hidden column for filtering by duplicate status
    {
      id: 'alreadyImported',
      accessorFn: (row) => row.alreadyImported ? 'yes' : 'no',
      enableColumnFilter: true,
      enableHiding: true,
      size: 0,
      header: () => null,
      cell: () => null,
    },
  ]
}

// Eventbrite events columns
export function getEventbriteColumns(): ColumnDef<EventbriteEventWithId>[] {
  return [
    {
      id: 'status',
      accessorFn: (row) => row.alreadyImported ? (row.duplicateInfo?.hasChanges ? 'changed' : 'exists') : 'new',
      size: 100,
      minSize: 80,
      enableSorting: true,
      header: 'Status',
      cell: ({ row, table }) => {
        const event = row.original
        const meta = table.options.meta as ImportTableMeta | undefined
        return (
          <ImportStatusBadge
            alreadyImported={event.alreadyImported}
            duplicateInfo={event.duplicateInfo}
            onViewDiff={meta?.onViewDiff}
          />
        )
      },
    },
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
    {
      id: 'link',
      accessorFn: (row) => row.eventbrite.url,
      size: 60,
      minSize: 50,
      enableSorting: false,
      header: 'Link',
      cell: ({ row }) => {
        const link = row.original.eventbrite.url
        if (!link) return null
        return (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={(e) => {
              e.stopPropagation()
              window.open(link, '_blank', 'noopener,noreferrer')
            }}
          >
            <ExternalLink className="h-4 w-4" />
          </Button>
        )
      },
    },
    // Hidden column for filtering by duplicate status
    {
      id: 'alreadyImported',
      accessorFn: (row) => row.alreadyImported ? 'yes' : 'no',
      enableColumnFilter: true,
      enableHiding: true,
      size: 0,
      header: () => null,
      cell: () => null,
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
      id: 'status',
      accessorFn: (row) => row.alreadyImported ? (row.duplicateInfo?.hasChanges ? 'changed' : 'exists') : 'new',
      size: 100,
      minSize: 80,
      enableSorting: true,
      header: 'Status',
      cell: ({ row, table }) => {
        const event = row.original
        const meta = table.options.meta as ImportTableMeta | undefined
        return (
          <ImportStatusBadge
            alreadyImported={event.alreadyImported}
            duplicateInfo={event.duplicateInfo}
            onViewDiff={meta?.onViewDiff}
          />
        )
      },
    },
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
    {
      id: 'link',
      accessorFn: (row) => row.baTourism.moreInfoUrl,
      size: 60,
      minSize: 50,
      enableSorting: false,
      header: 'Link',
      cell: ({ row }) => {
        const link = row.original.baTourism.moreInfoUrl
        if (!link) return null
        return (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={(e) => {
              e.stopPropagation()
              window.open(link, '_blank', 'noopener,noreferrer')
            }}
          >
            <ExternalLink className="h-4 w-4" />
          </Button>
        )
      },
    },
    // Hidden column for filtering by duplicate status
    {
      id: 'alreadyImported',
      accessorFn: (row) => row.alreadyImported ? 'yes' : 'no',
      enableColumnFilter: true,
      enableHiding: true,
      size: 0,
      header: () => null,
      cell: () => null,
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
      id: 'status',
      accessorFn: (row) => row.alreadyImported ? (row.duplicateInfo?.hasChanges ? 'changed' : 'exists') : 'new',
      size: 100,
      minSize: 80,
      enableSorting: true,
      header: 'Status',
      cell: ({ row, table }) => {
        const event = row.original
        const meta = table.options.meta as ImportTableMeta | undefined
        return (
          <ImportStatusBadge
            alreadyImported={event.alreadyImported}
            duplicateInfo={event.duplicateInfo}
            onViewDiff={meta?.onViewDiff}
          />
        )
      },
    },
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
            <span className="font-medium line-clamp-1">
              {event.meetup.name}
            </span>
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
    {
      id: 'link',
      accessorFn: (row) => row.meetup.eventUrl,
      size: 60,
      minSize: 50,
      enableSorting: false,
      header: 'Link',
      cell: ({ row }) => {
        const link = row.original.meetup.eventUrl
        if (!link) return null
        return (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={(e) => {
              e.stopPropagation()
              window.open(link, '_blank', 'noopener,noreferrer')
            }}
          >
            <ExternalLink className="h-4 w-4" />
          </Button>
        )
      },
    },
    // Hidden column for filtering by duplicate status
    {
      id: 'alreadyImported',
      accessorFn: (row) => row.alreadyImported ? 'yes' : 'no',
      enableColumnFilter: true,
      enableHiding: true,
      size: 0,
      header: () => null,
      cell: () => null,
    },
  ]
}

function LumaVenueMatchIndicator({ event }: { event: LumaPreviewEvent }) {
  const { matchType, confidence, venue } = event.venueMatch
  const originalName = event.luma.venue?.name || 'No venue'

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

// Luma events columns
export function getLumaColumns(): ColumnDef<LumaEventWithId>[] {
  return [
    {
      id: 'status',
      accessorFn: (row) => row.alreadyImported ? (row.duplicateInfo?.hasChanges ? 'changed' : 'exists') : 'new',
      size: 100,
      minSize: 80,
      enableSorting: true,
      header: 'Status',
      cell: ({ row, table }) => {
        const event = row.original
        const meta = table.options.meta as ImportTableMeta | undefined
        return (
          <ImportStatusBadge
            alreadyImported={event.alreadyImported}
            duplicateInfo={event.duplicateInfo}
            onViewDiff={meta?.onViewDiff}
          />
        )
      },
    },
    {
      id: 'name',
      accessorFn: (row) => row.luma.name,
      size: 280,
      minSize: 180,
      enableSorting: true,
      header: 'Event',
      cell: ({ row }) => {
        const event = row.original
        return (
          <div className="flex flex-col gap-1">
            <span className="font-medium line-clamp-1">
              {event.luma.name}
            </span>
            {event.luma.description && (
              <span className="text-xs text-muted-foreground line-clamp-1">
                {event.luma.description}
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
      accessorFn: (row) => row.venueMatch.venue?.name || row.luma.venue?.name || '',
      size: 200,
      minSize: 150,
      enableSorting: true,
      header: 'Venue',
      cell: ({ row }) => <LumaVenueMatchIndicator event={row.original} />,
    },
    {
      id: 'guests',
      accessorFn: (row) => row.luma.guest_count,
      size: 100,
      minSize: 80,
      enableSorting: true,
      header: 'Guests',
      cell: ({ row }) => (
        <Badge variant="outline" className="text-xs">
          {row.original.luma.guest_count}
        </Badge>
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
    {
      id: 'link',
      accessorFn: (row) => row.luma.url,
      size: 60,
      minSize: 50,
      enableSorting: false,
      header: 'Link',
      cell: ({ row }) => {
        const link = row.original.luma.url
        if (!link) return null
        return (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={(e) => {
              e.stopPropagation()
              window.open(link, '_blank', 'noopener,noreferrer')
            }}
          >
            <ExternalLink className="h-4 w-4" />
          </Button>
        )
      },
    },
    // Hidden column for filtering by duplicate status
    {
      id: 'alreadyImported',
      accessorFn: (row) => row.alreadyImported ? 'yes' : 'no',
      enableColumnFilter: true,
      enableHiding: true,
      size: 0,
      header: () => null,
      cell: () => null,
    },
  ]
}
