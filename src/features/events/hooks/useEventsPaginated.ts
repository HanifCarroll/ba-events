/**
 * Hook for server-side paginated event fetching with prefetching
 *
 * Uses React Query with keepPreviousData for smooth page transitions
 * and automatic next-page prefetching for instant navigation.
 */

import { useEffect, useMemo, useCallback } from 'react'
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { queryKeys } from '@/shared/lib/query'
import { listEventsPaginated, getEventTabCountsAction } from '../api/crud'
import type {
  EventListParams,
  EventFilterParams,
  PaginatedResponse,
  EventTabCounts,
  EventSearchParams,
  EventTab,
} from '@/shared/lib/types/pagination'
import type { EventWithVenue } from '@/shared/lib/types'

// Re-export for convenience
export type { EventSearchParams, EventTab }

/** Type for the navigate function's search updater */
type SearchUpdater = (prev: EventSearchParams) => Partial<EventSearchParams>

export interface UseEventsPaginatedOptions {
  searchParams: EventSearchParams
  navigate: (opts: { search: Partial<EventSearchParams> | SearchUpdater; replace?: boolean }) => void
}

export interface UseEventsPaginatedReturn {
  // Data
  events: EventWithVenue[]
  pagination: PaginatedResponse<EventWithVenue>['pagination'] | null
  tabCounts: EventTabCounts | null

  // Loading states
  isLoading: boolean
  isFetching: boolean
  isTabCountsLoading: boolean

  // Derived state
  activeTab: EventTab
  hasActiveFilters: boolean

  // Filter values (from URL)
  filters: {
    search: string
    venueId: string | undefined
    importedToday: boolean
    status: string | undefined
    missingDescription: boolean
    missingVenue: boolean
    missingCategories: boolean
    sortBy: string
    sortOrder: 'asc' | 'desc'
  }

  // Navigation helpers
  setPage: (page: number) => void
  setPageSize: (pageSize: number) => void
  setTab: (tab: EventTab) => void
  setSearch: (search: string) => void
  setVenueFilter: (venueId: string | undefined) => void
  setImportedToday: (value: boolean) => void
  setMissingDescription: (value: boolean) => void
  setMissingVenue: (value: boolean) => void
  setMissingCategories: (value: boolean) => void
  setSorting: (sortBy: string | undefined, sortDir: 'asc' | 'desc' | undefined) => void
  clearFilters: () => void
}

/**
 * Convert URL search params to API params
 */
function searchParamsToApiParams(searchParams: EventSearchParams): EventListParams {
  return {
    page: searchParams.page ?? 1,
    pageSize: searchParams.pageSize ?? 25,
    tab: searchParams.tab ?? 'all',
    search: searchParams.search,
    venueId: searchParams.venue,
    status: searchParams.status,
    importedToday: searchParams.importedToday,
    missingDescription: searchParams.missingDescription,
    missingVenue: searchParams.missingVenue,
    missingCategories: searchParams.missingCategories,
    sortBy: searchParams.sortBy ?? 'starts_at',
    sortOrder: searchParams.sortDir ?? 'desc',
  }
}

/**
 * Extract filter params for tab counts (excludes pagination and tab)
 */
function getFilterParams(searchParams: EventSearchParams): Omit<EventFilterParams, 'tab'> {
  return {
    search: searchParams.search,
    venueId: searchParams.venue,
    status: searchParams.status,
    importedToday: searchParams.importedToday,
    missingDescription: searchParams.missingDescription,
    missingVenue: searchParams.missingVenue,
    missingCategories: searchParams.missingCategories,
    sortBy: searchParams.sortBy,
    sortOrder: searchParams.sortDir,
  }
}

export function useEventsPaginated({
  searchParams,
  navigate,
}: UseEventsPaginatedOptions): UseEventsPaginatedReturn {
  const queryClient = useQueryClient()

  // Convert URL params to API params
  const apiParams = useMemo(() => searchParamsToApiParams(searchParams), [searchParams])
  const filterParams = useMemo(() => getFilterParams(searchParams), [searchParams])

  // Main paginated events query
  const eventsQuery = useQuery({
    queryKey: queryKeys.events.listPaginated(apiParams),
    queryFn: () => listEventsPaginated({ data: apiParams }),
    placeholderData: keepPreviousData, // Show previous data while loading new page
    staleTime: 30_000, // 30 seconds
  })

  // Tab counts query (separate, longer staleTime since counts change less often)
  const tabCountsQuery = useQuery({
    queryKey: queryKeys.events.tabCounts(filterParams),
    queryFn: () => getEventTabCountsAction({ data: filterParams }),
    staleTime: 60_000, // 1 minute - counts don't change as often
  })

  // Prefetch adjacent pages for instant navigation
  useEffect(() => {
    const pagination = eventsQuery.data?.pagination

    // Prefetch next page if available
    if (pagination?.hasNextPage) {
      const nextPageParams = { ...apiParams, page: apiParams.page + 1 }
      queryClient.prefetchQuery({
        queryKey: queryKeys.events.listPaginated(nextPageParams),
        queryFn: () => listEventsPaginated({ data: nextPageParams }),
        staleTime: 30_000,
      })
    }

    // Prefetch previous page if not on page 1
    if (apiParams.page > 1) {
      const prevPageParams = { ...apiParams, page: apiParams.page - 1 }
      queryClient.prefetchQuery({
        queryKey: queryKeys.events.listPaginated(prevPageParams),
        queryFn: () => listEventsPaginated({ data: prevPageParams }),
        staleTime: 30_000,
      })
    }
  }, [queryClient, apiParams, eventsQuery.data?.pagination])

  // Navigation helpers
  const setPage = useCallback(
    (page: number) => {
      navigate({
        search: (prev) => ({ ...prev, page }),
        replace: false, // Add to history for back button
      })
    },
    [navigate]
  )

  const setPageSize = useCallback(
    (pageSize: number) => {
      navigate({
        search: (prev) => ({ ...prev, pageSize, page: 1 }), // Reset to page 1 when changing size
        replace: true,
      })
    },
    [navigate]
  )

  const setTab = useCallback(
    (tab: EventTab) => {
      // Clear all filters when switching tabs
      navigate({
        search: { tab, page: 1 },
      })
    },
    [navigate]
  )

  const setSearch = useCallback(
    (search: string) => {
      navigate({
        search: (prev) => ({ ...prev, search: search || undefined, page: 1 }),
        replace: true,
      })
    },
    [navigate]
  )

  const setVenueFilter = useCallback(
    (venueId: string | undefined) => {
      navigate({
        search: (prev) => ({ ...prev, venue: venueId, page: 1 }),
        replace: true,
      })
    },
    [navigate]
  )

  // Factory for boolean filter setters - reduces repetition
  const createBooleanFilterSetter = useCallback(
    (key: keyof EventSearchParams) => (value: boolean) => {
      navigate({
        search: (prev) => ({ ...prev, [key]: value || undefined, page: 1 }),
        replace: true,
      })
    },
    [navigate]
  )

  const setImportedToday = useMemo(() => createBooleanFilterSetter('importedToday'), [createBooleanFilterSetter])
  const setMissingDescription = useMemo(() => createBooleanFilterSetter('missingDescription'), [createBooleanFilterSetter])
  const setMissingVenue = useMemo(() => createBooleanFilterSetter('missingVenue'), [createBooleanFilterSetter])
  const setMissingCategories = useMemo(() => createBooleanFilterSetter('missingCategories'), [createBooleanFilterSetter])

  const setSorting = useCallback(
    (sortBy: string | undefined, sortDir: 'asc' | 'desc' | undefined) => {
      navigate({
        search: (prev) => ({ ...prev, sortBy, sortDir }),
        replace: true,
      })
    },
    [navigate]
  )

  const clearFilters = useCallback(() => {
    navigate({
      search: {
        tab: searchParams.tab ?? 'all',
        page: 1,
      },
    })
  }, [navigate, searchParams.tab])

  // Check if any filters are active
  const hasActiveFilters = !!(
    searchParams.search ||
    searchParams.venue ||
    searchParams.importedToday ||
    searchParams.status ||
    searchParams.missingDescription ||
    searchParams.missingVenue ||
    searchParams.missingCategories ||
    searchParams.sortBy
  )

  return {
    // Data
    events: eventsQuery.data?.data ?? [],
    pagination: eventsQuery.data?.pagination ?? null,
    tabCounts: tabCountsQuery.data ?? null,

    // Loading states
    isLoading: eventsQuery.isLoading,
    isFetching: eventsQuery.isFetching,
    isTabCountsLoading: tabCountsQuery.isLoading,

    // Derived state
    activeTab: searchParams.tab ?? 'all',
    hasActiveFilters,

    // Filter values
    filters: {
      search: searchParams.search ?? '',
      venueId: searchParams.venue,
      importedToday: searchParams.importedToday ?? false,
      status: searchParams.status,
      missingDescription: searchParams.missingDescription ?? false,
      missingVenue: searchParams.missingVenue ?? false,
      missingCategories: searchParams.missingCategories ?? false,
      sortBy: searchParams.sortBy ?? 'starts_at',
      sortOrder: searchParams.sortDir ?? 'desc',
    },

    // Navigation helpers
    setPage,
    setPageSize,
    setTab,
    setSearch,
    setVenueFilter,
    setImportedToday,
    setMissingDescription,
    setMissingVenue,
    setMissingCategories,
    setSorting,
    clearFilters,
  }
}
