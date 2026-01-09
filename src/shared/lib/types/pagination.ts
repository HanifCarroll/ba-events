/**
 * Pagination types for server-side pagination
 *
 * These types define the contract between client and server for paginated data.
 * All pagination uses 1-indexed pages (page 1 is the first page).
 */

/** Basic pagination parameters */
export interface PaginationParams {
  page: number // 1-indexed page number
  pageSize: number // Items per page (default 25, max 100)
}

/** Pagination metadata returned from server */
export interface PaginationMeta {
  page: number
  pageSize: number
  totalCount: number
  totalPages: number
  hasNextPage: boolean
  hasPrevPage: boolean
}

/** Generic paginated response wrapper */
export interface PaginatedResponse<T> {
  data: T[]
  pagination: PaginationMeta
}

/** Event filter parameters for server-side filtering */
export interface EventFilterParams {
  // Tab-based filter (determines base query)
  tab?: 'all' | 'needs_attention' | 'pending_review' | 'past'

  // Individual filters
  status?: string
  venueId?: string
  search?: string

  // Data gap filters
  missingDescription?: boolean
  missingVenue?: boolean

  // Date filters
  importedToday?: boolean

  // View preferences
  showPast?: boolean

  // Sorting
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
}

/** Combined event list parameters (pagination + filters) */
export type EventListParams = PaginationParams & EventFilterParams

/** Tab counts returned from the database function */
export interface EventTabCounts {
  all: number
  needs_attention: number
  pending_review: number
  past: number
}

/** Event tab types */
export type EventTab = 'all' | 'needs_attention' | 'pending_review' | 'past'

/**
 * URL search params shape for events admin page
 *
 * This is the single source of truth for URL params.
 * The route's Zod schema should validate to this shape.
 */
export interface EventSearchParams {
  // Tab filter
  tab?: EventTab
  // Pagination
  page?: number
  pageSize?: number
  // Quick filters
  search?: string
  venue?: string // venue ID filter (named 'venue' in URL)
  importedToday?: boolean
  // Data gap filters
  missingDescription?: boolean
  missingVenue?: boolean
  // View preferences
  showPast?: boolean
  // Column filters (for DataTable)
  name?: string
  venue_name?: string
  source?: string
  status?: string
  // Sorting
  sortBy?: string
  sortDir?: 'asc' | 'desc'
}

/** Simple option type for venue filter dropdowns */
export interface VenueOption {
  value: string
  label: string
}

/** Default pagination values */
export const PAGINATION_DEFAULTS = {
  page: 1,
  pageSize: 25,
  maxPageSize: 100,
  minPageSize: 10,
} as const
