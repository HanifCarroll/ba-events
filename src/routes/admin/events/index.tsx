import { createFileRoute, Link } from '@tanstack/react-router'
import { Plus, Pencil, Trash2, Calendar, MapPin, Search, Upload, Clock, XCircle, Zap, CheckCircle2, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
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
import { listEvents } from '@/lib/admin'
import { useEventAdmin } from '@/hooks'
import { EventFilterBar } from '@/components/admin/EventFilterBar'
import { BulkActionBar } from '@/components/admin/BulkActionBar'
import { EnrichDescriptionsDialog } from '@/components/admin/EnrichDescriptionsDialog'
import type { EventWithVenue } from '@/lib/types'

export const Route = createFileRoute('/admin/events/')({
  loader: async () => {
    return listEvents()
  },
  component: EventListPage,
})

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

function EventListPage() {
  const events = Route.useLoaderData()
  const { filtering, bulk, markPast, singleActions, enrichment } = useEventAdmin(events)

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
            {filtering.hasActiveFilters
              ? `${filtering.filteredEvents.length} of ${events.length} events`
              : `${events.length} events in database`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="border-border/50"
            onClick={enrichment.openEnrichDialog}
          >
            <FileText className="h-4 w-4 mr-2" />
            Enrich
          </Button>
          <Button
            variant="outline"
            className="border-border/50"
            onClick={markPast.handleOpenMarkPastDialog}
          >
            <Clock className="h-4 w-4 mr-2" />
            Mark Past
          </Button>
          <Button asChild variant="outline" className="border-border/50">
            <Link to="/admin/events/import">
              <Upload className="h-4 w-4 mr-2" />
              Import CSV
            </Link>
          </Button>
          <Button asChild variant="outline" className="border-border/50 border-primary/50 text-primary hover:bg-primary/10">
            <Link to="/admin/events/passline">
              <Zap className="h-4 w-4 mr-2" />
              Passline
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
        <EventFilterBar
          search={filtering.search}
          setSearch={filtering.setSearch}
          statusFilter={filtering.statusFilter}
          setStatusFilter={filtering.setStatusFilter}
          venueFilter={filtering.venueFilter}
          setVenueFilter={filtering.setVenueFilter}
          showFilters={filtering.showFilters}
          setShowFilters={filtering.setShowFilters}
          venueOptions={filtering.venueOptions}
          hasActiveFilters={filtering.hasActiveFilters}
          clearFilters={filtering.clearFilters}
        />
      )}

      {/* Bulk Action Bar */}
      <BulkActionBar
        selectedCount={bulk.selectedIds.size}
        filteredEventsLength={filtering.filteredEvents.length}
        onToggleSelectAll={bulk.toggleSelectAll}
        onSetBulkAction={bulk.setBulkAction}
        onClearSelection={bulk.clearSelection}
      />

      {/* Content */}
      {events.length === 0 ? (
        <EmptyState />
      ) : filtering.filteredEvents.length === 0 ? (
        <NoMatchesState onClearFilters={filtering.clearFilters} />
      ) : (
        <>
          {/* Mobile Card View */}
          <MobileEventCards
            events={filtering.filteredEvents}
            selectedIds={bulk.selectedIds}
            onToggleSelect={bulk.toggleSelect}
            onApprove={singleActions.handleApprove}
            onReject={singleActions.handleReject}
            onDelete={singleActions.setDeleteTarget}
            isApproving={singleActions.isApproving}
            isRejecting={singleActions.isRejecting}
          />

          {/* Desktop Table View */}
          <DesktopEventTable
            events={filtering.filteredEvents}
            selectedIds={bulk.selectedIds}
            onToggleSelect={bulk.toggleSelect}
            onToggleSelectAll={bulk.toggleSelectAll}
            onApprove={singleActions.handleApprove}
            onReject={singleActions.handleReject}
            onDelete={singleActions.setDeleteTarget}
            isApproving={singleActions.isApproving}
            isRejecting={singleActions.isRejecting}
          />
        </>
      )}

      {/* Delete confirmation dialog */}
      <Dialog open={!!singleActions.deleteTarget} onOpenChange={() => singleActions.setDeleteTarget(null)}>
        <DialogContent className="bg-card border-border/50">
          <DialogHeader>
            <DialogTitle className="font-display text-foreground">Delete Event</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Are you sure you want to delete <strong>{singleActions.deleteTarget?.name}</strong>?
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="ghost"
              onClick={() => singleActions.setDeleteTarget(null)}
              className="text-muted-foreground"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={singleActions.handleDelete}
              disabled={singleActions.isDeleting}
            >
              {singleActions.isDeleting ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk action confirmation dialog */}
      <Dialog open={!!bulk.bulkAction} onOpenChange={() => bulk.setBulkAction(null)}>
        <DialogContent className="bg-card border-border/50">
          <DialogHeader>
            <DialogTitle className="font-display text-foreground">
              {bulk.bulkAction === 'delete' && 'Delete Events'}
              {bulk.bulkAction === 'past' && 'Mark Events as Past'}
              {bulk.bulkAction === 'cancelled' && 'Mark Events as Cancelled'}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {bulk.bulkAction === 'delete' && (
                <>
                  Are you sure you want to delete <strong>{bulk.selectedIds.size} events</strong>?
                  This action cannot be undone.
                </>
              )}
              {bulk.bulkAction === 'past' && (
                <>
                  Mark <strong>{bulk.selectedIds.size} events</strong> as past?
                  They will no longer appear in the main event list.
                </>
              )}
              {bulk.bulkAction === 'cancelled' && (
                <>
                  Mark <strong>{bulk.selectedIds.size} events</strong> as cancelled?
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="ghost"
              onClick={() => bulk.setBulkAction(null)}
              className="text-muted-foreground"
            >
              Cancel
            </Button>
            <Button
              variant={bulk.bulkAction === 'delete' ? 'destructive' : 'default'}
              onClick={bulk.handleBulkAction}
              disabled={bulk.isBulkProcessing}
            >
              {bulk.isBulkProcessing
                ? 'Processing...'
                : bulk.bulkAction === 'delete'
                  ? 'Delete'
                  : 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mark past events dialog */}
      <Dialog open={markPast.showMarkPastDialog} onOpenChange={markPast.setShowMarkPastDialog}>
        <DialogContent className="bg-card border-border/50">
          <DialogHeader>
            <DialogTitle className="font-display text-foreground">Mark Past Events</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {markPast.pastEventsCount === 0 ? (
                <>No events to mark as past. All scheduled events are still upcoming.</>
              ) : (
                <>
                  Found <strong>{markPast.pastEventsCount} ended events</strong> to mark as past.
                  Events are considered ended when their end time has passed, or if no end time
                  is set, when the entire start day has passed.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="ghost"
              onClick={() => markPast.setShowMarkPastDialog(false)}
              className="text-muted-foreground"
            >
              Cancel
            </Button>
            <Button
              onClick={markPast.handleMarkPastEvents}
              disabled={markPast.isMarkingPast || markPast.pastEventsCount === 0}
            >
              {markPast.isMarkingPast ? 'Marking...' : `Mark ${markPast.pastEventsCount} Past`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Description enrichment dialog */}
      <EnrichDescriptionsDialog
        open={enrichment.showEnrichDialog}
        onClose={enrichment.closeEnrichDialog}
        enrichStep={enrichment.enrichStep}
        setEnrichStep={enrichment.setEnrichStep}
        enrichProgress={enrichment.enrichProgress}
        fetchedDescriptions={enrichment.fetchedDescriptions}
        isLoadingEvents={enrichment.isLoadingEvents}
        eventsWithoutDesc={enrichment.eventsWithoutDesc}
        enrichSelectedIds={enrichment.enrichSelectedIds}
        onToggleSelect={enrichment.toggleEnrichSelect}
        onToggleSelectAll={enrichment.toggleEnrichSelectAll}
        onFetchDescriptions={enrichment.handleFetchDescriptions}
        onSaveDescriptions={enrichment.handleSaveDescriptions}
      />
    </div>
  )
}

// Sub-components

function EmptyState() {
  return (
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
  )
}

function NoMatchesState({ onClearFilters }: { onClearFilters: () => void }) {
  return (
    <div className="text-center py-12 bg-card/50 rounded-xl border border-border/50">
      <Search className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
      <h3 className="font-display text-lg font-medium text-foreground mb-2">No matching events</h3>
      <p className="text-muted-foreground mb-4">Try adjusting your filters.</p>
      <Button variant="outline" onClick={onClearFilters}>
        Clear filters
      </Button>
    </div>
  )
}

interface EventListProps {
  events: EventWithVenue[]
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onApprove: (id: string) => void
  onReject: (id: string) => void
  onDelete: (event: EventWithVenue) => void
  isApproving: string | null
  isRejecting: string | null
}

function MobileEventCards({
  events,
  selectedIds,
  onToggleSelect,
  onApprove,
  onReject,
  onDelete,
  isApproving,
  isRejecting,
}: EventListProps) {
  return (
    <div className="sm:hidden space-y-3">
      {events.map((event) => (
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
                onCheckedChange={() => onToggleSelect(event.id)}
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
            {event.status === 'pending_review' ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex-1 text-green-500 hover:text-green-400 hover:bg-green-500/10"
                  onClick={() => onApprove(event.id)}
                  disabled={isApproving === event.id}
                >
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Approve
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex-1 text-destructive hover:bg-destructive/10"
                  onClick={() => onReject(event.id)}
                  disabled={isRejecting === event.id}
                >
                  <XCircle className="h-4 w-4 mr-2" />
                  Reject
                </Button>
              </>
            ) : (
              <>
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
                  onClick={() => onDelete(event)}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </Button>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

interface DesktopTableProps extends EventListProps {
  onToggleSelectAll: () => void
}

function DesktopEventTable({
  events,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onApprove,
  onReject,
  onDelete,
  isApproving,
  isRejecting,
}: DesktopTableProps) {
  return (
    <div className="hidden sm:block bg-card/50 rounded-xl border border-border/50 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="border-border/50 hover:bg-transparent">
            <TableHead className="w-12">
              <Checkbox
                checked={selectedIds.size === events.length && events.length > 0}
                onCheckedChange={onToggleSelectAll}
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
          {events.map((event) => (
            <TableRow
              key={event.id}
              className={`border-border/30 hover:bg-muted/30 transition-colors ${
                selectedIds.has(event.id) ? 'bg-primary/5' : ''
              }`}
            >
              <TableCell>
                <Checkbox
                  checked={selectedIds.has(event.id)}
                  onCheckedChange={() => onToggleSelect(event.id)}
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
                <div className="flex items-center justify-end gap-1">
                  {event.status === 'pending_review' && (
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
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => onDelete(event)}
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
  )
}
