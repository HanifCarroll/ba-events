import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
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
  Link2,
  X,
} from 'lucide-react'
import * as m from '@/paraglide/messages'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { Checkbox } from '@/shared/ui/checkbox'
import { Input } from '@/shared/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/shared/ui/tabs'
import { ConfirmationDialog } from '@/shared/ui/confirmation-dialog'
import { Combobox } from '@/shared/ui/combobox'
import { SwipeableCard } from '@/shared/ui/SwipeableCard'
import { MobileFilterSheet } from '@/shared/ui/MobileFilterSheet'
import { useMobileSelectionMode } from '@/shared/hooks/useMobileSelectionMode'
import { DataTable, getEventColumns } from '@/shared/ui/data-table'
import { EmptyState as SharedEmptyState, NoMatchesState as SharedNoMatchesState } from '@/shared/ui/EmptyState'
import {
  useBackgroundEnrichment,
  useLumaDescriptionEnrichment,
  usePasslineDescriptionEnrichment,
  useUnifiedDescriptionEnrichment,
  useBulkActions,
  useSingleEventActions,
  useMarkPastEvents,
  listActiveEventsAdmin,
  listPastEventsAdmin,
  getEventTabCountsAction,
  type EventListItem,
} from '@/features/events'
// EventTabCounts type is compatible with local TabCounts interface
import { listVenues } from '@/features/venues'
import { formatDateTime } from '@/shared/lib/utils/formatting'
import { queryKeys } from '@/shared/lib/query'
import { useVenueEnrichment } from '@/features/venues'
import { BulkActionBar } from './-components/BulkActionBar'
import { buildEnrichmentsConfig } from './-components/enrichments-config'
import { EditEventSheet } from './-components/EditEventSheet'
import type { EventSearchParams } from '@/shared/lib/types/pagination'

import { z } from 'zod'
import type { ColumnFiltersState, SortingState } from '@tanstack/react-table'

// Tab types for client-side filtering
type EventTab = 'all' | 'needs_attention' | 'pending_review' | 'past'

// Schema for URL search params - single source of truth for all filter state
const eventSearchSchema = z.object({
  // Tab filter
  tab: z.enum(['all', 'needs_attention', 'pending_review', 'past']).optional().catch('all'),
  // Quick filters (moved from React state to URL)
  search: z.string().optional(),
  venue: z.string().optional(), // venue ID filter
  importedToday: z.boolean().optional(), // Filter for recently imported events
  // View preferences
  showPast: z.boolean().optional().catch(false), // Default: false (hide past events)
  // Data gap filters (for needs_attention tab) - server-side
  missingDescription: z.boolean().optional(),
  missingVenue: z.boolean().optional(),
  missingLink: z.boolean().optional(),
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

/** Check if event needs attention (missing description with link OR missing venue OR missing link) */
function eventNeedsAttention(event: EventListItem): boolean {
  const missingDescriptionWithLink = !event.has_description_es && !!event.link
  // Events marked as "venue TBA" are intentionally without venue, not missing one
  const missingVenue = !event.venue_id && !event.location_tba
  const missingLink = !event.link
  return missingDescriptionWithLink || missingVenue || missingLink
}

// Note: Tab counts are now fetched from the server via getEventTabCountsAction
// instead of being computed client-side for better performance

/** Filter events based on tab and search params */
function filterEvents(events: EventListItem[], params: EventSearchParams): EventListItem[] {
  const tab = params.tab ?? 'all'
  const showPast = params.showPast ?? false

  return events.filter((event) => {
    // Tab filtering
    switch (tab) {
      case 'needs_attention':
        if (event.status === 'past' || event.status === 'cancelled') return false
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
      if (event.has_description_es || !event.link) return false
    }
    if (params.missingVenue) {
      // Exclude events with venue OR marked as TBA (intentionally without venue)
      if (event.venue_id || event.location_tba) return false
    }
    if (params.missingLink) {
      if (event.link) return false
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
function sortEvents(events: EventListItem[], sortBy?: string, sortDir?: 'asc' | 'desc'): EventListItem[] {
  const column = sortBy ?? 'starts_at'
  const ascending = sortDir === 'asc'

  return [...events].sort((a, b) => {
    let aVal = a[column as keyof EventListItem]
    let bVal = b[column as keyof EventListItem]

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
    // Fetch active events, venues, and tab counts in parallel
    // Past events are lazy-loaded when user clicks the "Past" tab
    const [venues, activeEvents, tabCounts] = await Promise.all([
      listVenues(),
      listActiveEventsAdmin(),
      getEventTabCountsAction({ data: {} }),
    ])
    return { venues, activeEvents, tabCounts }
  },
  component: EventListPage,
})

/** Get dialog config for bulk actions */
function getBulkActionConfig(action: string | null, count: number) {
  const configs: Record<string, {
    title: string
    description: string
    confirmText: string
    confirmingText: string
    variant: 'default' | 'destructive'
  }> = {
    delete: {
      title: m.admin_delete_events(),
      description: m.admin_delete_events_confirm({ count }),
      confirmText: m.common_delete(),
      confirmingText: m.common_deleting(),
      variant: 'destructive',
    },
    past: {
      title: m.admin_mark_past(),
      description: m.admin_mark_past_confirm({ count }),
      confirmText: m.common_confirm(),
      confirmingText: m.common_processing(),
      variant: 'default',
    },
    cancelled: {
      title: m.admin_mark_cancelled(),
      description: m.admin_mark_cancelled_confirm({ count }),
      confirmText: m.common_confirm(),
      confirmingText: m.common_processing(),
      variant: 'default',
    },
    location_tba: {
      title: m.admin_mark_venue_tba(),
      description: m.admin_mark_venue_tba_confirm({ count }),
      confirmText: m.common_confirm(),
      confirmingText: m.common_processing(),
      variant: 'default',
    },
  }
  return action ? configs[action] : null
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

  // Calculate filter counts for needs_attention tab (from active events only, excluding past/cancelled)
  const filterCounts = useMemo(() => {
    // Count from active events only (exclude past and cancelled)
    const eventsToCount = activeEvents.filter(e => e.status !== 'past' && e.status !== 'cancelled')

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
  events: EventListItem[]
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onEdit: (event: EventListItem) => void
  onApprove: (id: string) => void
  onReject: (id: string) => void
  onDelete: (event: EventListItem) => void
  isApproving: string | null
  isRejecting: string | null
  showNeedsAttention?: boolean
  selectionMode?: boolean
  onEnterSelectionMode?: () => void
}

// Memoized mobile card component with swipe actions
const MobileEventCard = memo(function MobileEventCard({
  event,
  isSelected,
  onToggleSelect,
  onEdit,
  onApprove,
  onReject,
  onDelete,
  isApproving: _isApproving,
  isRejecting: _isRejecting,
  showNeedsAttention,
  selectionMode,
  onEnterSelectionMode,
}: {
  event: EventListItem
  isSelected: boolean
  onToggleSelect: (id: string) => void
  onEdit: (event: EventListItem) => void
  onApprove: (id: string) => void
  onReject: (id: string) => void
  onDelete: (event: EventListItem) => void
  isApproving: string | null
  isRejecting: string | null
  showNeedsAttention?: boolean
  selectionMode: boolean
  onEnterSelectionMode: () => void
}) {
  const needsDescription = !event.has_description_es && event.link

  // Swipe actions based on event status
  const leftActions = event.status === 'pending_review'
    ? [
        {
          icon: <CheckCircle2 className="h-5 w-5" />,
          label: m.admin_approve(),
          onClick: () => onApprove(event.id),
          variant: 'primary' as const,
        },
      ]
    : [
        {
          icon: <Pencil className="h-5 w-5" />,
          label: m.common_edit(),
          onClick: () => onEdit(event),
          variant: 'primary' as const,
        },
      ]

  const rightActions = event.status === 'pending_review'
    ? [
        {
          icon: <XCircle className="h-5 w-5" />,
          label: m.admin_reject(),
          onClick: () => onReject(event.id),
          variant: 'destructive' as const,
        },
      ]
    : [
        {
          icon: <Trash2 className="h-5 w-5" />,
          label: m.common_delete(),
          onClick: () => onDelete(event),
          variant: 'destructive' as const,
        },
      ]

  const handleLongPress = useCallback(() => {
    onEnterSelectionMode()
    onToggleSelect(event.id)
  }, [onEnterSelectionMode, onToggleSelect, event.id])

  const handleCardClick = useCallback(() => {
    if (selectionMode) {
      onToggleSelect(event.id)
    }
  }, [selectionMode, onToggleSelect, event.id])

  const cardContent = (
    <div
      className={`bg-card/50 rounded-xl border border-border/50 p-4 space-y-2 transition-colors ${
        isSelected ? 'border-primary/50 bg-primary/5' : ''
      }`}
      onClick={handleCardClick}
    >
      {/* Header with title and status */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          {/* Checkbox only in selection mode */}
          {selectionMode && (
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => onToggleSelect(event.id)}
              className="mt-0.5 shrink-0"
              onClick={(e) => e.stopPropagation()}
            />
          )}
          <div className="flex-1 min-w-0">
            {/* Allow 2 lines for title */}
            <p className="font-medium text-foreground line-clamp-2 leading-tight">{event.name}</p>
            <div className="flex flex-wrap gap-1 mt-1.5">
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

      {/* Event details */}
      <div className="flex items-center gap-4 text-sm text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <Calendar className="h-3.5 w-3.5 shrink-0" />
          <span>{formatDateTime(event.starts_at)}</span>
        </div>
        {event.venue_name && (
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{event.venue_name}</span>
          </div>
        )}
      </div>
    </div>
  )

  // In selection mode, don't wrap with swipeable (prevents accidental actions)
  if (selectionMode) {
    return cardContent
  }

  return (
    <SwipeableCard
      leftActions={leftActions}
      rightActions={rightActions}
      onLongPress={handleLongPress}
      className="rounded-xl"
    >
      {cardContent}
    </SwipeableCard>
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
  selectionMode = false,
  onEnterSelectionMode = () => {},
}: EventListProps) {
  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: events.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 120, // Reduced from 180 since we removed action buttons
    overscan: 5,
  })

  return (
    <div
      ref={parentRef}
      className="sm:hidden h-[calc(100vh-340px)] overflow-auto"
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
                selectionMode={selectionMode}
                onEnterSelectionMode={onEnterSelectionMode}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
