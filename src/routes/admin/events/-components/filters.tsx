import type { ReactNode } from 'react'
import type { ColumnFiltersState, SortingState } from '@tanstack/react-table'
import type { EventSearchParams } from '@/shared/lib/types/pagination'
import type { EventListItem } from '@/features/events'
import * as m from '@/paraglide/messages'

// ============================================
// URL param conversion helpers
// ============================================

/** Convert URL params to TanStack Table column filters */
export function paramsToColumnFilters(params: EventSearchParams): ColumnFiltersState {
  const filters: ColumnFiltersState = []
  if (params.name) filters.push({ id: 'name', value: params.name })
  if (params.venue_name) filters.push({ id: 'venue', value: params.venue_name })
  if (params.source) filters.push({ id: 'source', value: params.source })
  if (params.status) filters.push({ id: 'status', value: params.status })
  return filters
}

/** Convert TanStack Table column filters to URL params */
export function columnFiltersToParams(filters: ColumnFiltersState): Partial<EventSearchParams> {
  const params: Partial<EventSearchParams> = {}
  for (const filter of filters) {
    if (filter.id === 'name' && typeof filter.value === 'string') params.name = filter.value
    if (filter.id === 'venue' && typeof filter.value === 'string') params.venue_name = filter.value
    if (filter.id === 'source' && typeof filter.value === 'string') params.source = filter.value
    if (filter.id === 'status' && typeof filter.value === 'string') params.status = filter.value
  }
  return params
}

/** Convert URL params to TanStack Table sorting state */
export function paramsToSorting(params: EventSearchParams): SortingState {
  if (params.sortBy) {
    return [{ id: params.sortBy, desc: params.sortDir === 'desc' }]
  }
  return []
}

/** Convert TanStack Table sorting to URL params */
export function sortingToParams(sorting: SortingState): Partial<EventSearchParams> {
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

/** Check if event needs attention (missing description with link OR missing venue OR missing link) */
export function eventNeedsAttention(event: EventListItem): boolean {
  const missingDescriptionWithLink = !event.has_description_es && !!event.link
  // Events marked as "venue TBA" are intentionally without venue, not missing one
  const missingVenue = !event.venue_id && !event.location_tba
  const missingLink = !event.link
  return missingDescriptionWithLink || missingVenue || missingLink
}

/** Filter events based on tab and search params */
export function filterEvents(events: EventListItem[], params: EventSearchParams): EventListItem[] {
  const tab = params.tab ?? 'all'
  const showPast = params.showPast ?? false

  return events.filter((event) => {
    // Tab filtering
    switch (tab) {
      case 'needs_attention':
        if (event.status === 'past' || event.status === 'canceled') return false
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
export function sortEvents(
  events: EventListItem[],
  sortBy?: string,
  sortDir?: 'asc' | 'desc'
): EventListItem[] {
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

// ============================================
// Bulk action config
// ============================================

interface BulkActionConfig {
  title: string
  description: string
  confirmText: string
  confirmingText: string
  variant: 'default' | 'destructive'
}

/** Get dialog config for bulk actions */
export function getBulkActionConfig(action: string | null, count: number): BulkActionConfig | null {
  const configs: Record<string, BulkActionConfig> = {
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
    canceled: {
      title: m.admin_mark_canceled(),
      description: m.admin_mark_canceled_confirm({ count }),
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

// ============================================
// Status badge helper
// ============================================

import { Badge } from '@/shared/ui/badge'

export function getStatusBadge(status: string): ReactNode {
  const statusLabels: Record<string, () => string> = {
    scheduled: () => m.admin_status_scheduled(),
    pending_review: () => m.admin_status_pending(),
    canceled: () => m.admin_status_canceled(),
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
    canceled: {
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
