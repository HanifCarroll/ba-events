import { useState, useMemo } from 'react'
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
  ArrowLeft,
  Building2,
  Merge,
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
  processPasslineEventsAction,
  importPasslineEventsBatchAction,
  createVenueAction,
  bulkCreateVenuesAction,
  listVenues,
  type PasslinePreviewEvent,
} from '@/lib/admin'
import {
  fetchPasslineEventsClient,
  filterCABAEventsClient,
  filterByDateRangeClient,
} from '@/lib/scrapers/passline/client'
import { NEIGHBORHOODS, VENUE_TYPES } from '@/lib/types'
import type { Neighborhood, VenueType } from '@/lib/types'

interface PasslineScraperProps {
  venues: { id: string; name: string; neighborhood: string | null }[]
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

  // Step state: fetch -> venues (if unmatched) -> import
  const [step, setStep] = useState<'fetch' | 'venues' | 'import'>('fetch')

  // State
  const [isLoading, setIsLoading] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [isCreatingVenues, setIsCreatingVenues] = useState(false)
  const [events, setEvents] = useState<PasslinePreviewEvent[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [importResult, setImportResult] = useState<{
    inserted: number
    updated: number
  } | null>(null)
  const [importProgress, setImportProgress] = useState<{
    current: number
    total: number
  } | null>(null)

  // Venue preview state
  interface VenueEdit {
    name: string
    neighborhood: Neighborhood | null
    skip: boolean
    mergeInto?: string // Name of venue to merge into
  }
  const [venueEdits, setVenueEdits] = useState<Map<string, VenueEdit>>(new Map())

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
  const [_venues, setVenues] = useState(initialVenues)

  // Compute unmatched venues with event counts
  const unmatchedVenues = useMemo(() => {
    const venueMap = new Map<string, { name: string; count: number; eventIds: string[] }>()

    events
      .filter((e) => e.venueMatch.matchType === 'none')
      .forEach((e) => {
        const name = e.passline.lugar
        const existing = venueMap.get(name)
        if (existing) {
          existing.count++
          existing.eventIds.push(e.passline.id)
        } else {
          venueMap.set(name, { name, count: 1, eventIds: [e.passline.id] })
        }
      })

    return Array.from(venueMap.values()).sort((a, b) => b.count - a.count)
  }, [events])

  // Find similar venue names for merge suggestions
  const similarVenues = useMemo(() => {
    const similar = new Map<string, string[]>()
    const names = unmatchedVenues.map((v) => v.name)

    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const a = names[i].toLowerCase().trim()
        const b = names[j].toLowerCase().trim()

        // Simple check: one contains the other (excluding very short strings)
        if (a.length > 5 && b.length > 5) {
          if (a.includes(b) || b.includes(a)) {
            const existing = similar.get(names[i]) || []
            existing.push(names[j])
            similar.set(names[i], existing)
          }
        }
      }
    }

    return similar
  }, [unmatchedVenues])

  // Initialize venue edits when unmatched venues change
  useMemo(() => {
    if (unmatchedVenues.length > 0 && venueEdits.size === 0) {
      const edits = new Map<string, VenueEdit>()
      unmatchedVenues.forEach((v) => {
        edits.set(v.name, {
          name: v.name,
          neighborhood: null, // No default - will be enriched later
          skip: false,
        })
      })
      setVenueEdits(edits)
    }
  }, [unmatchedVenues])

  // Fetch events from Passline (client-side to bypass Cloudflare)
  async function handleFetch() {
    setIsLoading(true)
    setError(null)
    setImportResult(null)
    setVenueEdits(new Map()) // Reset venue edits

    try {
      // Step 1: Fetch from Passline API directly (browser can handle Cloudflare)
      const allEvents = await fetchPasslineEventsClient()

      // Step 2: Filter to CABA and date range
      const cabaEvents = filterCABAEventsClient(allEvents)
      const filteredEvents = filterByDateRangeClient(cabaEvents, { startDate, endDate })

      // Step 3: Send to server for venue matching and transformation
      const data = await processPasslineEventsAction({
        data: { events: filteredEvents },
      })

      setEvents(data)

      // Check if there are unmatched venues
      const hasUnmatched = data.some((e) => e.venueMatch.matchType === 'none')

      if (hasUnmatched) {
        // Go to venue preview step
        setStep('venues')
      } else {
        // All venues matched, go directly to import
        setStep('import')
        // Auto-select all events
        setSelectedIds(new Set(data.map((e) => e.passline.id)))
      }
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

  // Update a venue edit
  function updateVenueEdit(name: string, updates: Partial<VenueEdit>) {
    setVenueEdits((prev) => {
      const next = new Map(prev)
      const existing = next.get(name)
      if (existing) {
        next.set(name, { ...existing, ...updates })
      }
      return next
    })
  }

  // Skip venue creation and go to import
  function handleSkipVenues() {
    setStep('import')
    // Auto-select only events with matched venues
    const autoSelected = new Set(
      events
        .filter((e) => e.venueMatch.matchType !== 'none')
        .map((e) => e.passline.id)
    )
    setSelectedIds(autoSelected)
  }

  // Bulk create venues and proceed to import
  async function handleBulkCreateVenues() {
    setIsCreatingVenues(true)
    setError(null)

    try {
      // Collect venues to create (excluding skipped and merged)
      const venuesToCreate: { name: string; neighborhood: Neighborhood | null; type: VenueType }[] = []
      const mergeMap = new Map<string, string>() // Maps merged venue names to target

      venueEdits.forEach((edit, originalName) => {
        if (edit.skip) return
        if (edit.mergeInto) {
          mergeMap.set(originalName, edit.mergeInto)
          return
        }
        venuesToCreate.push({
          name: edit.name,
          neighborhood: edit.neighborhood, // Can be null - will be enriched later
          type: 'other',
        })
      })

      if (venuesToCreate.length > 0) {
        // Bulk create venues
        await bulkCreateVenuesAction({ data: venuesToCreate })
      }

      // Re-fetch venue list
      const updatedVenues = await listVenues()
      setVenues(updatedVenues.map((v) => ({ id: v.id, name: v.name, neighborhood: v.neighborhood })))

      // Update event venue matches locally
      setEvents((prev) =>
        prev.map((event) => {
          if (event.venueMatch.matchType !== 'none') return event

          const passlineName = event.passline.lugar
          const edit = venueEdits.get(passlineName)

          // Find the target venue name (after merge resolution)
          let targetName = passlineName
          if (edit?.mergeInto) {
            targetName = edit.mergeInto
          }

          // Find the created/existing venue
          const matchedVenue = updatedVenues.find(
            (v) => v.name.toLowerCase() === targetName.toLowerCase()
          )

          if (matchedVenue) {
            return {
              ...event,
              venueMatch: {
                venue: matchedVenue,
                matchType: 'exact' as const,
                confidence: 1,
                searchName: event.venueMatch.searchName,
              },
              transformed: { ...event.transformed, venue_id: matchedVenue.id },
            }
          }

          return event
        })
      )

      // Move to import step
      setStep('import')
      // Auto-select all events with matched venues
      setTimeout(() => {
        setSelectedIds(new Set(
          events
            .filter((e) => e.venueMatch.matchType !== 'none' || !venueEdits.get(e.passline.lugar)?.skip)
            .map((e) => e.passline.id)
        ))
      }, 0)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create venues')
    } finally {
      setIsCreatingVenues(false)
    }
  }

  // Go back to fetch step
  function handleBack() {
    setStep('fetch')
    setEvents([])
    setSelectedIds(new Set())
    setVenueEdits(new Map())
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

  // Import selected events in batches
  async function handleImport() {
    if (selectedIds.size === 0) return

    setIsImporting(true)
    setError(null)
    setImportResult(null)
    setImportProgress({ current: 0, total: selectedIds.size })

    try {
      // Build import payload with full event data
      const eventsToImport = events
        .filter((e) => selectedIds.has(e.passline.id))
        .map((e) => ({
          passlineEvent: e.passline,
          venueId: e.venueMatch.venue?.id || null,
        }))

      // Process in batches of 10 to avoid timeouts
      const BATCH_SIZE = 10
      let totalInserted = 0
      let totalUpdated = 0

      for (let i = 0; i < eventsToImport.length; i += BATCH_SIZE) {
        const batch = eventsToImport.slice(i, i + BATCH_SIZE)
        const result = await importPasslineEventsBatchAction({ data: { events: batch } })

        totalInserted += result.inserted
        totalUpdated += result.updated
        setImportProgress({ current: Math.min(i + BATCH_SIZE, eventsToImport.length), total: eventsToImport.length })
      }

      setImportResult({ inserted: totalInserted, updated: totalUpdated })
      setImportProgress(null)

      // Redirect after delay
      setTimeout(() => {
        router.navigate({ to: '/admin/events' })
      }, 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import events')
      setImportProgress(null)
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

  // Count venues to create (excluding skipped and merged)
  const venuesToCreateCount = useMemo(() => {
    let count = 0
    venueEdits.forEach((edit) => {
      if (!edit.skip && !edit.mergeInto) count++
    })
    return count
  }, [venueEdits])

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      {step !== 'fetch' && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <button
            onClick={handleBack}
            className="flex items-center gap-1 hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <span className="text-border">/</span>
          <span className={step === 'venues' ? 'text-foreground font-medium' : ''}>
            {step === 'venues' ? 'Review Venues' : 'Import Events'}
          </span>
        </div>
      )}

      {/* Date filter - only show on fetch step */}
      {step === 'fetch' && (
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
      )}

      {/* Actions bar - venues step */}
      {step === 'venues' && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-muted-foreground" />
            <span className="font-medium">
              {unmatchedVenues.length} unmatched venue{unmatchedVenues.length !== 1 ? 's' : ''}
            </span>
            <span className="text-sm text-muted-foreground">
              ({events.length} events total)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={handleSkipVenues}
            >
              Skip Venue Creation
            </Button>
            <Button
              onClick={handleBulkCreateVenues}
              disabled={isCreatingVenues || venuesToCreateCount === 0}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              {isCreatingVenues ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Create {venuesToCreateCount} Venue{venuesToCreateCount !== 1 ? 's' : ''}
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Actions bar - import step */}
      {step === 'import' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button
                onClick={handleFetch}
                disabled={isLoading || isImporting}
                variant="outline"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
              <span className="text-sm text-muted-foreground">
                {events.length} events found
              </span>
            </div>
            <Button
              onClick={handleImport}
              disabled={isImporting || selectedIds.size === 0}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              {isImporting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {importProgress
                    ? `Importing ${importProgress.current}/${importProgress.total}...`
                    : 'Importing...'}
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 mr-2" />
                  Import {selectedIds.size} Event{selectedIds.size !== 1 ? 's' : ''}
                </>
              )}
            </Button>
          </div>
          {/* Progress bar */}
          {importProgress && (
            <div className="space-y-1">
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-500 transition-all duration-300"
                  style={{ width: `${(importProgress.current / importProgress.total) * 100}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground text-right">
                {importProgress.current} of {importProgress.total} events imported
              </p>
            </div>
          )}
        </div>
      )}

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

      {/* Venue preview table - venues step */}
      {step === 'venues' && unmatchedVenues.length > 0 && (
        <div className="bg-card/50 rounded-xl border border-border/50 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[50px]">Skip</TableHead>
                <TableHead>Venue Name</TableHead>
                <TableHead className="w-[100px]">Events</TableHead>
                <TableHead className="w-[200px]">Neighborhood</TableHead>
                <TableHead className="w-[250px]">Merge Into</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {unmatchedVenues.map((venue) => {
                const edit = venueEdits.get(venue.name)
                const suggestions = similarVenues.get(venue.name) || []
                const isMerged = edit?.mergeInto !== undefined

                return (
                  <TableRow
                    key={venue.name}
                    className={edit?.skip ? 'opacity-50' : isMerged ? 'bg-blue-500/5' : ''}
                  >
                    <TableCell>
                      <Checkbox
                        checked={edit?.skip || false}
                        onCheckedChange={(checked) =>
                          updateVenueEdit(venue.name, { skip: !!checked, mergeInto: undefined })
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <span className={`font-medium ${edit?.skip ? 'line-through' : ''}`}>
                          {venue.name}
                        </span>
                        {suggestions.length > 0 && !edit?.skip && !isMerged && (
                          <span className="text-xs text-yellow-500 flex items-center gap-1">
                            <AlertCircle className="h-3 w-3" />
                            Similar to: {suggestions.join(', ')}
                          </span>
                        )}
                        {isMerged && (
                          <span className="text-xs text-blue-500 flex items-center gap-1">
                            <Merge className="h-3 w-3" />
                            Will merge into "{edit.mergeInto}"
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs">
                        {venue.count}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={edit?.neighborhood || '_unknown'}
                        onValueChange={(v) =>
                          updateVenueEdit(venue.name, {
                            neighborhood: v === '_unknown' ? null : (v as Neighborhood),
                          })
                        }
                        disabled={edit?.skip || isMerged}
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_unknown">Unknown</SelectItem>
                          {NEIGHBORHOODS.map((n) => (
                            <SelectItem key={n} value={n}>
                              {n}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      {suggestions.length > 0 ? (
                        <Select
                          value={edit?.mergeInto || '_none'}
                          onValueChange={(v) =>
                            updateVenueEdit(venue.name, {
                              mergeInto: v === '_none' ? undefined : v,
                            })
                          }
                          disabled={edit?.skip}
                        >
                          <SelectTrigger className="h-8">
                            <SelectValue placeholder="Don't merge" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="_none">Don't merge</SelectItem>
                            {suggestions.map((s) => (
                              <SelectItem key={s} value={s}>
                                {s}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Events table - import step */}
      {step === 'import' && events.length > 0 && (
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
                    {(event.transformed.categories || []).map((cat) => (
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

      {/* Empty state - only on fetch step */}
      {step === 'fetch' && events.length === 0 && (
        <div className="bg-card/50 rounded-xl border border-border/50 p-12 text-center">
          {isLoading ? (
            <Loader2 className="h-12 w-12 text-muted-foreground mx-auto mb-4 animate-spin" />
          ) : (
            <Zap className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          )}
          <h3 className="text-lg font-medium text-foreground mb-2">
            {isLoading ? 'Fetching events...' : 'Ready to fetch events'}
          </h3>
          <p className="text-muted-foreground max-w-md mx-auto mb-6">
            {isLoading
              ? 'Loading events from Passline. This may take a moment.'
              : 'Load events from Passline. Only events in Capital Federal (CABA) will be shown.'}
          </p>
          {!isLoading && (
            <Button
              onClick={handleFetch}
              className="bg-primary text-primary-foreground"
            >
              <Download className="h-4 w-4 mr-2" />
              Fetch Events
            </Button>
          )}
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
