import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  RefreshCw,
  Download,
  Plus,
  Zap,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  fetchPasslinePreviewAction,
  importPasslineEventsAction,
  createVenueAction,
  type PasslinePreviewEvent,
} from '@/lib/admin'
import { NEIGHBORHOODS, VENUE_TYPES } from '@/lib/types'
import type { Neighborhood, VenueType } from '@/lib/types'

interface PasslineScraperProps {
  venues: { id: string; name: string; neighborhood: string }[]
}

export function PasslineScraper({ venues: initialVenues }: PasslineScraperProps) {
  const router = useRouter()

  // Date filter state (default: next 30 days)
  const [startDate, setStartDate] = useState(() => {
    return new Date().toISOString().split('T')[0]
  })
  const [endDate, setEndDate] = useState(() => {
    const date = new Date()
    date.setDate(date.getDate() + 30)
    return date.toISOString().split('T')[0]
  })

  // State
  const [isLoading, setIsLoading] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [events, setEvents] = useState<PasslinePreviewEvent[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [importResult, setImportResult] = useState<{
    inserted: number
    updated: number
  } | null>(null)

  // Quick venue creation dialog
  const [venueDialog, setVenueDialog] = useState<{
    open: boolean
    venueName: string
    eventId: string
  }>({ open: false, venueName: '', eventId: '' })
  const [newVenueName, setNewVenueName] = useState('')
  const [newVenueNeighborhood, setNewVenueNeighborhood] = useState<Neighborhood>('Palermo')
  const [newVenueType, setNewVenueType] = useState<VenueType>('other')
  const [isCreatingVenue, setIsCreatingVenue] = useState(false)

  // Venues state (can be updated when creating new venues)
  const [venues, setVenues] = useState(initialVenues)

  // Fetch events from Passline
  async function handleFetch() {
    setIsLoading(true)
    setError(null)
    setImportResult(null)

    try {
      const data = await fetchPasslinePreviewAction({
        data: { startDate, endDate },
      })
      setEvents(data)
      // Auto-select all events with matched venues
      const autoSelected = new Set(
        data
          .filter((e) => e.venueMatch.matchType !== 'none')
          .map((e) => e.passline.id)
      )
      setSelectedIds(autoSelected)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch events')
    } finally {
      setIsLoading(false)
    }
  }

  // Toggle event selection
  function toggleEvent(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  // Toggle all events
  function toggleAll() {
    if (selectedIds.size === events.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(events.map((e) => e.passline.id)))
    }
  }

  // Open venue creation dialog
  function openVenueDialog(venueName: string, eventId: string) {
    setVenueDialog({ open: true, venueName, eventId })
    setNewVenueName(venueName)
    setNewVenueNeighborhood('Palermo')
    setNewVenueType('other')
  }

  // Create venue and update event
  async function handleCreateVenue() {
    setIsCreatingVenue(true)

    try {
      const venue = await createVenueAction({
        data: {
          name: newVenueName,
          neighborhood: newVenueNeighborhood,
          type: newVenueType,
        },
      })

      // Update venues list
      setVenues((prev) => [
        ...prev,
        { id: venue.id, name: venue.name, neighborhood: venue.neighborhood },
      ])

      // Update the event's venue match
      setEvents((prev) =>
        prev.map((e) => {
          if (e.passline.id === venueDialog.eventId) {
            return {
              ...e,
              transformed: { ...e.transformed, venue_id: venue.id },
              venueMatch: {
                venue: venue,
                matchType: 'exact' as const,
                confidence: 1,
                searchName: e.venueMatch.searchName,
              },
            }
          }
          return e
        })
      )

      // Auto-select this event now that it has a venue
      setSelectedIds((prev) => new Set([...prev, venueDialog.eventId]))

      setVenueDialog({ open: false, venueName: '', eventId: '' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create venue')
    } finally {
      setIsCreatingVenue(false)
    }
  }

  // Import selected events
  async function handleImport() {
    if (selectedIds.size === 0) return

    setIsImporting(true)
    setError(null)
    setImportResult(null)

    try {
      // Build import payload
      const eventsToImport = events
        .filter((e) => selectedIds.has(e.passline.id))
        .map((e) => ({
          passlineId: e.passline.id,
          venueId: e.venueMatch.venue?.id || null,
        }))

      const result = await importPasslineEventsAction({ data: { events: eventsToImport } })
      setImportResult(result)

      // Clear selection and redirect after delay
      setTimeout(() => {
        router.navigate({ to: '/admin/events' })
      }, 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import events')
    } finally {
      setIsImporting(false)
    }
  }

  // Format date for display
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

  // Venue match indicator
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
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={() => openVenueDialog(event.passline.lugar, event.passline.id)}
        >
          <Plus className="h-3 w-3 mr-1" />
          Create
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Date filter */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <Label htmlFor="start-date" className="text-sm text-muted-foreground whitespace-nowrap">
            From
          </Label>
          <Input
            id="start-date"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-40"
          />
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="end-date" className="text-sm text-muted-foreground whitespace-nowrap">
            To
          </Label>
          <Input
            id="end-date"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-40"
          />
        </div>
      </div>

      {/* Actions bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            onClick={handleFetch}
            disabled={isLoading}
            className="bg-primary text-primary-foreground"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Fetching...
              </>
            ) : events.length > 0 ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </>
            ) : (
              <>
                <Download className="h-4 w-4 mr-2" />
                Fetch Events
              </>
            )}
          </Button>

          {events.length > 0 && (
            <span className="text-sm text-muted-foreground">
              {events.length} events found
            </span>
          )}
        </div>

        {events.length > 0 && (
          <Button
            onClick={handleImport}
            disabled={isImporting || selectedIds.size === 0}
            className="bg-green-600 hover:bg-green-700 text-white"
          >
            {isImporting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Importing...
              </>
            ) : (
              <>
                <Download className="h-4 w-4 mr-2" />
                Import {selectedIds.size} Events
              </>
            )}
          </Button>
        )}
      </div>

      {/* Success message */}
      {importResult && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4 flex items-center gap-3">
          <CheckCircle2 className="h-5 w-5 text-green-400" />
          <div>
            <p className="font-medium text-green-400">
              Import complete! {importResult.inserted} new, {importResult.updated} updated
            </p>
            <p className="text-sm text-green-400/80">Redirecting to events list...</p>
          </div>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-4">
          <p className="font-medium text-destructive">{error}</p>
        </div>
      )}

      {/* Events table */}
      {events.length > 0 && (
        <div className="bg-card/50 rounded-xl border border-border/50 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[50px]">
                  <Checkbox
                    checked={selectedIds.size === events.length}
                    onCheckedChange={toggleAll}
                  />
                </TableHead>
                <TableHead>Event</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Venue</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Price</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((event) => (
                <TableRow
                  key={event.passline.id}
                  className={
                    selectedIds.has(event.passline.id)
                      ? 'bg-primary/5'
                      : ''
                  }
                >
                  <TableCell>
                    <Checkbox
                      checked={selectedIds.has(event.passline.id)}
                      onCheckedChange={() => toggleEvent(event.passline.id)}
                    />
                  </TableCell>
                  <TableCell>
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
                  </TableCell>
                  <TableCell className="text-sm">
                    {formatDate(event.transformed.starts_at)}
                  </TableCell>
                  <TableCell>
                    <VenueMatchIndicator event={event} />
                  </TableCell>
                  <TableCell>
                    {event.transformed.categories.map((cat) => (
                      <Badge
                        key={cat}
                        variant="secondary"
                        className="mr-1 text-xs"
                      >
                        {cat}
                      </Badge>
                    ))}
                  </TableCell>
                  <TableCell className="text-right">
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
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && events.length === 0 && (
        <div className="bg-card/50 rounded-xl border border-border/50 p-12 text-center">
          <Zap className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium text-foreground mb-2">
            Ready to fetch events
          </h3>
          <p className="text-muted-foreground max-w-md mx-auto">
            Click "Fetch Events" to load events from Passline. Only events in
            Capital Federal (CABA) will be shown.
          </p>
        </div>
      )}

      {/* Venue creation dialog */}
      <Dialog
        open={venueDialog.open}
        onOpenChange={(open) =>
          setVenueDialog({ ...venueDialog, open })
        }
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Venue</DialogTitle>
            <DialogDescription>
              This venue doesn't exist yet. Create it to import the event.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="venue-name">Venue Name</Label>
              <Input
                id="venue-name"
                value={newVenueName}
                onChange={(e) => setNewVenueName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Neighborhood</Label>
              <Select
                value={newVenueNeighborhood}
                onValueChange={(v) => setNewVenueNeighborhood(v as Neighborhood)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NEIGHBORHOODS.map((n) => (
                    <SelectItem key={n} value={n}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Venue Type</Label>
              <Select
                value={newVenueType}
                onValueChange={(v) => setNewVenueType(v as VenueType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VENUE_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t.replace('_', ' ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setVenueDialog({ open: false, venueName: '', eventId: '' })}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateVenue}
              disabled={isCreatingVenue || !newVenueName}
            >
              {isCreatingVenue ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create Venue'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
