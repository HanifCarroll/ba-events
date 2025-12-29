import { useState, useMemo } from 'react'
import type { EventWithVenue, EventStatus } from '@/lib/types'

export interface VenueOption {
  value: string
  label: string
}

export function useEventFiltering(events: EventWithVenue[]) {
  const [search, setSearch] = useState('')
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

  const hasActiveFilters = !!(search || statusFilter !== 'all' || venueFilter)

  function clearFilters() {
    setSearch('')
    setStatusFilter('all')
    setVenueFilter(undefined)
  }

  return {
    search,
    setSearch,
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
  }
}

export type UseEventFilteringReturn = ReturnType<typeof useEventFiltering>
