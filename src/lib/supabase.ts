import { createClient } from '@supabase/supabase-js'
import type {
  Event,
  EventInsert,
  EventUpdate,
  EventSearchResult,
  EventWithVenue,
  EventFilters,
  EventStatus,
  Venue,
  VenueInsert,
  VenueUpdate,
  Neighborhood,
} from './types'
import { generateEmbedding } from './embeddings'

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables')
}

export const supabase = createClient(supabaseUrl, supabaseKey)

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

export async function createVenue(venue: VenueInsert) {
  const { data, error } = await supabase
    .from('venues')
    .insert(venue)
    .select()
    .single()

  if (error) throw error
  return data as Venue
}

export async function createVenues(venues: VenueInsert[]) {
  const { data, error } = await supabase
    .from('venues')
    .insert(venues)
    .select()

  if (error) throw error
  return data as Venue[]
}

export async function updateVenue(id: string, updates: VenueUpdate) {
  const { data, error } = await supabase
    .from('venues')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data as Venue
}

export async function deleteVenue(id: string) {
  const { error } = await supabase.from('venues').delete().eq('id', id)
  if (error) throw error
}

// ============================================================================
// EVENT OPERATIONS
// ============================================================================

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
    .eq('status', 'scheduled')
    .order('starts_at', { ascending: true })
    .limit(limit)

  if (error) throw error
  return data as EventWithVenue[]
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

export async function createEvent(event: EventInsert) {
  const { data, error } = await supabase
    .from('events')
    .insert(event)
    .select()
    .single()

  if (error) throw error
  return data as Event
}

export async function createEvents(events: EventInsert[]) {
  const { data, error } = await supabase
    .from('events')
    .insert(events)
    .select()

  if (error) throw error
  return data as Event[]
}

export async function updateEvent(id: string, updates: EventUpdate) {
  const { data, error } = await supabase
    .from('events')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data as Event
}

export async function deleteEvent(id: string) {
  const { error } = await supabase.from('events').delete().eq('id', id)
  if (error) throw error
}

export async function bulkUpdateEventStatus(eventIds: string[], status: EventStatus) {
  const { data, error } = await supabase
    .from('events')
    .update({ status })
    .in('id', eventIds)
    .select()

  if (error) throw error
  return data as Event[]
}

export async function bulkDeleteEvents(eventIds: string[]) {
  const { error } = await supabase.from('events').delete().in('id', eventIds)
  if (error) throw error
}

// Mark all ended events as past
// - If ends_at exists: mark past when ends_at < now
// - If ends_at is NULL: mark past when entire start day has passed (conservative for late-night events)
export async function markPastEvents() {
  const now = new Date().toISOString()
  const today = new Date().toISOString().split('T')[0] // YYYY-MM-DD

  const { data, error } = await supabase
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
export async function searchEventsWithFilters(filters: EventFilters) {
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
  if (filters.vibes && filters.vibes.length > 0) {
    query = query.overlaps('vibes', filters.vibes)
  }
  if (filters.isFree) {
    query = query.eq('is_free', true)
  }
  if (filters.maxPrice !== undefined) {
    query = query.lte('price', filters.maxPrice)
  }
  if (filters.minAge !== undefined) {
    // Events with no age restriction (null) or matching min_age
    query = query.or(`min_age.is.null,min_age.lte.${filters.minAge}`)
  }

  query = query.order('starts_at', { ascending: true }).limit(50)

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

// Get tonight's events (6pm today to 6am tomorrow)
export async function getTonightsEvents() {
  const now = new Date()
  const tonight = new Date(now)
  tonight.setHours(18, 0, 0, 0)

  const tomorrowMorning = new Date(tonight)
  tomorrowMorning.setDate(tomorrowMorning.getDate() + 1)
  tomorrowMorning.setHours(6, 0, 0, 0)

  const { data, error } = await supabase
    .from('events_with_venues')
    .select('*')
    .eq('status', 'scheduled')
    .gte('starts_at', tonight.toISOString())
    .lte('starts_at', tomorrowMorning.toISOString())
    .order('starts_at', { ascending: true })

  if (error) throw error
  return data as EventWithVenue[]
}

// Hybrid semantic + filter search
export async function hybridEventSearch(
  query: string,
  filters: EventFilters,
  matchCount = 10
): Promise<EventWithVenue[]> {
  // Generate embedding for the search query
  const queryEmbedding = await generateEmbedding(query)

  // Get semantic results with low threshold - short queries vs long docs have lower similarity
  const { data: semanticResults, error } = await supabase.rpc(
    'match_events_with_venues',
    {
      query_embedding: queryEmbedding,
      match_threshold: 0.2,
      match_count: 50, // Get more for filtering
    }
  )

  if (error) throw error
  if (!semanticResults || semanticResults.length === 0) return []

  // Apply post-filters to semantic results
  let filtered = semanticResults as EventWithVenue[]

  if (filters.startsAfter) {
    filtered = filtered.filter(
      e => new Date(e.starts_at) >= new Date(filters.startsAfter!)
    )
  }
  if (filters.startsBefore) {
    filtered = filtered.filter(
      e => new Date(e.starts_at) <= new Date(filters.startsBefore!)
    )
  }
  if (filters.neighborhood) {
    filtered = filtered.filter(
      e => e.venue_neighborhood === filters.neighborhood
    )
  }
  if (filters.isFree) {
    filtered = filtered.filter(e => e.is_free)
  }
  if (filters.maxPrice !== undefined) {
    filtered = filtered.filter(
      e => e.price === null || e.price <= filters.maxPrice!
    )
  }
  if (filters.categories && filters.categories.length > 0) {
    filtered = filtered.filter(e =>
      e.categories.some(c => filters.categories!.includes(c))
    )
  }
  if (filters.vibes && filters.vibes.length > 0) {
    filtered = filtered.filter(e =>
      e.vibes.some(v => filters.vibes!.includes(v))
    )
  }

  // Return top results (already sorted by similarity from database)
  return filtered.slice(0, matchCount)
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
export async function upsertEvents(events: EventInsert[]): Promise<{
  inserted: number
  updated: number
}> {
  let inserted = 0
  let updated = 0

  for (const event of events) {
    // Check if event already exists
    const { data: existing } = await supabase
      .from('events')
      .select('id')
      .eq('source', event.source)
      .eq('external_id', event.external_id)
      .single()

    if (existing) {
      // Update existing event
      const { error } = await supabase
        .from('events')
        .update(event)
        .eq('id', existing.id)

      if (!error) updated++
    } else {
      // Insert new event
      const { error } = await supabase
        .from('events')
        .insert(event)

      if (!error) inserted++
    }
  }

  return { inserted, updated }
}
