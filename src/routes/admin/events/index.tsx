import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useState, useMemo } from 'react'
import { Plus, Pencil, Trash2, Calendar, MapPin, Search, X, Filter, Upload, Clock, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Combobox } from '@/components/ui/combobox'
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
import { listEvents, deleteEventAction, bulkUpdateEventStatusAction, bulkDeleteEventsAction } from '@/lib/admin'
import type { EventWithVenue, EventStatus } from '@/lib/types'

export const Route = createFileRoute('/admin/events/')({
  loader: async () => {
    return listEvents()
  },
  component: EventListPage,
})

function EventListPage() {
  const events = Route.useLoaderData()
  const router = useRouter()
  const [deleteTarget, setDeleteTarget] = useState<EventWithVenue | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // Filter state
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<EventStatus | 'all'>('all')
  const [venueFilter, setVenueFilter] = useState<string | undefined>(undefined)
  const [showFilters, setShowFilters] = useState(false)

  // Selection state for bulk actions
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkAction, setBulkAction] = useState<'delete' | 'past' | 'cancelled' | null>(null)
  const [isBulkProcessing, setIsBulkProcessing] = useState(false)

  // Get unique venues for filter dropdown
  const venueOptions = useMemo(() => {
    const uniqueVenues = new Map<string, string>()
    events.forEach((event) => {
      if (event.venue_name && event.venue_id) {
        uniqueVenues.set(event.venue_id, event.venue_name)
      }
    })
    return Array.from(uniqueVenues.entries()).map(([id, name]) => ({
      value: id,
      label: name,
    }))
  }, [events])

  // Filter events
  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      // Search filter
      if (search && !event.name.toLowerCase().includes(search.toLowerCase())) {
        return false
      }
      // Status filter
      if (statusFilter !== 'all' && event.status !== statusFilter) {
        return false
      }
      // Venue filter
      if (venueFilter && event.venue_id !== venueFilter) {
        return false
      }
      return true
    })
  }, [events, search, statusFilter, venueFilter])

  const hasActiveFilters = search || statusFilter !== 'all' || venueFilter

  function clearFilters() {
    setSearch('')
    setStatusFilter('all')
    setVenueFilter(undefined)
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setIsDeleting(true)

    try {
      await deleteEventAction({ data: deleteTarget.id })
      setDeleteTarget(null)
      router.invalidate()
    } catch (err) {
      console.error('Delete failed:', err)
    } finally {
      setIsDeleting(false)
    }
  }

  // Selection helpers
  function toggleSelect(id: string) {
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

  function toggleSelectAll() {
    if (selectedIds.size === filteredEvents.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filteredEvents.map((e) => e.id)))
    }
  }

  function clearSelection() {
    setSelectedIds(new Set())
  }

  // Bulk action handlers
  async function handleBulkAction() {
    if (!bulkAction || selectedIds.size === 0) return
    setIsBulkProcessing(true)

    try {
      const ids = Array.from(selectedIds)

      if (bulkAction === 'delete') {
        await bulkDeleteEventsAction({ data: ids })
      } else if (bulkAction === 'past' || bulkAction === 'cancelled') {
        await bulkUpdateEventStatusAction({ data: { eventIds: ids, status: bulkAction } })
      }

      setSelectedIds(new Set())
      setBulkAction(null)
      router.invalidate()
    } catch (err) {
      console.error('Bulk action failed:', err)
    } finally {
      setIsBulkProcessing(false)
    }
  }

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

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-fade-in-up">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground flex items-center gap-2">
            <Calendar className="h-6 w-6 text-primary" />
            Events
          </h1>
          <p className="text-muted-foreground mt-1">
            {hasActiveFilters
              ? `${filteredEvents.length} of ${events.length} events`
              : `${events.length} events in database`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" className="border-border/50">
            <Link to="/admin/events/import">
              <Upload className="h-4 w-4 mr-2" />
              Import CSV
            </Link>
          </Button>
          <Button asChild className="bg-primary text-primary-foreground hover:bg-primary/90">
            <Link to="/admin/events/new">
              <Plus className="h-4 w-4 mr-2" />
              Add Event
            </Link>
          </Button>
        </div>
      </div>

      <div className="deco-line w-24" />

      {/* Filter Bar */}
      {events.length > 0 && (
        <div className="space-y-3">
          {/* Mobile filter toggle */}
          <div className="sm:hidden">
            <Button
              variant="outline"
              onClick={() => setShowFilters(!showFilters)}
              className="w-full justify-between border-border/50"
            >
              <span className="flex items-center gap-2">
                <Filter className="h-4 w-4" />
                Filters
                {hasActiveFilters && (
                  <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                    Active
                  </Badge>
                )}
              </span>
              <span className="text-muted-foreground text-xs">
                {showFilters ? 'Hide' : 'Show'}
              </span>
            </Button>
          </div>

          {/* Filter controls */}
          <div className={`grid gap-3 ${showFilters ? 'grid' : 'hidden'} sm:grid sm:grid-cols-4`}>
            {/* Search */}
            <div className="relative sm:col-span-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search events..."
                className="pl-9 bg-background/50 border-border/50"
              />
            </div>

            {/* Status filter */}
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as EventStatus | 'all')}
            >
              <SelectTrigger className="bg-background/50 border-border/50">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="scheduled">Scheduled</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
                <SelectItem value="postponed">Postponed</SelectItem>
                <SelectItem value="past">Past</SelectItem>
              </SelectContent>
            </Select>

            {/* Venue filter */}
            <Combobox
              options={venueOptions}
              value={venueFilter}
              onValueChange={setVenueFilter}
              placeholder="All Venues"
              emptyText="No venues found"
            />
          </div>

          {/* Clear filters */}
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5 mr-1.5" />
              Clear filters
            </Button>
          )}
        </div>
      )}

      {/* Bulk Action Bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 p-3 bg-primary/5 border border-primary/20 rounded-lg animate-fade-in-up">
          <div className="flex items-center gap-2">
            <Checkbox
              checked={selectedIds.size === filteredEvents.length}
              onCheckedChange={toggleSelectAll}
            />
            <span className="text-sm font-medium text-foreground">
              {selectedIds.size} selected
            </span>
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setBulkAction('past')}
              className="border-border/50"
            >
              <Clock className="h-4 w-4 mr-1.5" />
              Mark Past
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setBulkAction('cancelled')}
              className="border-border/50"
            >
              <XCircle className="h-4 w-4 mr-1.5" />
              Mark Cancelled
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setBulkAction('delete')}
              className="border-destructive/50 text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-4 w-4 mr-1.5" />
              Delete
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearSelection}
              className="text-muted-foreground"
            >
              Clear
            </Button>
          </div>
        </div>
      )}

      {/* Content */}
      {events.length === 0 ? (
        <div className="text-center py-12 bg-card/50 rounded-xl border border-border/50">
          <Calendar className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="font-display text-lg font-medium text-foreground mb-2">No events yet</h3>
          <p className="text-muted-foreground mb-4">Get started by adding your first event.</p>
          <Button asChild className="bg-primary text-primary-foreground">
            <Link to="/admin/events/new">
              <Plus className="h-4 w-4 mr-2" />
              Add Event
            </Link>
          </Button>
        </div>
      ) : filteredEvents.length === 0 ? (
        <div className="text-center py-12 bg-card/50 rounded-xl border border-border/50">
          <Search className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="font-display text-lg font-medium text-foreground mb-2">No matching events</h3>
          <p className="text-muted-foreground mb-4">Try adjusting your filters.</p>
          <Button variant="outline" onClick={clearFilters}>
            Clear filters
          </Button>
        </div>
      ) : (
        <>
          {/* Mobile Card View */}
          <div className="sm:hidden space-y-3">
            {filteredEvents.map((event) => (
              <div
                key={event.id}
                className={`bg-card/50 rounded-xl border border-border/50 p-4 space-y-3 ${
                  selectedIds.has(event.id) ? 'border-primary/50 bg-primary/5' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <Checkbox
                      checked={selectedIds.has(event.id)}
                      onCheckedChange={() => toggleSelect(event.id)}
                      className="mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-foreground truncate">{event.name}</p>
                    {event.categories.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
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
                    )}
                    </div>
                  </div>
                  {getStatusBadge(event.status)}
                </div>

                <div className="space-y-1.5 text-sm text-muted-foreground">
                  {event.venue_name && (
                    <div className="flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{event.venue_name}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 shrink-0" />
                    <span>{formatDate(event.starts_at)}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-2 border-t border-border/30">
                  <Button
                    asChild
                    variant="ghost"
                    size="sm"
                    className="flex-1 text-muted-foreground hover:text-foreground"
                  >
                    <Link to="/admin/events/$id" params={{ id: event.id }}>
                      <Pencil className="h-4 w-4 mr-2" />
                      Edit
                    </Link>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex-1 text-muted-foreground hover:text-destructive"
                    onClick={() => setDeleteTarget(event)}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop Table View */}
          <div className="hidden sm:block bg-card/50 rounded-xl border border-border/50 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-border/50 hover:bg-transparent">
                  <TableHead className="w-12">
                    <Checkbox
                      checked={selectedIds.size === filteredEvents.length && filteredEvents.length > 0}
                      onCheckedChange={toggleSelectAll}
                    />
                  </TableHead>
                  <TableHead className="text-muted-foreground font-medium">Event</TableHead>
                  <TableHead className="text-muted-foreground font-medium">Venue</TableHead>
                  <TableHead className="text-muted-foreground font-medium">Date</TableHead>
                  <TableHead className="text-muted-foreground font-medium">Status</TableHead>
                  <TableHead className="text-muted-foreground font-medium text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEvents.map((event) => (
                  <TableRow
                    key={event.id}
                    className={`border-border/30 hover:bg-muted/30 transition-colors ${
                      selectedIds.has(event.id) ? 'bg-primary/5' : ''
                    }`}
                  >
                    <TableCell>
                      <Checkbox
                        checked={selectedIds.has(event.id)}
                        onCheckedChange={() => toggleSelect(event.id)}
                      />
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium text-foreground">{event.name}</p>
                        {event.categories.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
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
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {event.venue_name ? (
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <MapPin className="h-3.5 w-3.5" />
                          <span>{event.venue_name}</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(event.starts_at)}
                    </TableCell>
                    <TableCell>{getStatusBadge(event.status)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
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
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => setDeleteTarget(event)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent className="bg-card border-border/50">
          <DialogHeader>
            <DialogTitle className="font-display text-foreground">Delete Event</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Are you sure you want to delete <strong>{deleteTarget?.name}</strong>?
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="ghost"
              onClick={() => setDeleteTarget(null)}
              className="text-muted-foreground"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk action confirmation dialog */}
      <Dialog open={!!bulkAction} onOpenChange={() => setBulkAction(null)}>
        <DialogContent className="bg-card border-border/50">
          <DialogHeader>
            <DialogTitle className="font-display text-foreground">
              {bulkAction === 'delete' && 'Delete Events'}
              {bulkAction === 'past' && 'Mark Events as Past'}
              {bulkAction === 'cancelled' && 'Mark Events as Cancelled'}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {bulkAction === 'delete' && (
                <>
                  Are you sure you want to delete <strong>{selectedIds.size} events</strong>?
                  This action cannot be undone.
                </>
              )}
              {bulkAction === 'past' && (
                <>
                  Mark <strong>{selectedIds.size} events</strong> as past?
                  They will no longer appear in the main event list.
                </>
              )}
              {bulkAction === 'cancelled' && (
                <>
                  Mark <strong>{selectedIds.size} events</strong> as cancelled?
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="ghost"
              onClick={() => setBulkAction(null)}
              className="text-muted-foreground"
            >
              Cancel
            </Button>
            <Button
              variant={bulkAction === 'delete' ? 'destructive' : 'default'}
              onClick={handleBulkAction}
              disabled={isBulkProcessing}
            >
              {isBulkProcessing
                ? 'Processing...'
                : bulkAction === 'delete'
                  ? 'Delete'
                  : 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
