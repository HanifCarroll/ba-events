/**
 * Query builder for paginated event queries
 *
 * This module provides functions to build Supabase queries with filters
 * for server-side pagination of events.
 */

import { supabase } from '@/shared/lib/db/client'
import type {
  EventFilterParams,
  PaginationParams,
  PaginatedResponse,
  EventTabCounts,
} from '@/shared/lib/types/pagination'
import type { EventWithVenue } from '@/shared/lib/types'

/**
 * Build a paginated query for events with filters
 *
 * @param filters - Filter parameters (tab, status, venue, search, etc.)
 * @param pagination - Optional pagination parameters (page, pageSize)
 * @returns Paginated response with events and metadata
 */
export async function queryEventsPaginated(
  filters: EventFilterParams,
  pagination?: PaginationParams
): Promise<PaginatedResponse<EventWithVenue>> {
  // Start building the query
  let query = supabase
    .from('events_with_venues')
    .select('*', { count: 'exact' })

  // Apply tab-based filters
  switch (filters.tab) {
    case 'needs_attention':
      // Events with data gaps: missing description (with link) or missing venue
      query = query.or(
        'and(description_es.is.null,link.not.is.null),' +
        'venue_id.is.null'
      )
      break

    case 'pending_review':
      query = query.eq('status', 'pending_review')
      break

    case 'past':
      query = query.eq('status', 'past')
      break

    case 'all':
    default:
      // No additional filter for "all" tab
      break
  }

  // Apply individual filters
  if (filters.status) {
    query = query.eq('status', filters.status)
  }

  if (filters.venueId) {
    query = query.eq('venue_id', filters.venueId)
  }

  if (filters.search) {
    query = query.ilike('name', `%${filters.search}%`)
  }

  // Data gap filters
  if (filters.missingDescription) {
    // Missing description means: has a link (so we could scrape) but no description
    query = query.is('description_es', null).not('link', 'is', null)
  }

  if (filters.missingVenue) {
    // Exclude events marked as TBA (intentionally without venue)
    query = query.is('venue_id', null).eq('location_tba', false)
  }

  // Imported today filter
  if (filters.importedToday) {
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    query = query.gte('created_at', todayStart.toISOString())
  }

  // Hide past events unless explicitly showing them
  // Skip this filter on the 'past' tab (that tab is for viewing past events)
  if (!filters.showPast && filters.tab !== 'past') {
    query = query.neq('status', 'past')
  }

  // Apply sorting
  const sortColumn = filters.sortBy || 'starts_at'
  const sortAscending = filters.sortOrder === 'asc'
  query = query.order(sortColumn, { ascending: sortAscending })

  // Apply pagination
  if (pagination) {
    const start = (pagination.page - 1) * pagination.pageSize
    const end = start + pagination.pageSize - 1
    query = query.range(start, end)
  }

  // Execute query
  const { data, error, count } = await query

  if (error) {
    throw new Error(`Failed to query events: ${error.message}`)
  }

  const totalCount = count || 0
  const pageSize = pagination?.pageSize || 25
  const page = pagination?.page || 1
  const totalPages = Math.ceil(totalCount / pageSize)

  return {
    data: (data || []) as EventWithVenue[],
    pagination: {
      page,
      pageSize,
      totalCount,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
  }
}

/**
 * Get event tab counts using the database function
 *
 * @param filters - Filter parameters to apply (excluding tab)
 * @returns Tab counts for all, needs_attention, pending_review, past
 */
export async function queryEventTabCounts(
  filters: Omit<EventFilterParams, 'tab'>
): Promise<EventTabCounts> {
  const { data, error } = await supabase.rpc('get_event_tab_counts', {
    p_status: filters.status || null,
    p_venue_id: filters.venueId || null,
    p_search: filters.search || null,
    p_missing_description: filters.missingDescription || false,
    p_missing_venue: filters.missingVenue || false,
    p_imported_today: filters.importedToday || false,
  })

  if (error) {
    throw new Error(`Failed to get tab counts: ${error.message}`)
  }

  // The function returns a single row with all counts
  const counts = data?.[0] || {
    tab_active: 0,
    tab_needs_attention: 0,
    tab_pending_review: 0,
    tab_past: 0,
  }

  return {
    all: Number(counts.tab_active),
    needs_attention: Number(counts.tab_needs_attention),
    pending_review: Number(counts.tab_pending_review),
    past: Number(counts.tab_past),
  }
}
