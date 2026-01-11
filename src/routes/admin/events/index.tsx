import { createFileRoute, Link } from '@tanstack/react-router'
import { memo, useRef, useEffect, useMemo, useCallback, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { debounce } from '@/shared/lib/utils'
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
} from 'lucide-react'
import * as m from '@/paraglide/messages'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { Checkbox } from '@/shared/ui/checkbox'
import { Input } from '@/shared/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/shared/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog'
import { Combobox } from '@/shared/ui/combobox'
import { DataTable, DataTablePagination, getEventColumns } from '@/shared/ui/data-table'
import { EmptyState as SharedEmptyState, NoMatchesState as SharedNoMatchesState } from '@/shared/ui/EmptyState'
import {
  useBackgroundEnrichment,
  useLumaDescriptionEnrichment,
  useBulkActions,
  useSingleEventActions,
  useMarkPastEvents,
  listAllEventsAdmin,
} from '@/features/events'
import { listVenues } from '@/features/venues'
import { formatDateTime } from '@/shared/lib/utils/formatting'
import { useVenueEnrichment } from '@/features/venues'
import { BulkActionBar } from './-components/BulkActionBar'
import { BackfillCard } from './-components/BackfillCard'
import { EditEventSheet } from './-components/EditEventSheet'
import type { EventWithVenue } from '@/shared/lib/types'
import type { EventSearchParams } from '@/shared/lib/types/pagination'

import { z } from 'zod'
import type { ColumnFiltersState, SortingState } from '@tanstack/react-table'

// Tab types for client-side filtering
type EventTab = 'all' | 'needs_attention' | 'pending_review' | 'past'

// Schema for URL search params - single source of truth for all filter state
const eventSearchSchema = z.object({
  // Tab filter
  tab: z.enum(['all', 'needs_attention', 'pending_review', 'past']).optional().catch('all'),
  // Pagination
  page: z.number().optional().catch(1),
  pageSize: z.number().optional().catch(25),
  // Quick filters (moved from React state to URL)
  search: z.string().optional(),
  venue: z.string().optional(), // venue ID filter
  importedToday: z.boolean().optional(), // Filter for recently imported events
  // View preferences
  showPast: z.boolean().optional().catch(false), // Default: false (hide past events)
  // Data gap filters (for needs_attention tab) - server-side
  missingDescription: z.boolean().optional(),
  missingVenue: z.boolean().optional(),
  // Column filters (for DataTable)
  name: z.string().optional(),
  venue_name: z.string().optional(),
  source: z.string().optional(),
  status: z.string().optional(),
  // Sorting (column and direction)
  sortBy: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
})

// Type is now defined in @/shared/lib/types/pagination.ts and exported via @/features/events

// Convert URL params to TanStack Table column filters
function paramsToColumnFilters(params: EventSearchParams): ColumnFiltersState {
  const filters: ColumnFiltersState = []
  if (params.name) filters.push({ id: 'name', value: params.name })
  if (params.venue_name) filters.push({ id: 'venue', value: params.venue_name })
  if (params.source) filters.push({ id: 'source', value: params.source })
  if (params.status) filters.push({ id: 'status', value: params.status })
  return filters
}

// Convert TanStack Table column filters to URL params
function columnFiltersToParams(filters: ColumnFiltersState): Partial<EventSearchParams> {
  const params: Partial<EventSearchParams> = {}
  for (const filter of filters) {
    if (filter.id === 'name' && typeof filter.value === 'string') params.name = filter.value
    if (filter.id === 'venue' && typeof filter.value === 'string') params.venue_name = filter.value
    if (filter.id === 'source' && typeof filter.value === 'string') params.source = filter.value
    if (filter.id === 'status' && typeof filter.value === 'string') params.status = filter.value
  }
  return params
}

// Convert URL params to TanStack Table sorting state
function paramsToSorting(params: EventSearchParams): SortingState {
  if (params.sortBy) {
    return [{ id: params.sortBy, desc: params.sortDir === 'desc' }]
  }
  return []
}

// Convert TanStack Table sorting to URL params
function sortingToParams(sorting: SortingState): Partial<EventSearchParams> {
  if (sorting.length > 0) {
    return {
      sortBy: sorting[0].id,
      sortDir: sorting[0].desc ? 'desc' : 'asc',
    }
  }
  return { sortBy: undefined, sortDir: undefined }
}

// ============================================
// Client-side filtering helpers
// ============================================

interface TabCounts {
  all: number
  needs_attention: number
  pending_review: number
  past: number
}

/** Check if event needs attention (missing description with link OR missing venue) */
function eventNeedsAttention(event: EventWithVenue): boolean {
  const missingDescriptionWithLink = !event.description_es && !!event.link
  const missingVenue = !event.venue_id
  return missingDescriptionWithLink || missingVenue
}

/** Compute tab counts from all events */
function computeTabCounts(events: EventWithVenue[], showPast: boolean): TabCounts {
  let all = 0
  let needs_attention = 0
  let pending_review = 0
  let past = 0

  for (const event of events) {
    // Count for "all" tab - excludes past unless showPast is true
    if (event.status !== 'past' || showPast) {
      all++
    }

    // Count needs_attention (excludes past events)
    if (event.status !== 'past' && eventNeedsAttention(event)) {
      needs_attention++
    }

    // Count pending_review
    if (event.status === 'pending_review') {
      pending_review++
    }

    // Count past
    if (event.status === 'past') {
      past++
    }
  }

  return { all, needs_attention, pending_review, past }
}

/** Filter events based on tab and search params */
function filterEvents(events: EventWithVenue[], params: EventSearchParams): EventWithVenue[] {
  const tab = params.tab ?? 'all'
  const showPast = params.showPast ?? false

  return events.filter((event) => {
    // Tab filtering
    switch (tab) {
      case 'needs_attention':
        if (event.status === 'past') return false
        if (!eventNeedsAttention(event)) return false
        break
      case 'pending_review':
        if (event.status !== 'pending_review') return false
        break
      case 'past':
        if (event.status !== 'past') return false
        break
      case 'all':
      default:
        // Hide past events unless showPast is true
        if (event.status === 'past' && !showPast) return false
        break
    }

    // Data gap filters (for needs_attention tab)
    if (params.missingDescription) {
      if (event.description_es || !event.link) return false
    }
    if (params.missingVenue) {
      if (event.venue_id) return false
    }

    // Search filter
    if (params.search) {
      const searchLower = params.search.toLowerCase()
      if (!event.name.toLowerCase().includes(searchLower)) return false
    }

    // Venue filter
    if (params.venue) {
      if (event.venue_id !== params.venue) return false
    }

    // Status filter
    if (params.status) {
      if (event.status !== params.status) return false
    }

    // Imported today filter
    if (params.importedToday) {
      const todayStart = new Date()
      todayStart.setHours(0, 0, 0, 0)
      const createdAt = new Date(event.created_at)
      if (createdAt < todayStart) return false
    }

    return true
  })
}

/** Sort events based on sort params */
function sortEvents(events: EventWithVenue[], sortBy?: string, sortDir?: 'asc' | 'desc'): EventWithVenue[] {
  const column = sortBy ?? 'starts_at'
  const ascending = sortDir === 'asc'

  return [...events].sort((a, b) => {
    let aVal = a[column as keyof EventWithVenue]
    let bVal = b[column as keyof EventWithVenue]

    // Handle null/undefined
    if (aVal == null && bVal == null) return 0
    if (aVal == null) return ascending ? -1 : 1
    if (bVal == null) return ascending ? 1 : -1

    // Compare
    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return ascending ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
    }

    if (aVal < bVal) return ascending ? -1 : 1
    if (aVal > bVal) return ascending ? 1 : -1
    return 0
  })
}

export const Route = createFileRoute('/admin/events/')({
  validateSearch: eventSearchSchema,
  loader: async () => {
    // Fetch all events and venues in parallel - client-side filtering/pagination
    const [venues, allEvents] = await Promise.all([
      listVenues(),
      listAllEventsAdmin(),
    ])
    return { venues, allEvents }
  },
  component: EventListPage,
})

/** Get button text for bulk action dialog - avoids nested ternary */
function getBulkActionButtonText(isProcessing: boolean, action: string | null): string {
  if (isProcessing) return m.common_processing()
  if (action === 'delete') return m.common_delete()
  return m.common_confirm()
}

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
  const { venues, allEvents } = Route.useLoaderData()
  const searchParams = Route.useSearch()
  const navigate = Route.useNavigate()

  // Client-side filtering, sorting, and pagination
  const activeTab: EventTab = (searchParams.tab ?? 'all') as EventTab
  const page = searchParams.page ?? 1
  const pageSize = searchParams.pageSize ?? 25

  // Compute tab counts from all events
  const tabCounts = useMemo(
    () => computeTabCounts(allEvents, searchParams.showPast ?? false),
    [allEvents, searchParams.showPast]
  )

  // Filter events based on current params
  const filteredEvents = useMemo(
    () => filterEvents(allEvents, searchParams),
    [allEvents, searchParams]
  )

  // Sort filtered events
  const sortedEvents = useMemo(
    () => sortEvents(filteredEvents, searchParams.sortBy, searchParams.sortDir),
    [filteredEvents, searchParams.sortBy, searchParams.sortDir]
  )

  // Paginate for current page
  const totalCount = sortedEvents.length
  const totalPages = Math.ceil(totalCount / pageSize)
  const events = useMemo(
    () => sortedEvents.slice((page - 1) * pageSize, page * pageSize),
    [sortedEvents, page, pageSize]
  )

  // Pagination object for DataTablePagination
  const pagination = useMemo(() => ({
    page,
    pageSize,
    totalCount,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  }), [page, pageSize, totalCount, totalPages])

  // Filter values for UI
  const filters = useMemo(() => ({
    search: searchParams.search ?? '',
    venueId: searchParams.venue,
    importedToday: searchParams.importedToday ?? false,
    showPast: searchParams.showPast ?? false,
    status: searchParams.status,
    missingDescription: searchParams.missingDescription ?? false,
    missingVenue: searchParams.missingVenue ?? false,
    sortBy: searchParams.sortBy ?? 'starts_at',
    sortOrder: (searchParams.sortDir ?? 'desc') as 'asc' | 'desc',
  }), [searchParams])

  // Check if any filters are active
  const hasActiveFilters = !!(
    searchParams.search ||
    searchParams.venue ||
    searchParams.importedToday ||
    searchParams.showPast ||
    searchParams.status ||
    searchParams.missingDescription ||
    searchParams.missingVenue ||
    searchParams.sortBy
  )

  // Navigation helpers
  const setPage = useCallback((p: number) => {
    navigate({ search: (prev) => ({ ...prev, page: p }), replace: true })
  }, [navigate])

  const setPageSize = useCallback((size: number) => {
    navigate({ search: (prev) => ({ ...prev, pageSize: size, page: 1 }), replace: true })
  }, [navigate])

  const setTab = useCallback((tab: EventTab) => {
    navigate({ search: { tab, page: 1 } })
  }, [navigate])

  const setSearch = useCallback((search: string) => {
    navigate({ search: (prev) => ({ ...prev, search: search || undefined, page: 1 }), replace: true })
  }, [navigate])

  const setVenueFilter = useCallback((venueId: string | undefined) => {
    navigate({ search: (prev) => ({ ...prev, venue: venueId, page: 1 }), replace: true })
  }, [navigate])

  const setImportedToday = useCallback((value: boolean) => {
    navigate({ search: (prev) => ({ ...prev, importedToday: value || undefined, page: 1 }), replace: true })
  }, [navigate])

  const setShowPast = useCallback((value: boolean) => {
    navigate({ search: (prev) => ({ ...prev, showPast: value || undefined, page: 1 }), replace: true })
  }, [navigate])

  const setMissingDescription = useCallback((value: boolean) => {
    navigate({ search: (prev) => ({ ...prev, missingDescription: value || undefined, page: 1 }), replace: true })
  }, [navigate])

  const setMissingVenue = useCallback((value: boolean) => {
    navigate({ search: (prev) => ({ ...prev, missingVenue: value || undefined, page: 1 }), replace: true })
  }, [navigate])

  const setSorting = useCallback((sortBy: string | undefined, sortDir: 'asc' | 'desc' | undefined) => {
    navigate({ search: (prev) => ({ ...prev, sortBy, sortDir }), replace: true })
  }, [navigate])

  const clearFilters = useCallback(() => {
    navigate({ search: { tab: activeTab, page: 1 } })
  }, [navigate, activeTab])

  // Bulk selection (operates on current page)
  const bulk = useBulkActions(events)
  const singleActions = useSingleEventActions()
  const markPast = useMarkPastEvents()

  // Venue options for filter dropdown
  const venueOptions = useMemo(() => {
    return venues.map((v) => ({
      value: v.id,
      label: v.name,
    }))
  }, [venues])

  // Local state as write buffer for debounced search input
  const [searchInput, setSearchInput] = useState(searchParams.search || '')

  // Sync local input when URL changes (e.g., browser back/forward, clear filters)
  useEffect(() => {
    setSearchInput(searchParams.search || '')
  }, [searchParams.search])

  // Debounced URL update for search
  const debouncedSearchUpdate = useMemo(
    () =>
      debounce((value: string) => {
        setSearch(value)
      }, 300),
    [setSearch]
  )

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => debouncedSearchUpdate.cancel()
  }, [debouncedSearchUpdate])

  // Handle search input change - update local state immediately, debounce URL update
  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value
      setSearchInput(value)
      debouncedSearchUpdate(value)
    },
    [debouncedSearchUpdate]
  )

  // Clear all filters
  const handleClearFilters = useCallback(() => {
    clearFilters()
    setSearchInput('')
  }, [clearFilters])

  // Derive TanStack Table state from URL params
  const columnFilters = useMemo(() => paramsToColumnFilters(searchParams), [searchParams])
  const sorting = useMemo(() => paramsToSorting(searchParams), [searchParams])

  // Update URL when column filters change
  const handleColumnFiltersChange = useCallback(
    (newFilters: ColumnFiltersState) => {
      const filterParams = columnFiltersToParams(newFilters)
      navigate({
        search: (prev) => ({
          ...prev,
          // Clear old filter params and set new ones
          name: filterParams.name,
          venue_name: filterParams.venue_name,
          source: filterParams.source,
          status: filterParams.status,
        }),
        replace: true, // Don't add to history for every keystroke
      })
    },
    [navigate]
  )

  // Update URL when sorting changes
  const handleSortingChange = useCallback(
    (newSorting: SortingState) => {
      const sortParams = sortingToParams(newSorting)
      setSorting(sortParams.sortBy, sortParams.sortDir)
    },
    [setSorting]
  )
  const backgroundEnrichment = useBackgroundEnrichment()
  const venueEnrichment = useVenueEnrichment()
  const lumaEnrichment = useLumaDescriptionEnrichment()

  // Calculate enrichable count for selected events (description enrichment)
  const enrichableCount = useMemo(() => {
    return backgroundEnrichment.getEnrichableEvents(events, bulk.selectedIds).length
  }, [backgroundEnrichment, events, bulk.selectedIds])

  // Calculate venue enrichable count for selected events
  const venueEnrichableCount = useMemo(() => {
    return venueEnrichment.getVenueEnrichableEvents(events, bulk.selectedIds).length
  }, [venueEnrichment, events, bulk.selectedIds])

  // Calculate Luma enrichable count for selected events (missing descriptions)
  const lumaEnrichableCount = useMemo(() => {
    return lumaEnrichment.getLumaEnrichableEvents(events, bulk.selectedIds).length
  }, [lumaEnrichment, events, bulk.selectedIds])

  // Handle description enrichment with selection clear on complete
  const handleEnrich = useCallback(() => {
    backgroundEnrichment.enrichEvents(
      events,
      bulk.selectedIds,
      () => bulk.clearSelection()
    )
  }, [backgroundEnrichment, events, bulk.selectedIds, bulk.clearSelection])

  // Handle venue enrichment with selection clear on complete
  const handleVenueEnrich = useCallback(() => {
    venueEnrichment.enrichVenues(
      events,
      bulk.selectedIds,
      () => bulk.clearSelection()
    )
  }, [venueEnrichment, events, bulk.selectedIds, bulk.clearSelection])

  // Handle Luma description enrichment with selection clear on complete
  const handleLumaEnrich = useCallback(() => {
    lumaEnrichment.enrichLumaEvents(
      events,
      bulk.selectedIds,
      () => bulk.clearSelection()
    )
  }, [lumaEnrichment, events, bulk.selectedIds, bulk.clearSelection])

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
    setTab(value as EventTab)
    setSearchInput('')
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

  // Edit modal handlers - local state for instant open/close
  const [editingEvent, setEditingEvent] = useState<EventWithVenue | null>(null)

  const handleEdit = useCallback((event: EventWithVenue) => {
    setEditingEvent(event)
  }, [])

  const handleCloseEdit = useCallback(() => {
    setEditingEvent(null)
  }, [])

  // Column definitions
  const columns = useMemo(
    () =>
      getEventColumns({
        onEdit: handleEdit,
        onDelete: singleActions.setDeleteTarget,
        onApprove: singleActions.handleApprove,
        onReject: singleActions.handleReject,
        isApproving: singleActions.isApproving,
        isRejecting: singleActions.isRejecting,
        showNeedsAttention: activeTab === 'needs_attention',
      }),
    [handleEdit, singleActions, activeTab]
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
            {hasActiveFilters
              ? m.admin_events_filtered({ filtered: events.length, total: events.length })
              : m.admin_events_count({ count: events.length })}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Add Event button */}
          <Button asChild variant="outline" size="lg" className="border-border/50">
            <Link to="/admin/events/new">
              <Plus className="h-4 w-4 mr-2" />
              {m.admin_add_event()}
            </Link>
          </Button>

          {/* Import button - links to unified wizard */}
          <Button asChild size="lg" className="bg-primary text-primary-foreground hover:bg-primary/90">
            <Link to="/admin/events/import">
              <FileSpreadsheet className="h-4 w-4 mr-2" />
              {m.admin_import()}
            </Link>
          </Button>
        </div>
      </div>

      <div className="deco-line w-24" />

      {/* Tabs */}
      {(tabCounts?.all ?? 0) > 0 && (
        <div className="space-y-4">
          <Tabs value={activeTab} onValueChange={handleTabChange}>
            <TabsList className="bg-card/50 border border-border/50 p-1 h-auto">
              <TabsTrigger
                value="all"
                className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary px-4 py-2"
              >
                {m.admin_tab_all()}
                <span className="ml-2 text-xs opacity-70">({tabCounts?.all ?? 0})</span>
              </TabsTrigger>
              <TabsTrigger
                value="needs_attention"
                className="data-[state=active]:bg-orange-500/20 data-[state=active]:text-orange-400 px-4 py-2"
              >
                <AlertCircle className="h-3.5 w-3.5 mr-1.5" />
                {m.admin_tab_needs_attention()}
                {(tabCounts?.needs_attention ?? 0) > 0 && (
                  <span className="ml-2 text-xs bg-orange-500/30 px-1.5 py-0.5 rounded-full">
                    {tabCounts?.needs_attention}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger
                value="pending_review"
                className="data-[state=active]:bg-yellow-500/20 data-[state=active]:text-yellow-400 px-4 py-2"
              >
                {m.admin_tab_pending()}
                {(tabCounts?.pending_review ?? 0) > 0 && (
                  <span className="ml-2 text-xs bg-yellow-500/30 px-1.5 py-0.5 rounded-full">
                    {tabCounts?.pending_review}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger
                value="past"
                className="data-[state=active]:bg-muted data-[state=active]:text-muted-foreground px-4 py-2"
              >
                {m.admin_tab_past()}
                <span className="ml-2 text-xs opacity-70">({tabCounts?.past ?? 0})</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Data quality filters - only show on needs_attention tab */}
          {activeTab === 'needs_attention' && (
            <div className="space-y-3">
              {/* Backfill Card for enriching pending records */}
              <BackfillCard />

              {/* Data gap filter checkboxes */}
              <div className="flex items-center gap-4 flex-wrap">
                <span className="text-sm text-muted-foreground">{m.admin_filter_by()}</span>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <Checkbox
                    checked={filters.missingDescription}
                    onCheckedChange={(checked) => setMissingDescription(checked === true)}
                  />
                  <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">{m.admin_missing_description()}</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <Checkbox
                    checked={filters.missingVenue}
                    onCheckedChange={(checked) => setMissingVenue(checked === true)}
                  />
                  <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">{m.admin_missing_venue()}</span>
                </label>
              </div>
            </div>
          )}

          {/* Search and Venue filter - compact row */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 max-w-sm min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={m.admin_search_events()}
                value={searchInput}
                onChange={handleSearchChange}
                className="pl-9 bg-background/50 border-border/50"
              />
            </div>
            <Combobox
              options={venueOptions}
              value={filters.venueId}
              onValueChange={setVenueFilter}
              placeholder={m.admin_all_venues()}
              emptyText={m.admin_no_venues_found()}
              className="w-48"
            />
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <Checkbox
                checked={filters.importedToday}
                onCheckedChange={(checked) => setImportedToday(checked === true)}
              />
              <span className="text-sm text-muted-foreground whitespace-nowrap">
                {m.admin_imported_today()}
              </span>
            </label>
            {/* Show past events checkbox - hidden on Past tab since it's redundant */}
            {activeTab !== 'past' && (
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <Checkbox
                  checked={filters.showPast}
                  onCheckedChange={(checked) => setShowPast(checked === true)}
                />
                <span className="text-sm text-muted-foreground whitespace-nowrap">
                  {m.admin_show_past_events()}
                </span>
              </label>
            )}
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearFilters}
                className="text-muted-foreground hover:text-foreground"
              >
                {m.common_clear()}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Content */}
      {tabCounts?.all === 0 ? (
        // No events in database at all
        <EmptyState />
      ) : tabCounts?.[activeTab] === 0 ? (
        // Tab has no events (e.g., all events reviewed)
        <TabEmptyState tab={activeTab} />
      ) : events.length === 0 ? (
        // Filters/search returned no results for this page
        <NoMatchesState onClearFilters={handleClearFilters} />
      ) : (
        <>
          {/* Mobile Card View */}
          <div className="sm:hidden">
            <BulkActionBar
              selectedCount={bulk.selectedIds.size}
              filteredEventsLength={events.length}
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
              lumaEnrichableCount={lumaEnrichableCount}
              onLumaEnrich={handleLumaEnrich}
              isLumaEnriching={lumaEnrichment.isLumaEnriching}
            />
          </div>
          <MobileEventCards
            events={events}
            selectedIds={bulk.selectedIds}
            onToggleSelect={bulk.toggleSelect}
            onEdit={handleEdit}
            onApprove={singleActions.handleApprove}
            onReject={singleActions.handleReject}
            onDelete={singleActions.setDeleteTarget}
            isApproving={singleActions.isApproving}
            isRejecting={singleActions.isRejecting}
            showNeedsAttention={activeTab === 'needs_attention'}
          />

          {/* Desktop Table View with DataTable */}
          <div className="hidden sm:block">
            <div className="relative">
              {/* Bulk action overlay - needs z-20 to be above sticky table header (z-10) */}
              <div className="absolute top-0 left-0 right-0 z-20">
                <BulkActionBar
                  selectedCount={bulk.selectedIds.size}
                  filteredEventsLength={events.length}
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
                  lumaEnrichableCount={lumaEnrichableCount}
                  onLumaEnrich={handleLumaEnrich}
                  isLumaEnriching={lumaEnrichment.isLumaEnriching}
                />
              </div>

              <DataTable
                columns={columns}
                data={events}
                tableId="admin-events"
                enableRowSelection={true}
                selectedIds={bulk.selectedIds}
                onSelectionChange={handleSelectionChange}
                enableColumnResizing={true}
                enableColumnReordering={true}
                enableColumnFiltering={true}
                columnFilters={columnFilters}
                onColumnFiltersChange={handleColumnFiltersChange}
                sorting={sorting}
                onSortingChange={handleSortingChange}
                enableMultiSort={true}
                manualPagination={true}
                pageCount={pagination.totalPages}
                paginationSlot={
                  <DataTablePagination
                    page={pagination.page}
                    pageSize={pagination.pageSize}
                    totalCount={pagination.totalCount}
                    totalPages={pagination.totalPages}
                    hasNextPage={pagination.hasNextPage}
                    hasPrevPage={pagination.hasPrevPage}
                    onPageChange={setPage}
                    onPageSizeChange={setPageSize}
                  />
                }
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
              {getBulkActionButtonText(bulk.isBulkProcessing, bulk.bulkAction)}
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

      {/* Edit event sheet - only mount when needed to avoid unnecessary renders */}
      {editingEvent && <EditEventSheet event={editingEvent} onClose={handleCloseEdit} />}
    </div>
  )
}

// Sub-components

function EmptyState() {
  return (
    <SharedEmptyState
      icon={<Calendar className="h-12 w-12 text-muted-foreground" />}
      title={m.admin_no_events()}
      description={m.admin_no_events_desc()}
      action={{
        label: m.admin_add_event(),
        href: '/admin/events/new',
        icon: <Plus className="h-4 w-4" />,
      }}
    />
  )
}

function NoMatchesState({ onClearFilters }: { onClearFilters: () => void }) {
  return (
    <SharedNoMatchesState
      title={m.admin_no_matching_events()}
      description={m.admin_no_matching_desc()}
      onClearFilters={onClearFilters}
      clearLabel={m.common_clear_filters()}
    />
  )
}

function TabEmptyState({ tab }: { tab: EventTab }) {
  const config: Record<EventTab, { icon: React.ReactNode; title: string; description: string }> = {
    all: {
      icon: <Calendar className="h-12 w-12 text-muted-foreground" />,
      title: m.admin_no_events(),
      description: m.admin_no_events_desc(),
    },
    needs_attention: {
      icon: <CheckCircle2 className="h-12 w-12 text-green-500" />,
      title: 'All events are complete!',
      description: 'No events need attention right now.',
    },
    pending_review: {
      icon: <CheckCircle2 className="h-12 w-12 text-green-500" />,
      title: 'No events pending review',
      description: 'All imported events have been reviewed.',
    },
    past: {
      icon: <Calendar className="h-12 w-12 text-muted-foreground" />,
      title: 'No past events',
      description: 'Past events will appear here after they end.',
    },
  }

  const { icon, title, description } = config[tab]

  return (
    <SharedEmptyState
      icon={icon}
      title={title}
      description={description}
    />
  )
}

interface EventListProps {
  events: EventWithVenue[]
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onEdit: (event: EventWithVenue) => void
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
  onEdit,
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
  onEdit: (event: EventWithVenue) => void
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
              variant="ghost"
              size="sm"
              className="flex-1 text-muted-foreground hover:text-foreground"
              onClick={() => onEdit(event)}
            >
              <Pencil className="h-4 w-4 mr-2" />
              {m.common_edit()}
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
  onEdit,
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
                onEdit={onEdit}
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
