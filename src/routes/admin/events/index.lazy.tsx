import { createLazyFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useRef, useEffect, useMemo, useCallback, useState } from 'react'
import { debounce } from '@/shared/lib/utils'
import { toast } from 'sonner'
import type { ColumnFiltersState, SortingState } from '@tanstack/react-table'
import {
  Plus,
  Calendar,
  MapPin,
  Search,
  FileSpreadsheet,
  AlertCircle,
  FileText,
  Link2,
  X,
} from 'lucide-react'
import * as m from '@/paraglide/messages'
import { Button } from '@/shared/ui/button'
import { Checkbox } from '@/shared/ui/checkbox'
import { Input } from '@/shared/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/shared/ui/tabs'
import { ConfirmationDialog } from '@/shared/ui/confirmation-dialog'
import { Combobox } from '@/shared/ui/combobox'
import { MobileFilterSheet } from '@/shared/ui/MobileFilterSheet'
import { useMobileSelectionMode } from '@/shared/hooks/useMobileSelectionMode'
import { DataTable } from '@/shared/ui/data-table/DataTable'
import { getEventColumns } from '@/shared/ui/data-table/columns/event-columns'
import { useBackgroundEnrichment } from '@/features/events/hooks/useBackgroundEnrichment'
import { useLumaDescriptionEnrichment } from '@/features/events/hooks/useLumaDescriptionEnrichment'
import { usePasslineDescriptionEnrichment } from '@/features/events/hooks/usePasslineDescriptionEnrichment'
import { useUnifiedDescriptionEnrichment } from '@/features/events/hooks/useUnifiedDescriptionEnrichment'
import { useBulkActions } from '@/features/events/hooks/useBulkActions'
import { useSingleEventActions } from '@/features/events/hooks/useSingleEventActions'
import { useMarkPastEvents } from '@/features/events/hooks/useMarkPastEvents'
import {
  listActiveEventsAdmin,
  listPastEventsAdmin,
  getEventTabCountsAction,
} from '@/features/events/api/crud'
import type { EventListItem } from '@/shared/lib/types'
import { queryKeys } from '@/shared/lib/query'
import { useVenueEnrichment } from '@/features/venues/hooks/useVenueEnrichment'
import { BulkActionBar } from './-components/BulkActionBar'
import { buildEnrichmentsConfig } from './-components/enrichments-config'
import { EditEventSheet } from './-components/EditEventSheet'
import { EmptyState, NoMatchesState, TabEmptyState } from './-components/EmptyStates'
import { MobileEventCards } from './-components/MobileEventCards'
import {
  filterEvents,
  sortEvents,
  paramsToColumnFilters,
  columnFiltersToParams,
  paramsToSorting,
  sortingToParams,
  getBulkActionConfig,
} from './-components/filters.tsx'

// Tab types for client-side filtering
type EventTab = 'all' | 'needs_attention' | 'pending_review' | 'past'

interface TabCounts {
  all: number
  needs_attention: number
  pending_review: number
  past: number
}

export const Route = createLazyFileRoute('/admin/events/')({
  component: EventListPage,
})

function EventListPage() {
  const { venues, activeEvents: initialActiveEvents, tabCounts: initialTabCounts } = Route.useLoaderData()
  const searchParams = Route.useSearch()
  const navigate = Route.useNavigate()

  // Client-side filtering and sorting (virtualization replaces pagination)
  const activeTab: EventTab = (searchParams.tab ?? 'all') as EventTab

  // React Query for active events - initialData from loader for instant render
  const { data: activeEvents = [] } = useQuery({
    queryKey: queryKeys.events.adminList(),
    queryFn: listActiveEventsAdmin,
    initialData: initialActiveEvents,
    staleTime: 30_000,
  })

  // React Query for tab counts - initialData from loader for instant render
  const { data: serverTabCounts } = useQuery({
    queryKey: queryKeys.events.tabCounts({}),
    queryFn: () => getEventTabCountsAction({ data: {} }),
    initialData: initialTabCounts,
    staleTime: 30_000,
  })

  // Lazy-loaded past events via React Query (only fetched when Past tab is active)
  const { data: pastEvents, isLoading: isPastLoading } = useQuery({
    queryKey: queryKeys.events.adminPastList(),
    queryFn: listPastEventsAdmin,
    enabled: activeTab === 'past',
    staleTime: 60_000,
  })

  // Derive allEvents based on current tab
  // For non-past tabs, use activeEvents; for past tab, use pastEvents (or empty while loading)
  const allEvents = useMemo(() => {
    if (activeTab === 'past') {
      return pastEvents ?? []
    }
    return activeEvents
  }, [activeTab, activeEvents, pastEvents])

  // Default serverTabCounts if undefined
  const safeServerTabCounts = serverTabCounts ?? initialTabCounts

  // Use server-provided tab counts, but override past count if we've loaded past events
  const tabCounts = useMemo((): TabCounts => ({
    ...safeServerTabCounts,
    // If past events have been loaded, use actual count for accuracy
    past: pastEvents ? pastEvents.length : safeServerTabCounts.past,
  }), [safeServerTabCounts, pastEvents])

  // Calculate filter counts for needs_attention tab (from active events only, excluding past/canceled)
  const filterCounts = useMemo(() => {
    // Count from active events only (exclude past and canceled)
    const eventsToCount = activeEvents.filter(e => e.status !== 'past' && e.status !== 'canceled')

    return {
      missingDescription: eventsToCount.filter(e => !e.has_description_es && !!e.link).length,
      // Exclude events marked as TBA (intentionally without venue)
      missingVenue: eventsToCount.filter(e => !e.venue_id && !e.location_tba).length,
      missingLink: eventsToCount.filter(e => !e.link).length,
    }
  }, [activeEvents])

  // Filter events based on current params
  const filteredEvents = useMemo(
    () => filterEvents(allEvents, searchParams),
    [allEvents, searchParams]
  )

  // Sort filtered events (virtualization renders all, no pagination needed)
  const sortedEvents = useMemo(
    () => sortEvents(filteredEvents, searchParams.sortBy, searchParams.sortDir),
    [filteredEvents, searchParams.sortBy, searchParams.sortDir]
  )

  // Use sortedEvents directly for virtualized table (no pagination slicing)
  const events = sortedEvents

  // Filter values for UI
  const filters = useMemo(() => ({
    search: searchParams.search ?? '',
    venueId: searchParams.venue,
    importedToday: searchParams.importedToday ?? false,
    showPast: searchParams.showPast ?? false,
    status: searchParams.status,
    missingDescription: searchParams.missingDescription ?? false,
    missingVenue: searchParams.missingVenue ?? false,
    missingLink: searchParams.missingLink ?? false,
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
    searchParams.missingLink ||
    searchParams.sortBy
  )

  // Navigation helpers
  const setTab = useCallback((tab: EventTab) => {
    navigate({ search: { tab } })
  }, [navigate])

  const setSearch = useCallback((search: string) => {
    navigate({ search: (prev) => ({ ...prev, search: search || undefined }), replace: true })
  }, [navigate])

  const setVenueFilter = useCallback((venueId: string | undefined) => {
    navigate({ search: (prev) => ({ ...prev, venue: venueId }), replace: true })
  }, [navigate])

  const setImportedToday = useCallback((value: boolean) => {
    navigate({ search: (prev) => ({ ...prev, importedToday: value || undefined }), replace: true })
  }, [navigate])

  const setShowPast = useCallback((value: boolean) => {
    navigate({ search: (prev) => ({ ...prev, showPast: value || undefined }), replace: true })
  }, [navigate])

  const setMissingDescription = useCallback((value: boolean) => {
    navigate({ search: (prev) => ({ ...prev, missingDescription: value || undefined }), replace: true })
  }, [navigate])

  const setMissingVenue = useCallback((value: boolean) => {
    navigate({ search: (prev) => ({ ...prev, missingVenue: value || undefined }), replace: true })
  }, [navigate])

  const setMissingLink = useCallback((value: boolean) => {
    navigate({ search: (prev) => ({ ...prev, missingLink: value || undefined }), replace: true })
  }, [navigate])

  const setSorting = useCallback((sortBy: string | undefined, sortDir: 'asc' | 'desc' | undefined) => {
    navigate({ search: (prev) => ({ ...prev, sortBy, sortDir }), replace: true })
  }, [navigate])

  const clearFilters = useCallback(() => {
    navigate({ search: { tab: activeTab } })
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
  // Individual enrichment hooks (orchestrated by unified hook)
  const backgroundEnrichment = useBackgroundEnrichment()
  const passlineEnrichment = usePasslineDescriptionEnrichment()
  const lumaEnrichment = useLumaDescriptionEnrichment()
  const venueEnrichment = useVenueEnrichment()

  // Unified description enrichment - automatically routes to correct method based on source
  const unifiedEnrichment = useUnifiedDescriptionEnrichment(
    backgroundEnrichment,
    passlineEnrichment,
    lumaEnrichment
  )

  // Calculate unified enrichable count for selected events (all sources)
  const enrichableCount = useMemo(() => {
    return unifiedEnrichment.getEnrichableCount(events, bulk.selectedIds)
  }, [unifiedEnrichment, events, bulk.selectedIds])

  // Calculate venue enrichable count for selected events
  const venueEnrichableCount = useMemo(() => {
    return venueEnrichment.getVenueEnrichableEvents(events, bulk.selectedIds).length
  }, [venueEnrichment, events, bulk.selectedIds])

  // Handle unified description enrichment with selection clear on complete
  const handleEnrich = useCallback(() => {
    unifiedEnrichment.enrichDescriptions(
      events,
      bulk.selectedIds,
      () => bulk.clearSelection()
    )
  }, [unifiedEnrichment, events, bulk.selectedIds, bulk.clearSelection])

  // Handle venue enrichment with selection clear on complete
  const handleVenueEnrich = useCallback(() => {
    venueEnrichment.enrichVenues(
      events,
      bulk.selectedIds,
      () => bulk.clearSelection()
    )
  }, [venueEnrichment, events, bulk.selectedIds, bulk.clearSelection])

  // Build enrichments config array for BulkActionBar
  const enrichments = useMemo(
    () => buildEnrichmentsConfig({
      descriptionCount: enrichableCount,
      onDescriptionEnrich: handleEnrich,
      descriptionEnrichment: {
        isEnriching: unifiedEnrichment.isEnriching,
        stopEnrichment: unifiedEnrichment.stop,
      },
      venueCount: venueEnrichableCount,
      onVenueEnrich: handleVenueEnrich,
      venueEnrichment: {
        isVenueEnriching: venueEnrichment.isVenueEnriching,
      },
    }),
    [
      enrichableCount,
      handleEnrich,
      unifiedEnrichment.isEnriching,
      unifiedEnrichment.stop,
      venueEnrichableCount,
      handleVenueEnrich,
      venueEnrichment.isVenueEnriching,
    ]
  )

  // Track if we've shown the toast to prevent re-showing
  const hasShownPastToastRef = useRef(false)

  // Smart "Mark Past" toast on page load - show once when count becomes available
  useEffect(() => {
    if (hasShownPastToastRef.current) return
    if (markPast.pastEventsCount > 0) {
      hasShownPastToastRef.current = true
      toast.info(m.admin_events_ended_toast({ count: markPast.pastEventsCount }), {
        description: m.admin_events_ended_desc(),
        action: {
          label: m.admin_mark_past_dialog(),
          onClick: () => markPast.handleMarkPastEvents(),
        },
        duration: 10000,
      })
    }
  }, [markPast.pastEventsCount, markPast.handleMarkPastEvents])

  const handleTabChange = (value: string) => {
    const tab = value as EventTab
    // React Query handles lazy loading of past events automatically via enabled: activeTab === 'past'
    setTab(tab)
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

  // Edit modal handlers - store just ID and name for the sheet
  const [editingEventId, setEditingEventId] = useState<string | null>(null)
  const [editingEventName, setEditingEventName] = useState<string>('')

  // Mobile selection mode (triggered by long press)
  const mobileSelection = useMobileSelectionMode({
    items: events,
    externalSelection: bulk,
  })

  const handleEdit = useCallback((event: EventListItem) => {
    setEditingEventId(event.id)
    setEditingEventName(event.name)
  }, [])

  const handleCloseEdit = useCallback(() => {
    setEditingEventId(null)
    setEditingEventName('')
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
    <div className="w-full max-w-6xl mx-auto h-full overflow-auto flex flex-col gap-4 sm:gap-6 p-4 sm:p-6 animate-fade-in-up">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground flex items-center gap-2">
            <Calendar className="h-6 w-6 text-primary" />
            {m.admin_events_title()}
          </h1>
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
            {/* Horizontally scrollable on mobile */}
            <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
              <TabsList className="bg-card/50 border border-border/50 p-1 h-auto inline-flex w-auto min-w-full sm:min-w-0">
              <TabsTrigger
                value="all"
                className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary px-4 py-2"
              >
                {m.admin_tab_active()}
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
            </div>
          </Tabs>

          {/* Data quality filters - only show on needs_attention tab */}
          {activeTab === 'needs_attention' && (
            <div className="flex items-center gap-4 flex-wrap">
              <span className="text-sm text-muted-foreground">{m.admin_filter_by()}</span>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <Checkbox
                  checked={filters.missingDescription}
                  onCheckedChange={(checked) => setMissingDescription(checked === true)}
                />
                <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  {m.admin_missing_description()} ({filterCounts.missingDescription})
                </span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <Checkbox
                  checked={filters.missingVenue}
                  onCheckedChange={(checked) => setMissingVenue(checked === true)}
                />
                <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  {m.admin_missing_venue()} ({filterCounts.missingVenue})
                </span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <Checkbox
                  checked={filters.missingLink}
                  onCheckedChange={(checked) => setMissingLink(checked === true)}
                />
                <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  {m.admin_missing_link()} ({filterCounts.missingLink})
                </span>
              </label>
            </div>
          )}

          {/* Search and Filters */}
          <div className="flex items-center gap-3">
            {/* Search - always visible */}
            <div className="relative flex-1 min-w-0 sm:max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={m.admin_search_events()}
                value={searchInput}
                onChange={handleSearchChange}
                className="pl-9 bg-background/50 border-border/50"
              />
            </div>

            {/* Mobile: Filter button that opens sheet */}
            <div className="sm:hidden">
              <MobileFilterSheet
                hasActiveFilters={hasActiveFilters}
                onClearFilters={handleClearFilters}
                title={m.admin_filter_by()}
              >
                {/* Venue filter */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">{m.admin_all_venues()}</label>
                  <Combobox
                    options={venueOptions}
                    value={filters.venueId}
                    onValueChange={setVenueFilter}
                    placeholder={m.admin_all_venues()}
                    emptyText={m.admin_no_venues_found()}
                    className="w-full"
                  />
                </div>

                {/* Quick filters */}
                <label className="flex items-center gap-3 cursor-pointer select-none p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
                  <Checkbox
                    checked={filters.importedToday}
                    onCheckedChange={(checked) => setImportedToday(checked === true)}
                  />
                  <span className="text-sm">{m.admin_imported_today()}</span>
                </label>
                {activeTab !== 'past' && (
                  <label className="flex items-center gap-3 cursor-pointer select-none p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
                    <Checkbox
                      checked={filters.showPast}
                      onCheckedChange={(checked) => setShowPast(checked === true)}
                    />
                    <span className="text-sm">{m.admin_show_past_events()}</span>
                  </label>
                )}
              </MobileFilterSheet>
            </div>

            {/* Desktop: Inline filters */}
            <div className="hidden sm:flex items-center gap-3 flex-wrap">
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
        </div>
      )}

      {/* Content - flex-1 to fill remaining space when showing table */}
      <div className="flex-1 min-h-0 flex flex-col">
        {tabCounts?.all === 0 ? (
          // No events in database at all
          <EmptyState />
        ) : isPastLoading && activeTab === 'past' ? (
          // Loading past events
          <div className="flex items-center justify-center py-16">
            <div className="text-center space-y-3">
              <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full mx-auto" />
              <p className="text-muted-foreground">Loading past events...</p>
            </div>
          </div>
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
              {/* Selection mode header */}
              {mobileSelection.isSelectionMode && (
                <div className="flex items-center justify-between p-3 mb-2 bg-primary/10 border border-primary/20 rounded-xl">
                  <div className="flex items-center gap-3">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={mobileSelection.exitSelectionMode}
                      className="h-8 w-8"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                    <span className="text-sm font-medium">
                      {bulk.selectedIds.size} selected
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={bulk.toggleSelectAll}
                    className="text-primary"
                  >
                    {bulk.selectedIds.size === events.length ? 'Deselect all' : 'Select all'}
                  </Button>
                </div>
              )}
              {/* Bulk action bar - only show when items are selected */}
              {bulk.selectedIds.size > 0 && (
                <BulkActionBar
                  selectedCount={bulk.selectedIds.size}
                  filteredEventsLength={events.length}
                  onToggleSelectAll={bulk.toggleSelectAll}
                  onSetBulkAction={bulk.setBulkAction}
                  onClearSelection={mobileSelection.exitSelectionMode}
                  enrichments={enrichments}
                />
              )}
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
              selectionMode={mobileSelection.isSelectionMode}
              onEnterSelectionMode={mobileSelection.enterSelectionMode}
            />

            {/* Desktop Table View with DataTable */}
            <div className="hidden sm:block flex-1 min-h-0 overflow-x-auto">
              <div className="relative min-w-[800px]">
                {/* Bulk action overlay - needs z-20 to be above sticky table header (z-10) */}
                <div className="absolute top-0 left-0 right-0 z-20">
                  <BulkActionBar
                    selectedCount={bulk.selectedIds.size}
                    filteredEventsLength={events.length}
                    onToggleSelectAll={bulk.toggleSelectAll}
                    onSetBulkAction={bulk.setBulkAction}
                    onClearSelection={bulk.clearSelection}
                    overlay
                    enrichments={enrichments}
                  />
                </div>

                <div className="h-full">
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
                    enableVirtualization={true}
                    enablePagination={false}
                    containerHeight="100%"
                  />
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Delete confirmation dialog */}
      <ConfirmationDialog
        open={!!singleActions.deleteTarget}
        onOpenChange={() => singleActions.setDeleteTarget(null)}
        title={m.admin_delete_event()}
        description={m.admin_delete_event_confirm({ name: singleActions.deleteTarget?.name || '' })}
        variant="destructive"
        confirmText={m.common_delete()}
        confirmingText={m.common_deleting()}
        onConfirm={singleActions.handleDelete}
        isConfirming={singleActions.isDeleting}
      />

      {/* Bulk action confirmation dialog */}
      {(() => {
        const config = getBulkActionConfig(bulk.bulkAction, bulk.selectedIds.size)
        return config ? (
          <ConfirmationDialog
            open={!!bulk.bulkAction}
            onOpenChange={() => bulk.setBulkAction(null)}
            title={config.title}
            description={config.description}
            variant={config.variant}
            confirmText={config.confirmText}
            confirmingText={config.confirmingText}
            onConfirm={bulk.handleBulkAction}
            isConfirming={bulk.isBulkProcessing}
          />
        ) : null
      })()}

      {/* Mark past events dialog - kept for manual triggering if needed */}
      <ConfirmationDialog
        open={markPast.showMarkPastDialog}
        onOpenChange={markPast.setShowMarkPastDialog}
        title={m.admin_mark_past_dialog()}
        description={
          markPast.pastEventsCount === 0
            ? m.admin_no_past_events()
            : m.admin_found_past_events({ count: markPast.pastEventsCount })
        }
        confirmText={m.admin_mark_count_past({ count: markPast.pastEventsCount })}
        confirmingText={m.admin_marking()}
        onConfirm={markPast.handleMarkPastEvents}
        isConfirming={markPast.isMarkingPast}
        confirmDisabled={markPast.pastEventsCount === 0}
      />

      {/* Edit event sheet - fetches full event data by ID */}
      <EditEventSheet eventId={editingEventId} eventName={editingEventName} onClose={handleCloseEdit} />
    </div>
  )
}
