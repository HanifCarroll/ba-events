import { useState, useMemo } from 'react'
import type { EventWithVenue, EventStatus } from '@/lib/types'

export type EventTab = 'all' | 'needs_attention' | 'pending_review' | 'past'

export interface VenueOption {
  value: string
  label: string
}

export interface TabCounts {
  all: number
  needs_attention: number
  pending_review: number
  past: number
}

export function useEventFiltering(events: EventWithVenue[]) {
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState<EventTab>('all')
  const [statusFilter, setStatusFilter] = useState<EventStatus | 'all'>('all')
  const [venueFilter, setVenueFilter] = useState<string | undefined>(undefined)
  const [showFilters, setShowFilters] = useState(false)

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

  // Compute tab counts
  const tabCounts = useMemo<TabCounts>(() => {
    let needsAttention = 0
    let pendingReview = 0
    let past = 0

    events.forEach((event) => {
      // Needs attention: missing description but has a link to fetch from
      if (!event.description && event.link) {
        needsAttention++
      }
      if (event.status === 'pending_review') {
        pendingReview++
      }
      if (event.status === 'past') {
        past++
      }
    })

    return {
      all: events.length,
      needs_attention: needsAttention,
      pending_review: pendingReview,
      past: past,
    }
  }, [events])

  // Filter events based on tab + search + venue
  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      // Tab filter
      if (activeTab === 'needs_attention') {
        if (event.description || !event.link) return false
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
  }, [events, activeTab, search, statusFilter, venueFilter])

  const hasActiveFilters = !!(search || (activeTab === 'all' && statusFilter !== 'all') || venueFilter)

  function clearFilters() {
    setSearch('')
    setStatusFilter('all')
    setVenueFilter(undefined)
  }

  return {
    search,
    setSearch,
    activeTab,
    setActiveTab,
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
  }
}

export type UseEventFilteringReturn = ReturnType<typeof useEventFiltering>
