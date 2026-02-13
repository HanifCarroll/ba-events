import { createClient, SupabaseClient } from '@supabase/supabase-js'

// Re-export SupabaseClient type for use in other modules
export type { SupabaseClient }

import type {
  Event,
  EventInsert,
  EventUpdate,
  EventSearchResult,
  EventWithVenue,
  EventListItem,
  EventFilters,
  EventStatus,
  Venue,
  VenueInsert,
  VenueUpdate,
  Neighborhood,
} from '../types'
import { generateEmbedding } from '../ai/embeddings'

// Lazy-initialize Supabase client (only when needed, server-side only)
let supabaseInstance: SupabaseClient | null = null

function getSupabase(): SupabaseClient {
  if (!supabaseInstance) {
    const supabaseUrl = process.env.SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_ANON_KEY

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables')
    }

    supabaseInstance = createClient(supabaseUrl, supabaseKey)
  }
  return supabaseInstance
}

// Export for backward compatibility (use getSupabase() internally)
export const supabase = new Proxy({} as SupabaseClient, {
  get(_, prop) {
    return (getSupabase() as unknown as Record<string | symbol, unknown>)[prop]
  },
})

// ============================================================================
// VENUE OPERATIONS
// ============================================================================

export async function getVenues(limit = 100) {
  const { data, error } = await supabase
    .from('venues')
    .select('*')
    .order('name', { ascending: true })
    .limit(limit)

  if (error) throw error
  return data as Venue[]
}

export async function getVenueById(id: string) {
  const { data, error } = await supabase
    .from('venues')
    .select('*')
    .eq('id', id)
    .single()

  if (error) throw error
  return data as Venue
}

export async function getVenuesByNeighborhood(neighborhood: Neighborhood) {
  const { data, error } = await supabase
    .from('venues')
    .select('*')
    .eq('neighborhood', neighborhood)
    .order('name', { ascending: true })

  if (error) throw error
  return data as Venue[]
}

export async function searchVenuesByName(query: string) {
  const { data, error } = await supabase
    .from('venues')
    .select('*')
    .ilike('name', `%${query}%`)
    .order('name', { ascending: true })
    .limit(20)

  if (error) throw error
  return data as Venue[]
}

export async function findVenuesByExactNames(names: string[]) {
  if (names.length === 0) return []

  const { data, error } = await supabase
    .from('venues')
    .select('*')
    .in('name', names)

  if (error) throw error
  return data as Venue[]
}

export async function createVenue(venue: VenueInsert, client?: SupabaseClient) {
  const db = client ?? supabase
  const { data, error } = await db
    .from('venues')
    .insert(venue)
    .select()
    .single()

  if (error) throw error
  return data as Venue
}

export async function createVenues(venues: VenueInsert[], client?: SupabaseClient) {
  const db = client ?? supabase
  const { data, error } = await db
    .from('venues')
    .insert(venues)
    .select()

  if (error) throw error
  return data as Venue[]
}

export async function updateVenue(id: string, updates: VenueUpdate, client?: SupabaseClient) {
  const db = client ?? supabase
  const { data, error } = await db
    .from('venues')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data as Venue
}

export async function deleteVenue(id: string, client?: SupabaseClient) {
  const db = client ?? supabase
  const { error } = await db.from('venues').delete().eq('id', id)
  if (error) throw error
}

export async function bulkDeleteVenues(ids: string[], client?: SupabaseClient) {
  const db = client ?? supabase
  const { error } = await db.from('venues').delete().in('id', ids)
  if (error) throw error
}

// ============================================================================
// EVENT OPERATIONS
// ============================================================================

// Columns for admin event lists (excludes embedding for performance)
// The embedding column is ~6KB per event and not needed for admin display
const EVENT_ADMIN_COLUMNS = `
  id, name, description_es, description_en, description_display_es, description_display_en,
  description_summary_es, description_summary_en, starts_at, ends_at, is_all_day,
  venue_id, categories, price, is_free, image_url, link, ticket_url,
  source, external_id, status, location_hidden, enrichment_status, enrichment_error,
  enriched_at, created_at, updated_at,
  venue_name, venue_neighborhood, venue_address
`

export async function getEvents(limit = 50) {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('status', 'scheduled')
    .order('starts_at', { ascending: true })
    .limit(limit)

  if (error) throw error
  return data as Event[]
}

export async function getEventsWithVenues(limit = 50) {
  const { data, error } = await supabase
    .from('events_with_venues')
    .select('*')
    .order('starts_at', { ascending: true })
    .limit(limit)

  if (error) throw error
  return data as EventWithVenue[]
}

/**
 * Fetch active (non-past) events for admin with explicit column selection.
 * Excludes the embedding column for better performance.
 */
export async function getActiveEventsWithVenues(limit = 5000) {
  const { data, error } = await supabase
    .from('events_with_venues')
    .select(EVENT_ADMIN_COLUMNS)
    .neq('status', 'past')
    .order('starts_at', { ascending: true })
    .limit(limit)

  if (error) throw error
  return data as EventWithVenue[]
}

/**
 * Fetch past events for admin with explicit column selection.
 * Lazy-loaded when user clicks the "Past" tab.
 */
export async function getPastEventsWithVenues(limit = 5000) {
  const { data, error } = await supabase
    .from('events_with_venues')
    .select(EVENT_ADMIN_COLUMNS)
    .eq('status', 'past')
    .order('starts_at', { ascending: false }) // Most recent past events first
    .limit(limit)

  if (error) throw error
  return data as EventWithVenue[]
}

// ============================================================================
// LIGHTWEIGHT ADMIN LIST QUERIES (Performance Optimized)
// ============================================================================

/**
 * Fetch active events for admin list view (lightweight).
 * Uses events_admin_list view which excludes heavy columns (descriptions).
 * Reduces payload from ~2-10MB to ~200-400KB for 2000 events.
 */
export async function getActiveEventsForList(limit = 5000): Promise<EventListItem[]> {
  const { data, error } = await supabase
    .from('events_admin_list')
    .select('*')
    .neq('status', 'past')
    .order('starts_at', { ascending: true })
    .limit(limit)

  if (error) throw error
  return data as EventListItem[]
}

/**
 * Fetch past events for admin list view (lightweight).
 * Uses events_admin_list view which excludes heavy columns (descriptions).
 */
export async function getPastEventsForList(limit = 5000): Promise<EventListItem[]> {
  const { data, error } = await supabase
    .from('events_admin_list')
    .select('*')
    .eq('status', 'past')
    .order('starts_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  return data as EventListItem[]
}

export async function getEventById(id: string) {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('id', id)
    .single()

  if (error) throw error
  return data as Event
}

export async function getEventWithVenue(id: string) {
  const { data, error } = await supabase
    .from('events_with_venues')
    .select('*')
    .eq('id', id)
    .single()

  if (error) throw error
  return data as EventWithVenue
}

export async function getUpcomingEvents(days = 7) {
  const now = new Date().toISOString()
  const endDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from('events_with_venues')
    .select('*')
    .eq('status', 'scheduled')
    .gte('starts_at', now)
    .lte('starts_at', endDate)
    .order('starts_at', { ascending: true })

  if (error) throw error
  return data as EventWithVenue[]
}

export async function getEventsByVenue(venueId: string) {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('venue_id', venueId)
    .eq('status', 'scheduled')
    .order('starts_at', { ascending: true })

  if (error) throw error
  return data as Event[]
}

// Get all events for a venue (including past events, all statuses)
export async function getAllEventsByVenue(venueId: string) {
  const { data, error } = await supabase
    .from('events')
    .select('id, name, starts_at, status, link, source')
    .eq('venue_id', venueId)
    .order('starts_at', { ascending: false })

  if (error) throw error
  return data as Pick<Event, 'id' | 'name' | 'starts_at' | 'status' | 'link' | 'source'>[]
}

// Get event counts for all venues in a single query
export async function getVenueEventCounts(): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from('events')
    .select('venue_id')
    .not('venue_id', 'is', null)

  if (error) throw error

  // Aggregate counts in JavaScript since Supabase doesn't support GROUP BY directly
  const counts: Record<string, number> = {}
  for (const row of data) {
    const venueId = row.venue_id as string
    counts[venueId] = (counts[venueId] || 0) + 1
  }
  return counts
}

export async function createEvent(event: EventInsert, client?: SupabaseClient) {
  const db = client ?? supabase
  const { data, error } = await db
    .from('events')
    .insert(event)
    .select()
    .single()

  if (error) throw error
  return data as Event
}

export async function createEvents(events: EventInsert[], client?: SupabaseClient) {
  const db = client ?? supabase
  const { data, error } = await db
    .from('events')
    .insert(events)
    .select()

  if (error) throw error
  return data as Event[]
}

export async function updateEvent(id: string, updates: EventUpdate, client?: SupabaseClient) {
  const db = client ?? supabase

  // Update the event
  const { error: updateError } = await db.from('events').update(updates).eq('id', id)
  if (updateError) throw updateError

  // Fetch the updated event with venue data from the view
  const { data, error: fetchError } = await db
    .from('events_with_venues')
    .select('*')
    .eq('id', id)
    .single()

  if (fetchError) throw fetchError
  return data as EventWithVenue
}

export async function deleteEvent(id: string, client?: SupabaseClient) {
  const db = client ?? supabase
  const { error } = await db.from('events').delete().eq('id', id)
  if (error) throw error
}

export async function bulkUpdateEventStatus(eventIds: string[], status: EventStatus, client?: SupabaseClient) {
  const db = client ?? supabase
  const { data, error } = await db
    .from('events')
    .update({ status })
    .in('id', eventIds)
    .select()

  if (error) throw error
  return data as Event[]
}

export async function bulkUpdateLocationTba(eventIds: string[], locationTba: boolean, client?: SupabaseClient) {
  const db = client ?? supabase
  const { data, error } = await db
    .from('events')
    .update({ location_tba: locationTba })
    .in('id', eventIds)
    .select()

  if (error) throw error
  return data as Event[]
}

export async function bulkUpdateDescriptionUnavailable(eventIds: string[], descriptionUnavailable: boolean, client?: SupabaseClient) {
  const db = client ?? supabase
  const { data, error } = await db
    .from('events')
    .update({ description_unavailable: descriptionUnavailable })
    .in('id', eventIds)
    .select()

  if (error) throw error
  return data as Event[]
}

export async function bulkDeleteEvents(eventIds: string[], client?: SupabaseClient) {
  const db = client ?? supabase
  const { error } = await db.from('events').delete().in('id', eventIds)
  if (error) throw error
}

// Mark all ended events as past
// - If ends_at exists: mark past when ends_at < now
// - If ends_at is NULL: mark past when entire start day has passed (conservative for late-night events)
export async function markPastEvents(client?: SupabaseClient) {
  const db = client ?? supabase
  const now = new Date().toISOString()
  const today = new Date().toISOString().split('T')[0] // YYYY-MM-DD

  const { data, error } = await db
    .from('events')
    .update({ status: 'past' as EventStatus })
    .eq('status', 'scheduled')
    .or(`ends_at.lt.${now},and(ends_at.is.null,starts_at.lt.${today})`)
    .select()

  if (error) throw error
  return data as Event[]
}

// Count events that would be marked as past (for confirmation dialog)
export async function countPastEvents() {
  const now = new Date().toISOString()
  const today = new Date().toISOString().split('T')[0]

  const { count, error } = await supabase
    .from('events')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'scheduled')
    .or(`ends_at.lt.${now},and(ends_at.is.null,starts_at.lt.${today})`)

  if (error) throw error
  return count || 0
}

// ============================================================================
// SEARCH OPERATIONS
// ============================================================================

// Semantic search using pgvector
export async function searchEventsBySimilarity(
  queryEmbedding: number[],
  matchThreshold = 0.7,
  matchCount = 10
) {
  const { data, error } = await supabase.rpc('match_events', {
    query_embedding: queryEmbedding,
    match_threshold: matchThreshold,
    match_count: matchCount,
  })

  if (error) throw error
  return data as EventSearchResult[]
}

// Filter-based search (for structured queries)
export async function searchEventsWithFilters(filters: EventFilters, limit: number = 50) {
  let query = supabase.from('events_with_venues').select('*')

  // Default to scheduled events
  query = query.eq('status', filters.status || 'scheduled')

  if (filters.startsAfter) {
    query = query.gte('starts_at', filters.startsAfter)
  }
  if (filters.startsBefore) {
    query = query.lte('starts_at', filters.startsBefore)
  }
  if (filters.neighborhood) {
    query = query.eq('venue_neighborhood', filters.neighborhood)
  }
  if (filters.venueId) {
    query = query.eq('venue_id', filters.venueId)
  }
  if (filters.categories && filters.categories.length > 0) {
    query = query.overlaps('categories', filters.categories)
  }
  if (filters.isFree) {
    query = query.eq('is_free', true)
  }
  if (filters.maxPrice !== undefined) {
    query = query.lte('price', filters.maxPrice)
  }

  query = query.order('starts_at', { ascending: true }).limit(limit)

  const { data, error } = await query
  if (error) throw error
  return data as EventWithVenue[]
}

// Get events happening now or starting soon
export async function getEventsHappeningNow() {
  const now = new Date().toISOString()

  const { data, error } = await supabase
    .from('events_with_venues')
    .select('*')
    .eq('status', 'scheduled')
    .lte('starts_at', now)
    .or(`ends_at.is.null,ends_at.gte.${now}`)
    .order('starts_at', { ascending: true })

  if (error) throw error
  return data as EventWithVenue[]
}

// Get tonight's events (6pm today to 6am tomorrow in BA time)
export async function getTonightsEvents() {
  const { toZonedTime, fromZonedTime } = await import('date-fns-tz')
  const { setHours, startOfDay, addDays, getHours } = await import('date-fns')
  const { BA_TIMEZONE } = await import('../constants')

  const now = toZonedTime(new Date(), BA_TIMEZONE)
  const currentHour = getHours(now)

  let tonight: Date
  let tomorrowMorning: Date

  if (currentHour < 6) {
    // Late night (midnight-6am) - show current night's events
    tonight = now
    tomorrowMorning = setHours(startOfDay(now), 6)
  } else {
    // Daytime - "tonight" starts at 6pm
    tonight = setHours(startOfDay(now), 18)
    tomorrowMorning = setHours(startOfDay(addDays(now, 1)), 6)
  }

  const tonightUTC = fromZonedTime(tonight, BA_TIMEZONE).toISOString()
  const tomorrowMorningUTC = fromZonedTime(tomorrowMorning, BA_TIMEZONE).toISOString()

  const { data, error } = await supabase
    .from('events_with_venues')
    .select('*')
    .eq('status', 'scheduled')
    .gte('starts_at', tonightUTC)
    .lte('starts_at', tomorrowMorningUTC)
    .order('starts_at', { ascending: true })

  if (error) throw error
  return data as EventWithVenue[]
}

// Hybrid semantic + filter search (filtering done in PostgreSQL for performance)
export async function hybridEventSearch(
  query: string,
  filters: EventFilters,
  matchCount = 10
): Promise<EventWithVenue[]> {
  // Generate embedding for the search query
  const queryEmbedding = await generateEmbedding(query)

  // Call the PostgreSQL function with all filters applied server-side
  const { data, error } = await supabase.rpc(
    'match_events_with_venues_filtered',
    {
      query_embedding: queryEmbedding,
      match_threshold: 0.2,
      match_count: matchCount,
      filter_starts_after: filters.startsAfter || null,
      filter_starts_before: filters.startsBefore || null,
      filter_neighborhood: filters.neighborhood || null,
      filter_is_free: filters.isFree || null,
      filter_max_price: filters.maxPrice ?? null,
      filter_categories: filters.categories && filters.categories.length > 0 ? filters.categories : null,
    }
  )

  if (error) throw error
  return (data as EventWithVenue[]) || []
}

// ============================================================================
// UPSERT OPERATIONS (for scrapers)
// ============================================================================

/**
 * Check if an event already exists by source and external_id
 */
export async function checkEventExists(
  source: string,
  externalId: string
): Promise<boolean> {
  const { data } = await supabase
    .from('events')
    .select('id')
    .eq('source', source)
    .eq('external_id', externalId)
    .single()

  return !!data
}

/**
 * Upsert events - insert new events, update existing ones
 * Uses source + external_id for deduplication
 */
export async function upsertEvents(events: EventInsert[], client?: SupabaseClient): Promise<{
  inserted: number
  updated: number
}> {
  const db = client ?? supabase
  let inserted = 0
  let updated = 0

  for (const event of events) {
    // Check if event already exists
    const { data: existing } = await db
      .from('events')
      .select('id')
      .eq('source', event.source)
      .eq('external_id', event.external_id)
      .single()

    if (existing) {
      // Update existing event
      const { error } = await db
        .from('events')
        .update(event)
        .eq('id', existing.id)

      if (!error) updated++
    } else {
      // Insert new event
      const { error } = await db
        .from('events')
        .insert(event)

      if (!error) inserted++
    }
  }

  return { inserted, updated }
}

// ============================================================================
// STATS OPERATIONS (optimized with COUNT queries)
// ============================================================================

export async function getAdminStatsFromDb() {
  // Run all count queries in parallel for efficiency
  const [venueCount, eventCount, upcomingCount, scheduledCount] = await Promise.all([
    // Count venues
    supabase.from('venues').select('*', { count: 'exact', head: true }),
    // Count all events
    supabase.from('events').select('*', { count: 'exact', head: true }),
    // Count upcoming events (starts_at > now AND status = scheduled)
    supabase
      .from('events')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'scheduled')
      .gt('starts_at', new Date().toISOString()),
    // Count scheduled events
    supabase
      .from('events')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'scheduled'),
  ])

  if (venueCount.error) throw venueCount.error
  if (eventCount.error) throw eventCount.error
  if (upcomingCount.error) throw upcomingCount.error
  if (scheduledCount.error) throw scheduledCount.error

  return {
    venueCount: venueCount.count || 0,
    eventCount: eventCount.count || 0,
    upcomingCount: upcomingCount.count || 0,
    scheduledCount: scheduledCount.count || 0,
  }
}
