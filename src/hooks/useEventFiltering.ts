import { useState, useMemo, useCallback } from 'react'
import type { EventWithVenue, EventStatus } from '@/lib/types'
import type { EventSearchParams } from '@/routes/admin/events/index'

export type EventTab = 'all' | 'needs_attention' | 'pending_review' | 'past'

export type DataGapType = 'all' | 'missing_description' | 'missing_venue' | 'missing_categories'

export type CompletenessFilter = 'incomplete' | 'complete'

export interface VenueOption {
  value: string
  label: string
}

export interface DataGapCounts {
  all: number
  complete: number
  missing_description: number
  missing_venue: number
  missing_categories: number
}

export interface TabCounts {
  all: number
  needs_attention: number
  pending_review: number
  past: number
}

// Type for the navigate function's search updater
type SearchUpdater = (prev: EventSearchParams) => Partial<EventSearchParams>

export interface UseEventFilteringOptions {
  events: EventWithVenue[]
  searchParams: EventSearchParams
  navigate: (opts: { search: Partial<EventSearchParams> | SearchUpdater; replace?: boolean }) => void
}

export function useEventFiltering({ events, searchParams, navigate }: UseEventFilteringOptions) {
  // Only UI-only state remains in React
  const [showFilters, setShowFilters] = useState(false)

  // All filter values derived from URL params
  const activeTab = (searchParams.tab || 'all') as EventTab
  const completenessFilter = (searchParams.completeness || 'incomplete') as CompletenessFilter
  const dataGapFilter = (searchParams.dataGap || 'all') as DataGapType
  const search = searchParams.search || ''
  const venueFilter = searchParams.venue
  const statusFilter = (searchParams.status || 'all') as EventStatus | 'all'

  // Setters that update URL
  const setSearch = useCallback(
    (value: string) => {
      navigate({
        search: (prev) => ({ ...prev, search: value || undefined }),
        replace: true,
      })
    },
    [navigate]
  )

  const setVenueFilter = useCallback(
    (value: string | undefined) => {
      navigate({
        search: (prev) => ({ ...prev, venue: value }),
        replace: true,
      })
    },
    [navigate]
  )

  const setDataGapFilter = useCallback(
    (value: DataGapType) => {
      navigate({
        search: (prev) => ({ ...prev, dataGap: value === 'all' ? undefined : value }),
        replace: true,
      })
    },
    [navigate]
  )

  const setCompletenessFilter = useCallback(
    (value: CompletenessFilter) => {
      navigate({
        search: (prev) => ({
          ...prev,
          completeness: value === 'incomplete' ? undefined : value,
          // Reset dataGap when switching to 'complete'
          dataGap: value === 'complete' ? undefined : prev.dataGap,
        }),
        replace: true,
      })
    },
    [navigate]
  )

  const setStatusFilter = useCallback(
    (value: EventStatus | 'all') => {
      navigate({
        search: (prev) => ({ ...prev, status: value === 'all' ? undefined : value }),
        replace: true,
      })
    },
    [navigate]
  )

  // clearFilters - pass object directly to replace all search params (not a function updater)
  const clearFilters = useCallback(() => {
    navigate({
      search: {
        tab: activeTab,
        // All other params cleared by omission when passing object directly
      },
    })
  }, [navigate, activeTab])

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

  // Helper to check if an event has any data gaps
  const hasDataGap = (event: EventWithVenue): boolean => {
    return (
      (!event.description_es && !!event.link) ||
      !event.venue_id ||
      !event.categories ||
      event.categories.length === 0
    )
  }

  // Compute data gap counts for "data quality" tab
  const dataGapCounts = useMemo<DataGapCounts>(() => {
    let missingDescription = 0
    let missingVenue = 0
    let missingCategories = 0
    let complete = 0
    let incomplete = 0

    events.forEach((event) => {
      // Only count scheduled/upcoming events
      if (event.status !== 'scheduled') return

      if (hasDataGap(event)) {
        incomplete++
        if (!event.description_es && event.link) {
          missingDescription++
        }
        if (!event.venue_id) {
          missingVenue++
        }
        if (!event.categories || event.categories.length === 0) {
          missingCategories++
        }
      } else {
        complete++
      }
    })

    return {
      all: incomplete,
      complete,
      missing_description: missingDescription,
      missing_venue: missingVenue,
      missing_categories: missingCategories,
    }
  }, [events])

  // Compute tab counts
  const tabCounts = useMemo<TabCounts>(() => {
    let pendingReview = 0
    let past = 0

    events.forEach((event) => {
      if (event.status === 'pending_review') {
        pendingReview++
      }
      if (event.status === 'past') {
        past++
      }
    })

    return {
      all: events.length,
      needs_attention: dataGapCounts.all,
      pending_review: pendingReview,
      past: past,
    }
  }, [events, dataGapCounts.all])

  // Filter events based on tab + search + venue + data gap + completeness
  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      // Tab filter
      if (activeTab === 'needs_attention') {
        // Must be scheduled
        if (event.status !== 'scheduled') return false

        // Apply completeness filter first
        if (completenessFilter === 'complete') {
          // Show only complete events (no data gaps)
          if (hasDataGap(event)) return false
        } else {
          // Show incomplete events, apply data gap filter
          if (dataGapFilter === 'all') {
            // Any gap counts
            if (!hasDataGap(event)) return false
          } else if (dataGapFilter === 'missing_description') {
            if (event.description_es || !event.link) return false
          } else if (dataGapFilter === 'missing_venue') {
            if (event.venue_id) return false
          } else if (dataGapFilter === 'missing_categories') {
            if (event.categories && event.categories.length > 0) return false
          }
        }
      } else if (activeTab === 'pending_review') {
        if (event.status !== 'pending_review') return false
      } else if (activeTab === 'past') {
        if (event.status !== 'past') return false
      }
      // Status filter (only applies when on "all" tab)
      if (activeTab === 'all' && statusFilter !== 'all' && event.status !== statusFilter) {
        return false
      }
      // Search filter
      if (search && !event.name.toLowerCase().includes(search.toLowerCase())) {
        return false
      }
      // Venue filter
      if (venueFilter && event.venue_id !== venueFilter) {
        return false
      }
      return true
    })
  }, [events, activeTab, search, statusFilter, venueFilter, dataGapFilter, completenessFilter])

  // Check if any filters are active (for showing "Clear" button)
  const hasActiveFilters = !!(
    search ||
    (activeTab === 'all' && statusFilter !== 'all') ||
    venueFilter ||
    (activeTab === 'needs_attention' && completenessFilter === 'incomplete' && dataGapFilter !== 'all') ||
    // Also check URL column filters and sorting
    searchParams.name ||
    searchParams.venue_name ||
    searchParams.source ||
    searchParams.sortBy
  )

  return {
    search,
    setSearch,
    activeTab,
    statusFilter,
    setStatusFilter,
    venueFilter,
    setVenueFilter,
    showFilters,
    setShowFilters,
    venueOptions,
    filteredEvents,
    hasActiveFilters,
    clearFilters,
    tabCounts,
    dataGapFilter,
    setDataGapFilter,
    dataGapCounts,
    completenessFilter,
    setCompletenessFilter,
  }
}

export type UseEventFilteringReturn = ReturnType<typeof useEventFiltering>
