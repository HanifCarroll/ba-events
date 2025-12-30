import { useState, useMemo } from 'react'
import type { EventWithVenue, EventStatus } from '@/lib/types'

export type EventTab = 'all' | 'needs_attention' | 'pending_review' | 'past'

export type DataGapType = 'all' | 'missing_description' | 'missing_venue' | 'missing_categories'

export interface VenueOption {
  value: string
  label: string
}

export interface DataGapCounts {
  all: number
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

export function useEventFiltering(events: EventWithVenue[], activeTab: EventTab = 'all') {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<EventStatus | 'all'>('all')
  const [venueFilter, setVenueFilter] = useState<string | undefined>(undefined)
  const [showFilters, setShowFilters] = useState(false)
  const [dataGapFilter, setDataGapFilter] = useState<DataGapType>('all')

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

  // Compute data gap counts for "needs attention" tab
  const dataGapCounts = useMemo<DataGapCounts>(() => {
    let missingDescription = 0
    let missingVenue = 0
    let missingCategories = 0

    events.forEach((event) => {
      // Only count scheduled/upcoming events
      if (event.status !== 'scheduled') return

      if (!event.description_es && event.link) {
        missingDescription++
      }
      if (!event.venue_id) {
        missingVenue++
      }
      if (!event.categories || event.categories.length === 0) {
        missingCategories++
      }
    })

    // "all" is union of all gaps (event can have multiple gaps)
    const eventsWithAnyGap = events.filter((event) => {
      if (event.status !== 'scheduled') return false
      return (
        (!event.description_es && event.link) ||
        !event.venue_id ||
        !event.categories ||
        event.categories.length === 0
      )
    }).length

    return {
      all: eventsWithAnyGap,
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

  // Filter events based on tab + search + venue + data gap
  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      // Tab filter
      if (activeTab === 'needs_attention') {
        // Must be scheduled
        if (event.status !== 'scheduled') return false

        // Apply data gap filter
        if (dataGapFilter === 'all') {
          // Any gap counts
          const hasAnyGap =
            (!event.description_es && event.link) ||
            !event.venue_id ||
            !event.categories ||
            event.categories.length === 0
          if (!hasAnyGap) return false
        } else if (dataGapFilter === 'missing_description') {
          if (event.description_es || !event.link) return false
        } else if (dataGapFilter === 'missing_venue') {
          if (event.venue_id) return false
        } else if (dataGapFilter === 'missing_categories') {
          if (event.categories && event.categories.length > 0) return false
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
  }, [events, activeTab, search, statusFilter, venueFilter, dataGapFilter])

  const hasActiveFilters = !!(search || (activeTab === 'all' && statusFilter !== 'all') || venueFilter || (activeTab === 'needs_attention' && dataGapFilter !== 'all'))

  function clearFilters() {
    setSearch('')
    setStatusFilter('all')
    setVenueFilter(undefined)
    setDataGapFilter('all')
  }

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
  }
}

export type UseEventFilteringReturn = ReturnType<typeof useEventFiltering>
