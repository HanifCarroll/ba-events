import { createFileRoute, Link } from '@tanstack/react-router'
import { memo, useRef, useEffect, useMemo, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { toast } from 'sonner'
import {
  Plus,
  Pencil,
  Trash2,
  Calendar,
  MapPin,
  Search,
  XCircle,
  CheckCircle2,
  FileSpreadsheet,
  AlertCircle,
  FileText,
  Tags,
} from 'lucide-react'
import * as m from '@/paraglide/messages'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Combobox } from '@/components/ui/combobox'
import { DataTable, getEventColumns } from '@/components/data-table'
import { listEvents } from '@/lib/admin'
import { formatDateTime } from '@/lib/formatting'
import { useEventAdmin, useBackgroundEnrichment, useVenueEnrichment, type EventTab, type DataGapType } from '@/hooks'
import { BulkActionBar } from '@/components/admin/BulkActionBar'
import type { EventWithVenue } from '@/lib/types'

import { z } from 'zod'

const eventSearchSchema = z.object({
  tab: z.enum(['all', 'needs_attention', 'pending_review', 'past']).optional().catch('all'),
})

export const Route = createFileRoute('/admin/events/')({
  validateSearch: eventSearchSchema,
  loader: async () => {
    return listEvents()
  },
  component: EventListPage,
})

function getStatusBadge(status: string) {
  const statusLabels: Record<string, () => string> = {
    scheduled: () => m.admin_status_scheduled(),
    pending_review: () => m.admin_status_pending(),
    cancelled: () => m.admin_status_cancelled(),
    postponed: () => m.admin_status_postponed(),
    past: () => m.admin_status_past(),
  }
  const variants: Record<string, { className: string }> = {
    scheduled: {
      className: 'bg-green-500/10 text-green-400 border-green-500/30',
    },
    pending_review: {
      className: 'bg-orange-500/10 text-orange-400 border-orange-500/30',
    },
    cancelled: {
      className: 'bg-destructive/10 text-destructive border-destructive/30',
    },
    postponed: {
      className: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
    },
    past: {
      className: 'bg-muted/50 text-muted-foreground border-border/50',
    },
  }
  const variant = variants[status] || variants.scheduled
  const label = statusLabels[status]?.() || statusLabels.scheduled()
  return (
    <Badge variant="outline" className={variant.className}>
      {label}
    </Badge>
  )
}

function EventListPage() {
  const events = Route.useLoaderData()
  const { tab } = Route.useSearch()
  const navigate = Route.useNavigate()

  // Use URL param for tab, defaulting to 'all'
  const activeTab = (tab || 'all') as EventTab

  const { filtering, bulk, markPast, singleActions } = useEventAdmin(events, activeTab)
  const backgroundEnrichment = useBackgroundEnrichment()
  const venueEnrichment = useVenueEnrichment()

  // Calculate enrichable count for selected events (description enrichment)
  const enrichableCount = useMemo(() => {
    return backgroundEnrichment.getEnrichableEvents(filtering.filteredEvents, bulk.selectedIds).length
  }, [backgroundEnrichment, filtering.filteredEvents, bulk.selectedIds])

  // Calculate venue enrichable count for selected events
  const venueEnrichableCount = useMemo(() => {
    return venueEnrichment.getVenueEnrichableEvents(filtering.filteredEvents, bulk.selectedIds).length
  }, [venueEnrichment, filtering.filteredEvents, bulk.selectedIds])

  // Handle description enrichment with selection clear on complete
  const handleEnrich = useCallback(() => {
    backgroundEnrichment.enrichEvents(
      filtering.filteredEvents,
      bulk.selectedIds,
      () => bulk.clearSelection()
    )
  }, [backgroundEnrichment, filtering.filteredEvents, bulk.selectedIds, bulk.clearSelection])

  // Handle venue enrichment with selection clear on complete
  const handleVenueEnrich = useCallback(() => {
    venueEnrichment.enrichVenues(
      filtering.filteredEvents,
      bulk.selectedIds,
      () => bulk.clearSelection()
    )
  }, [venueEnrichment, filtering.filteredEvents, bulk.selectedIds, bulk.clearSelection])

  // Smart "Mark Past" toast on page load
  useEffect(() => {
    if (markPast.pastEventsCount > 0) {
      toast.info(m.admin_events_ended_toast({ count: markPast.pastEventsCount }), {
        description: m.admin_events_ended_desc(),
        action: {
          label: m.admin_mark_past_dialog(),
          onClick: () => markPast.handleMarkPastEvents(),
        },
        duration: 10000,
      })
    }
  }, []) // Only run once on mount

  const handleTabChange = (value: string) => {
    // Update URL search params to persist tab across router invalidations
    navigate({ search: { tab: value as EventTab } })
    // Clear other filters when switching tabs
    filtering.clearFilters()
  }

  // Handle selection change from DataTable
  const handleSelectionChange = useCallback(
    (newIds: Set<string>) => {
      // Find added/removed ids
      const added = [...newIds].filter((id) => !bulk.selectedIds.has(id))
      const removed = [...bulk.selectedIds].filter((id) => !newIds.has(id))

      // Toggle each changed id
      added.forEach((id) => bulk.toggleSelect(id))
      removed.forEach((id) => bulk.toggleSelect(id))
    },
    [bulk]
  )

  // Column definitions
  const columns = useMemo(
    () =>
      getEventColumns({
        onDelete: singleActions.setDeleteTarget,
        onApprove: singleActions.handleApprove,
        onReject: singleActions.handleReject,
        isApproving: singleActions.isApproving,
        isRejecting: singleActions.isRejecting,
        showNeedsAttention: filtering.activeTab === 'needs_attention',
      }),
    [singleActions, filtering.activeTab]
  )

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-fade-in-up">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground flex items-center gap-2">
            <Calendar className="h-6 w-6 text-primary" />
            {m.admin_events_title()}
          </h1>
          <p className="text-muted-foreground mt-1">
            {filtering.hasActiveFilters
              ? m.admin_events_filtered({ filtered: filtering.filteredEvents.length, total: events.length })
              : m.admin_events_count({ count: events.length })}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Import button - links to unified wizard */}
          <Button asChild variant="outline" className="border-border/50">
            <Link to="/admin/events/import">
              <FileSpreadsheet className="h-4 w-4 mr-2" />
              {m.admin_import()}
            </Link>
          </Button>

          {/* Add Event button */}
          <Button asChild className="bg-primary text-primary-foreground hover:bg-primary/90">
            <Link to="/admin/events/new">
              <Plus className="h-4 w-4 mr-2" />
              {m.admin_add_event()}
            </Link>
          </Button>
        </div>
      </div>

      <div className="deco-line w-24" />

      {/* Tabs */}
      {events.length > 0 && (
        <div className="space-y-4">
          <Tabs value={filtering.activeTab} onValueChange={handleTabChange}>
            <TabsList className="bg-card/50 border border-border/50 p-1 h-auto">
              <TabsTrigger
                value="all"
                className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary px-4 py-2"
              >
                {m.admin_tab_all()}
                <span className="ml-2 text-xs opacity-70">({filtering.tabCounts.all})</span>
              </TabsTrigger>
              <TabsTrigger
                value="needs_attention"
                className="data-[state=active]:bg-orange-500/20 data-[state=active]:text-orange-400 px-4 py-2"
              >
                <AlertCircle className="h-3.5 w-3.5 mr-1.5" />
                {m.admin_tab_needs_attention()}
                {filtering.tabCounts.needs_attention > 0 && (
                  <span className="ml-2 text-xs bg-orange-500/30 px-1.5 py-0.5 rounded-full">
                    {filtering.tabCounts.needs_attention}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger
                value="pending_review"
                className="data-[state=active]:bg-yellow-500/20 data-[state=active]:text-yellow-400 px-4 py-2"
              >
                {m.admin_tab_pending()}
                {filtering.tabCounts.pending_review > 0 && (
                  <span className="ml-2 text-xs bg-yellow-500/30 px-1.5 py-0.5 rounded-full">
                    {filtering.tabCounts.pending_review}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger
                value="past"
                className="data-[state=active]:bg-muted data-[state=active]:text-muted-foreground px-4 py-2"
              >
                {m.admin_tab_past()}
                <span className="ml-2 text-xs opacity-70">({filtering.tabCounts.past})</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Data gap filter chips - only show on needs_attention tab */}
          {filtering.activeTab === 'needs_attention' && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-muted-foreground mr-1">{m.admin_filter_by()}</span>
              <DataGapChip
                type="all"
                label={m.admin_all_gaps()}
                count={filtering.dataGapCounts.all}
                isActive={filtering.dataGapFilter === 'all'}
                onClick={() => filtering.setDataGapFilter('all')}
              />
              <DataGapChip
                type="missing_description"
                label={m.admin_missing_description()}
                count={filtering.dataGapCounts.missing_description}
                isActive={filtering.dataGapFilter === 'missing_description'}
                onClick={() => filtering.setDataGapFilter('missing_description')}
                icon={<FileText className="h-3.5 w-3.5" />}
              />
              <DataGapChip
                type="missing_venue"
                label={m.admin_missing_venue()}
                count={filtering.dataGapCounts.missing_venue}
                isActive={filtering.dataGapFilter === 'missing_venue'}
                onClick={() => filtering.setDataGapFilter('missing_venue')}
                icon={<MapPin className="h-3.5 w-3.5" />}
              />
              <DataGapChip
                type="missing_categories"
                label={m.admin_missing_categories()}
                count={filtering.dataGapCounts.missing_categories}
                isActive={filtering.dataGapFilter === 'missing_categories'}
                onClick={() => filtering.setDataGapFilter('missing_categories')}
                icon={<Tags className="h-3.5 w-3.5" />}
              />
            </div>
          )}

          {/* Search and Venue filter - compact row */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={m.admin_search_events()}
                value={filtering.search}
                onChange={(e) => filtering.setSearch(e.target.value)}
                className="pl-9 bg-background/50 border-border/50"
              />
            </div>
            <Combobox
              options={filtering.venueOptions}
              value={filtering.venueFilter}
              onValueChange={filtering.setVenueFilter}
              placeholder={m.admin_all_venues()}
              emptyText={m.admin_no_venues_found()}
              className="w-48"
            />
            {filtering.hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={filtering.clearFilters}
                className="text-muted-foreground hover:text-foreground"
              >
                {m.common_clear()}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Content */}
      {events.length === 0 ? (
        <EmptyState />
      ) : filtering.filteredEvents.length === 0 ? (
        <NoMatchesState onClearFilters={filtering.clearFilters} />
      ) : (
        <>
          {/* Mobile Card View */}
          <div className="sm:hidden">
            <BulkActionBar
              selectedCount={bulk.selectedIds.size}
              filteredEventsLength={filtering.filteredEvents.length}
              onToggleSelectAll={bulk.toggleSelectAll}
              onSetBulkAction={bulk.setBulkAction}
              onClearSelection={bulk.clearSelection}
              enrichableCount={enrichableCount}
              onEnrich={handleEnrich}
              isEnriching={backgroundEnrichment.isEnriching}
              onStopEnrich={backgroundEnrichment.stopEnrichment}
              venueEnrichableCount={venueEnrichableCount}
              onVenueEnrich={handleVenueEnrich}
              isVenueEnriching={venueEnrichment.isVenueEnriching}
            />
          </div>
          <MobileEventCards
            events={filtering.filteredEvents}
            selectedIds={bulk.selectedIds}
            onToggleSelect={bulk.toggleSelect}
            onApprove={singleActions.handleApprove}
            onReject={singleActions.handleReject}
            onDelete={singleActions.setDeleteTarget}
            isApproving={singleActions.isApproving}
            isRejecting={singleActions.isRejecting}
            showNeedsAttention={filtering.activeTab === 'needs_attention'}
          />

          {/* Desktop Table View with DataTable */}
          <div className="hidden sm:block">
            <div className="relative">
              {/* Bulk action overlay - needs z-20 to be above sticky table header (z-10) */}
              <div className="absolute top-0 left-0 right-0 z-20">
                <BulkActionBar
                  selectedCount={bulk.selectedIds.size}
                  filteredEventsLength={filtering.filteredEvents.length}
                  onToggleSelectAll={bulk.toggleSelectAll}
                  onSetBulkAction={bulk.setBulkAction}
                  onClearSelection={bulk.clearSelection}
                  overlay
                  enrichableCount={enrichableCount}
                  onEnrich={handleEnrich}
                  isEnriching={backgroundEnrichment.isEnriching}
                  onStopEnrich={backgroundEnrichment.stopEnrichment}
                  venueEnrichableCount={venueEnrichableCount}
                  onVenueEnrich={handleVenueEnrich}
                  isVenueEnriching={venueEnrichment.isVenueEnriching}
                />
              </div>

              <DataTable
                columns={columns}
                data={filtering.filteredEvents}
                tableId="admin-events"
                enableRowSelection={true}
                selectedIds={bulk.selectedIds}
                onSelectionChange={handleSelectionChange}
                enableColumnResizing={true}
                enableColumnReordering={true}
                enableMultiSort={true}
                enableVirtualization={true}
                estimatedRowHeight={64}
                containerHeight="calc(100vh - 420px)"
              />
            </div>
          </div>
        </>
      )}

      {/* Delete confirmation dialog */}
      <Dialog open={!!singleActions.deleteTarget} onOpenChange={() => singleActions.setDeleteTarget(null)}>
        <DialogContent className="bg-card border-border/50">
          <DialogHeader>
            <DialogTitle className="font-display text-foreground">{m.admin_delete_event()}</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {m.admin_delete_event_confirm({ name: singleActions.deleteTarget?.name || '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="ghost"
              onClick={() => singleActions.setDeleteTarget(null)}
              className="text-muted-foreground"
            >
              {m.common_cancel()}
            </Button>
            <Button
              variant="destructive"
              onClick={singleActions.handleDelete}
              disabled={singleActions.isDeleting}
            >
              {singleActions.isDeleting ? m.common_deleting() : m.common_delete()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk action confirmation dialog */}
      <Dialog open={!!bulk.bulkAction} onOpenChange={() => bulk.setBulkAction(null)}>
        <DialogContent className="bg-card border-border/50">
          <DialogHeader>
            <DialogTitle className="font-display text-foreground">
              {bulk.bulkAction === 'delete' && m.admin_delete_events()}
              {bulk.bulkAction === 'past' && m.admin_mark_past()}
              {bulk.bulkAction === 'cancelled' && m.admin_mark_cancelled()}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {bulk.bulkAction === 'delete' && m.admin_delete_events_confirm({ count: bulk.selectedIds.size })}
              {bulk.bulkAction === 'past' && m.admin_mark_past_confirm({ count: bulk.selectedIds.size })}
              {bulk.bulkAction === 'cancelled' && m.admin_mark_cancelled_confirm({ count: bulk.selectedIds.size })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="ghost"
              onClick={() => bulk.setBulkAction(null)}
              className="text-muted-foreground"
            >
              {m.common_cancel()}
            </Button>
            <Button
              variant={bulk.bulkAction === 'delete' ? 'destructive' : 'default'}
              onClick={bulk.handleBulkAction}
              disabled={bulk.isBulkProcessing}
            >
              {bulk.isBulkProcessing
                ? m.common_processing()
                : bulk.bulkAction === 'delete'
                  ? m.common_delete()
                  : m.common_confirm()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mark past events dialog - kept for manual triggering if needed */}
      <Dialog open={markPast.showMarkPastDialog} onOpenChange={markPast.setShowMarkPastDialog}>
        <DialogContent className="bg-card border-border/50">
          <DialogHeader>
            <DialogTitle className="font-display text-foreground">{m.admin_mark_past_dialog()}</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {markPast.pastEventsCount === 0 ? (
                m.admin_no_past_events()
              ) : (
                m.admin_found_past_events({ count: markPast.pastEventsCount })
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="ghost"
              onClick={() => markPast.setShowMarkPastDialog(false)}
              className="text-muted-foreground"
            >
              {m.common_cancel()}
            </Button>
            <Button
              onClick={markPast.handleMarkPastEvents}
              disabled={markPast.isMarkingPast || markPast.pastEventsCount === 0}
            >
              {markPast.isMarkingPast ? m.admin_marking() : m.admin_mark_count_past({ count: markPast.pastEventsCount })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  )
}

// Sub-components

function EmptyState() {
  return (
    <div className="text-center py-12 bg-card/50 rounded-xl border border-border/50">
      <Calendar className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
      <h3 className="font-display text-lg font-medium text-foreground mb-2">{m.admin_no_events()}</h3>
      <p className="text-muted-foreground mb-4">{m.admin_no_events_desc()}</p>
      <Button asChild className="bg-primary text-primary-foreground">
        <Link to="/admin/events/new">
          <Plus className="h-4 w-4 mr-2" />
          {m.admin_add_event()}
        </Link>
      </Button>
    </div>
  )
}

function NoMatchesState({ onClearFilters }: { onClearFilters: () => void }) {
  return (
    <div className="text-center py-12 bg-card/50 rounded-xl border border-border/50">
      <Search className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
      <h3 className="font-display text-lg font-medium text-foreground mb-2">{m.admin_no_matching_events()}</h3>
      <p className="text-muted-foreground mb-4">{m.admin_no_matching_desc()}</p>
      <Button variant="outline" onClick={onClearFilters}>
        {m.common_clear_filters()}
      </Button>
    </div>
  )
}

interface DataGapChipProps {
  type: DataGapType
  label: string
  count: number
  isActive: boolean
  onClick: () => void
  icon?: React.ReactNode
}

function DataGapChip({ label, count, isActive, onClick, icon }: DataGapChipProps) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-colors ${
        isActive
          ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
          : 'bg-card/50 text-muted-foreground border border-border/50 hover:bg-card hover:text-foreground'
      }`}
    >
      {icon}
      <span>{label}</span>
      <span className={`text-xs px-1.5 py-0.5 rounded-full ${
        isActive ? 'bg-orange-500/30' : 'bg-muted/50'
      }`}>
        {count}
      </span>
    </button>
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
  showNeedsAttention?: boolean
}

// Memoized mobile card component
const MobileEventCard = memo(function MobileEventCard({
  event,
  isSelected,
  onToggleSelect,
  onApprove,
  onReject,
  onDelete,
  isApproving,
  isRejecting,
  showNeedsAttention,
}: {
  event: EventWithVenue
  isSelected: boolean
  onToggleSelect: (id: string) => void
  onApprove: (id: string) => void
  onReject: (id: string) => void
  onDelete: (event: EventWithVenue) => void
  isApproving: string | null
  isRejecting: string | null
  showNeedsAttention?: boolean
}) {
  const needsDescription = !event.description_es && event.link

  return (
    <div
      className={`bg-card/50 rounded-xl border border-border/50 p-4 space-y-3 ${
        isSelected ? 'border-primary/50 bg-primary/5' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => onToggleSelect(event.id)}
            className="mt-0.5"
          />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-foreground truncate">{event.name}</p>
            <div className="flex flex-wrap gap-1 mt-1">
              {showNeedsAttention && needsDescription && (
                <Badge
                  variant="outline"
                  className="text-xs bg-orange-500/10 text-orange-400 border-orange-500/30"
                >
                  {m.admin_no_description()}
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
          <span>{formatDateTime(event.starts_at)}</span>
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
              {m.admin_approve()}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 text-destructive hover:bg-destructive/10"
              onClick={() => onReject(event.id)}
              disabled={isRejecting === event.id}
            >
              <XCircle className="h-4 w-4 mr-2" />
              {m.admin_reject()}
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
                {m.common_edit()}
              </Link>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 text-muted-foreground hover:text-destructive"
              onClick={() => onDelete(event)}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {m.common_delete()}
            </Button>
          </>
        )}
      </div>
    </div>
  )
})

function MobileEventCards({
  events,
  selectedIds,
  onToggleSelect,
  onApprove,
  onReject,
  onDelete,
  isApproving,
  isRejecting,
  showNeedsAttention,
}: EventListProps) {
  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: events.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 180,
    overscan: 5,
  })

  return (
    <div
      ref={parentRef}
      className="sm:hidden h-[calc(100vh-400px)] overflow-auto"
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const event = events[virtualRow.index]
          return (
            <div
              key={event.id}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
                padding: '6px 0',
              }}
            >
              <MobileEventCard
                event={event}
                isSelected={selectedIds.has(event.id)}
                onToggleSelect={onToggleSelect}
                onApprove={onApprove}
                onReject={onReject}
                onDelete={onDelete}
                isApproving={isApproving}
                isRejecting={isRejecting}
                showNeedsAttention={showNeedsAttention}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
