import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { toZonedTime, fromZonedTime } from 'date-fns-tz'
import { addDays, getHours, setHours, startOfDay } from 'date-fns'

// Re-export SupabaseClient type for use in other modules
export type { SupabaseClient }

import { BA_TIMEZONE } from '../constants'

import type {
  Event,
  EventInsert,
  EventWithVenue,
  ChatEventPayload,
  EventFilters,
  Venue,
  VenueInsert,
} from '../types'
import { generateEmbedding } from '../ai/embeddings'

// Lazy-initialize Supabase client (only when needed, server-side only)
let supabaseInstance: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
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

// ============================================================================
// VENUE OPERATIONS
// ============================================================================

export async function getVenueById(id: string) {
  const { data, error } = await getSupabase()
    .from('venues')
    .select('*')
    .eq('id', id)
    .single()

  if (error) throw error
  return data as Venue
}

export async function searchVenuesByName(query: string) {
  const { data, error } = await getSupabase()
    .from('venues')
    .select('*')
    .ilike('name', `%${query}%`)
    .order('name', { ascending: true })
    .limit(20)

  if (error) throw error
  return data as Venue[]
}

export async function createVenue(venue: VenueInsert, client?: SupabaseClient) {
  const db = client ?? getSupabase()
  const { data, error } = await db
    .from('venues')
    .insert(venue)
    .select()
    .single()

  if (error) throw error
  return data as Venue
}

// ============================================================================
// EVENT OPERATIONS
// ============================================================================

// Columns for admin event lists (excludes embedding for performance)
// The embedding column is ~6KB per event and not needed for admin display
const EVENT_ADMIN_COLUMNS = `
  id, name, description_es, description_en, description_display_es, description_display_en,
  description_summary_es, description_summary_en, starts_at, ends_at, is_all_day,
  venue_id, categories, price, is_free, min_age, image_url, link, ticket_url,
  source, external_id, status, location_hidden, enrichment_status, enrichment_error,
  enriched_at, created_at, updated_at,
  venue_name, venue_neighborhood, venue_address
`

// Columns needed by chat tools and event cards. Excludes embedding so vectors do
// not leave the database for chat display or message attachment paths.
const CHAT_EVENT_COLUMNS = `
  id, name, description_es, description_en, description_display_es, description_display_en,
  description_summary_es, description_summary_en, starts_at, ends_at, is_all_day,
  venue_id, categories, price, is_free, min_age, image_url, link, ticket_url,
  source, external_id, status, location_hidden, location_tba, description_unavailable,
  enrichment_status, enrichment_error, enriched_at, created_at, updated_at,
  venue_name, venue_neighborhood, venue_address
`

export async function getEventsWithVenues(limit = 50) {
  // Explicit columns, no embedding — the 1536-dim vectors bloat responses
  // (1000 events ≈ 24MB) and no caller reads them from this fetch.
  const { data, error } = await getSupabase()
    .from('events_with_venues')
    .select(EVENT_ADMIN_COLUMNS)
    .order('starts_at', { ascending: true })
    .limit(limit)

  if (error) throw error
  return data as EventWithVenue[]
}

/**
 * Events on the home grid must start in the evening at the earliest —
 * 6 PM Buenos Aires time, matching the search tool's "tonight" definition.
 */
const EVENING_START_HOUR = 18

/**
 * Fetch the next upcoming events for the chat home "Happening soon" grid.
 * Chat columns only (no embedding), soonest first, capped at `limit`.
 *
 * Only events with complete, actionable info make the grid: a real start
 * time (date + time), an actual location (venue name, neighborhood, or
 * address — not TBA), a description, and a photo. Events lacking any of
 * these are excluded so every card shows where the event happens, what it
 * is, and what it looks like.
 *
 * Events must start in the evening at the earliest (6 PM Buenos Aires
 * time) — the grid is a nightlife surface. If it's already evening in BA,
 * the earliest slot rolls to tomorrow evening so we never surface a night
 * that's already in progress.
 */
export async function getTrendingEvents(limit = 8): Promise<ChatEventPayload[]> {
  const nowBA = toZonedTime(new Date(), BA_TIMEZONE)
  const eveningStart = getHours(nowBA) >= EVENING_START_HOUR ? 1 : 0
  const earliestEveningBA = setHours(
    startOfDay(addDays(nowBA, eveningStart)),
    EVENING_START_HOUR
  )
  const earliestStartUTC = fromZonedTime(earliestEveningBA, BA_TIMEZONE).toISOString()

  const { data, error } = await getSupabase()
    .from('events_with_venues')
    .select(CHAT_EVENT_COLUMNS)
    .neq('status', 'past')
    .gte('starts_at', earliestStartUTC)
    // The grid is a nightlife surface: no daytime events, and no nights
    // that are already in progress (if it's past 6 PM, roll to tomorrow).
    .eq('location_tba', false)
    .eq('description_unavailable', false)
    // Every card must have a photo.
    .not('image_url', 'is', null)
    .neq('image_url', '')
    // Must have BOTH a location (any of name/neighborhood/address) AND a
    // description (any locale/summary/display). Two .or() groups keep the
    // clauses ANDed — a single .or() would accept venue-only or desc-only.
    .or('venue_name.not.is.null,venue_neighborhood.not.is.null,venue_address.not.is.null')
    .or(
      'description_summary_es.not.is.null,description_summary_en.not.is.null,' +
        'description_display_es.not.is.null,description_display_en.not.is.null'
    )
    .order('starts_at', { ascending: true })
    .limit(limit)

  if (error) throw error
  return data as ChatEventPayload[]
}

// ============================================================================
// LIGHTWEIGHT ADMIN LIST QUERIES (Performance Optimized)
// ============================================================================

export async function getEventWithVenue(id: string) {
  const { data, error } = await getSupabase()
    .from('events_with_venues')
    .select('*')
    .eq('id', id)
    .single()

  if (error) throw error
  return data as EventWithVenue
}

export async function createEvent(event: EventInsert, client?: SupabaseClient) {
  const db = client ?? getSupabase()
  const { data, error } = await db
    .from('events')
    .insert(event)
    .select()
    .single()

  if (error) throw error
  return data as Event
}

// ============================================================================
// SEARCH OPERATIONS
// ============================================================================

// Filter-based search (for structured queries)
export async function searchEventsWithFilters(filters: EventFilters, limit: number = 50): Promise<ChatEventPayload[]> {
  let query = getSupabase().from('events_with_venues').select(CHAT_EVENT_COLUMNS)

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
  if (filters.minAge !== undefined) {
    // Events the attendee (aged filters.minAge) is allowed into
    query = query.or(`min_age.is.null,min_age.lte.${filters.minAge}`)
  }

  query = query.order('starts_at', { ascending: true }).limit(limit)

  const { data, error } = await query
  if (error) throw error
  return data as ChatEventPayload[]
}

// Count scheduled events matching the given filters (ignores `limit`). Used to
// report search coverage so the model knows how much it searched vs. returned.
// Mirrors the predicate in searchEventsWithFilters.
export async function countEventsWithFilters(filters: EventFilters): Promise<number> {
  let query = getSupabase()
    .from('events_with_venues')
    .select('id', { count: 'exact', head: true })
    .eq('status', filters.status || 'scheduled')

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
  if (filters.minAge !== undefined) {
    // Mirrors the predicate in searchEventsWithFilters
    query = query.or(`min_age.is.null,min_age.lte.${filters.minAge}`)
  }

  const { count, error } = await query
  if (error) throw error
  return count ?? 0
}

// Furthest future start date of any scheduled event. The source of truth for
// "what's the event furthest into the future" and for the coverage guard.
export async function getFurthestEventDate(): Promise<string | null> {
  const { data, error } = await getSupabase()
    .from('events')
    .select('starts_at')
    .eq('status', 'scheduled')
    .order('starts_at', { ascending: false })
    .limit(1)

  if (error) throw error
  return data?.[0]?.starts_at ?? null
}

// Get events happening now or starting soon
export async function getEventsHappeningNow(): Promise<ChatEventPayload[]> {
  const now = new Date().toISOString()

  const { data, error } = await getSupabase()
    .from('events_with_venues')
    .select(CHAT_EVENT_COLUMNS)
    .eq('status', 'scheduled')
    .lte('starts_at', now)
    .or(`ends_at.is.null,ends_at.gte.${now}`)
    .order('starts_at', { ascending: true })

  if (error) throw error
  return data as ChatEventPayload[]
}

// Hybrid semantic + filter search (filtering done in PostgreSQL for performance)
export async function hybridEventSearch(
  query: string,
  filters: EventFilters,
  matchCount = 10
): Promise<ChatEventPayload[]> {
  // Generate embedding for the search query
  const queryEmbedding = await generateEmbedding(query)

  // Call the PostgreSQL function with all filters applied server-side
  const { data, error } = await getSupabase().rpc(
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
      filter_min_age: filters.minAge ?? null,
    }
  )

  if (error) throw error
  return (data as ChatEventPayload[]) || []
}

// ============================================================================
// UPSERT OPERATIONS (for scrapers)
// ============================================================================

// ============================================================================
// STATS OPERATIONS (optimized with COUNT queries)
// ============================================================================
