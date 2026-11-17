import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { addHours } from 'date-fns'

// Re-export SupabaseClient type for use in other modules
export type { SupabaseClient }

import type {
  Event,
  EventInsert,
  EventWithVenue,
  EventStatus,
  ChatEventPayload,
  EventFilters,
  PublicEventRecord,
  Venue,
  VenueInsert,
} from '../types.ts'
import { generateEmbedding } from '../ai/embeddings.ts'
import { rrfFuse } from '../search/rrf.ts'
import { withReadSignal } from './read-signal.ts'
import { cloudflareSearchBackend } from './search-bindings.server.ts'
import {
  countEventsWithFiltersD1,
  getEventsHappeningNowD1,
  getFurthestEventDateD1,
  lexicalEventSearchD1,
  searchEventsWithFiltersD1,
  searchVenuesByNameD1,
  semanticEventSearchD1,
} from './search-d1.server.ts'
import {
  eventArtworkD1,
  eventByIdD1,
  eventsByIdsD1,
  eventsByStartD1,
  happeningSoonD1,
  venueByIdD1,
} from './event-reads-d1.server.ts'
import type { HomeEventCard } from '#features/events/lib/home-feed.ts'
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

/** The D1 database when the Worker binds one (staging until the cutover), else null (read Supabase). */
const boundCatalogD1 = () => cloudflareSearchBackend()?.db ?? null

/** Mirrors PostgREST's `.single()` on no rows, which the callers treat as not found. */
function requireRow<T>(row: T | null, what: string): T {
  if (!row) throw new Error(`${what} not found`)
  return row
}

/** Keeps the columns a Supabase `.select(columns)` returns, so a D1 row has the same keys. */
function pickColumns<T>(row: object, columns: string): T {
  const record = row as Record<string, unknown>
  return Object.fromEntries(columns.split(',').map(column => column.trim()).filter(Boolean)
    .map(column => [column, record[column]])) as T
}

export async function getVenueById(id: string, abortSignal?: AbortSignal) {
  const d1 = boundCatalogD1()
  if (d1) return requireRow(await venueByIdD1(d1, id), 'Venue')
  const { data, error } = await withReadSignal(getSupabase()
    .from('venues')
    .select('*')
    .eq('id', id), abortSignal)
    .single()

  if (error) throw error
  return data as Venue
}

export async function searchVenuesByName(query: string, abortSignal?: AbortSignal) {
  const cloudflare = cloudflareSearchBackend()
  if (cloudflare) return searchVenuesByNameD1(cloudflare.db, query)
  const { data, error } = await withReadSignal(getSupabase()
    .from('venues')
    .select('*')
    .ilike('name', `%${query}%`)
    .order('name', { ascending: true })
    .limit(20), abortSignal)

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
  description_summary_es, description_summary_en, starts_at, ends_at, is_all_day, time_tba,
  venue_id, categories, price, is_free, min_age, image_url, image_width, image_height, link, ticket_url,
  source, external_id, status, location_hidden, enrichment_status, enrichment_error,
  enriched_at, created_at, updated_at,
  venue_name, venue_neighborhood, venue_address
`

// Columns needed by chat tools and event cards. Excludes embedding so vectors do
// not leave the database for chat display or message attachment paths.
const PUBLIC_EVENT_COLUMNS = `
  id, name, description_display_es, description_display_en, description_summary_es, description_summary_en,
  starts_at, ends_at, is_all_day, time_tba, venue_id, categories, price, is_free, min_age, image_url,
  link, ticket_url, status, location_hidden, venue_name, venue_neighborhood, venue_address
`

const CHAT_EVENT_COLUMNS = `
  id, name, description_es, description_en, description_display_es, description_display_en,
  description_summary_es, description_summary_en, starts_at, ends_at, is_all_day, time_tba,
  venue_id, categories, price, is_free, min_age, image_url, image_width, image_height, link, ticket_url,
  source, external_id, status, location_hidden, location_tba, description_unavailable,
  enrichment_status, enrichment_error, enriched_at, created_at, updated_at,
  venue_name, venue_neighborhood, venue_address,
  facets
`

export async function getEventsWithVenues(limit = 50) {
  const d1 = boundCatalogD1()
  if (d1) return (await eventsByStartD1(d1, limit)).map(row => pickColumns<EventWithVenue>(row, EVENT_ADMIN_COLUMNS))
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
 * Next upcoming events for the home "Happening soon" grid.
 * Chat columns only (no embedding), soonest first, capped at `limit`.
 *
 * Only events with complete, actionable info make the grid: a real start
 * time (date + time), an actual location (venue name, neighborhood, or
 * address — not TBA), a description, and a photo. Events lacking any of
 * these are excluded so every card shows where the event happens, what it
 * is, and what it looks like.
 *
 * Floor is now + 12 hours, rolling. Daytime events can appear if they
 * start at least 12 hours out; a night already in progress does not.
 */
const HOME_CARD_COLUMNS = 'id, name, starts_at, time_tba, image_url, image_width, image_height, venue_name, venue_neighborhood, price, is_free'

export async function getHappeningSoonEvents(limit = 4): Promise<HomeEventCard[]> {
  const earliestStartUTC = addHours(new Date(), 12).toISOString()
  const d1 = boundCatalogD1()
  if (d1) return (await happeningSoonD1(d1, earliestStartUTC, limit)).map(row => pickColumns<HomeEventCard>(row, HOME_CARD_COLUMNS))

  const { data, error } = await getSupabase()
    .from('events_with_venues')
    .select(HOME_CARD_COLUMNS)
    .eq('status', 'scheduled')
    .gte('starts_at', earliestStartUTC)
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
  return data as HomeEventCard[]
}

/** Catalog-mediated image lookup: callers cannot supply upstream URLs. */
export async function getEventArtwork(id: string, signal?: AbortSignal) {
  const d1 = boundCatalogD1()
  if (d1) return eventArtworkD1(d1, id)
  const { data, error } = await withReadSignal(getSupabase().from('events')
    .select('image_url').eq('id', id).in('status', ['scheduled', 'past']), signal).maybeSingle()
  if (error) throw error
  return data as { image_url: string | null } | null
}

// ============================================================================
// LIGHTWEIGHT ADMIN LIST QUERIES (Performance Optimized)
// ============================================================================

/** Public read boundary: only displayable statuses and explicit public columns. */
export async function getDisplayableEventById(id: string, abortSignal?: AbortSignal): Promise<PublicEventRecord | null> {
  const d1 = boundCatalogD1()
  if (d1) {
    const row = await eventByIdD1(d1, id, true)
    return row ? pickColumns<PublicEventRecord>(row, PUBLIC_EVENT_COLUMNS) : null
  }
  const { data, error } = await withReadSignal(getSupabase()
    .from('events_with_venues')
    .select(PUBLIC_EVENT_COLUMNS)
    .eq('id', id)
    .in('status', ['scheduled', 'past']), abortSignal)
    .maybeSingle()

  abortSignal?.throwIfAborted()
  if (error) throw error
  return (data as PublicEventRecord | null) ?? null
}

export async function getEventWithVenue(id: string, abortSignal?: AbortSignal) {
  const d1 = boundCatalogD1()
  if (d1) return requireRow(await eventByIdD1(d1, id), 'Event') as unknown as EventWithVenue
  const { data, error } = await withReadSignal(getSupabase()
    .from('events_with_venues')
    .select('*')
    .eq('id', id), abortSignal)
    .single()

  if (error) throw error
  return data as EventWithVenue
}

// ============================================================================
// BOUNDED REHYDRATION (chat follow-up context)
// ============================================================================

/**
 * Re-fetch minimal event facts for follow-up context rehydration, in ONE
 * bounded query. Callers pass untrusted ids (parsed from client/persisted
 * canonicals); only id/name/venue/status facts are returned — never embedding
 * or other internal columns. Non-displayable filtering (status) is the pure
 * caller's responsibility (`isDisplayableStatus` in the agent follow-up module).
 */
const FACT_COLUMNS = 'id, name, venue_id, venue_name, status, location_hidden, location_tba'

export async function getEventFactsByIds(
  ids: string[],
  abortSignal?: AbortSignal,
  client?: SupabaseClient
): Promise<
  Array<{
    id: string
    name: string
    venue_id: string | null
    venue_name: string | null
    status: EventStatus
  }>
> {
  const unique = [
    ...new Set(ids.filter((id) => typeof id === 'string' && id.length > 0)),
  ].slice(0, 100)
  if (unique.length === 0) return []

  const d1 = client ? null : boundCatalogD1()
  const { data, error } = d1
    ? { data: (await eventsByIdsD1(d1, unique)).map(row => pickColumns<object>(row, FACT_COLUMNS)), error: null }
    : await withReadSignal((client ?? getSupabase())
      .from('events_with_venues')
      .select(FACT_COLUMNS)
      .in('id', unique)
      .limit(100), abortSignal)

  if (error) throw error
  return ((data ?? []) as unknown as Array<{
    id: string
    name: string
    venue_id: string | null
    venue_name: string | null
    status: EventStatus
    location_hidden: boolean
    location_tba: boolean
  }>).map(({ location_hidden, location_tba, ...fact }) => ({
    ...fact, venue_id: location_hidden || location_tba ? null : fact.venue_id,
  }))
}

export async function createEvent(event: EventInsert, client?: SupabaseClient) {
  // shortcut: POST /api/events has no D1 write (no production event has source 'api'); refuse rather than write to Supabase behind D1's back.
  if (!client && boundCatalogD1()) throw new Error('Creating events through the API is not available on D1')
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

// Hard avoid-genre exclude, applied in memory on already-fetched events. An
// event is excluded only if its `facets.genres` actually overlaps the avoided
// list; events with no facets or no genres stay eligible (a missing/empty
// genres array cannot contain an avoided genre).
export function applyAvoidGenres<T extends { facets?: { genres?: string[] } | null }>(
  rows: T[],
  avoidGenres?: string[]
): T[] {
  if (!avoidGenres || avoidGenres.length === 0) return rows
  return rows.filter((e) => {
    const genres = e.facets?.genres
    if (!genres || genres.length === 0) return true
    return !avoidGenres.some((g) => genres.includes(g))
  })
}

// Filter-based search (for structured queries)
export async function searchEventsWithFilters(filters: EventFilters, limit: number = 50, abortSignal?: AbortSignal): Promise<ChatEventPayload[]> {
  const cloudflare = cloudflareSearchBackend()
  if (cloudflare) return applyAvoidGenres(await searchEventsWithFiltersD1(cloudflare.db, filters, limit), filters.avoidGenres)
  let query = getSupabase().from('events_with_venues').select(CHAT_EVENT_COLUMNS)

  // Default to scheduled events
  query = query.eq('status', filters.status || 'scheduled')

  if (filters.startsAfter) {
    query = query.gte('starts_at', filters.startsAfter)
  }
  if (filters.startsBefore) {
    query = query.lte('starts_at', filters.startsBefore)
  }
  if (filters.neighborhoods && filters.neighborhoods.length > 0) {
    query = query.in('venue_neighborhood', filters.neighborhoods)
  }
  if (filters.venueIds && filters.venueIds.length > 0) {
    query = query.in('venue_id', filters.venueIds)
  }
  if (filters.categories && filters.categories.length > 0) {
    query = query.overlaps('categories', filters.categories)
  }
  if (filters.isFree !== undefined) {
    query = query.eq('is_free', filters.isFree)
  }
  if (filters.maxPrice !== undefined) {
    query = query.lte('price', filters.maxPrice)
  }
  if (filters.minAge !== undefined) {
    // Events the attendee (aged filters.minAge) is allowed into
    query = query.or(`min_age.is.null,min_age.lte.${filters.minAge}`)
  }

  query = query.order('starts_at', { ascending: true }).limit(limit)

  const { data, error } = await withReadSignal(query, abortSignal)
  if (error) throw error
  const results = data as ChatEventPayload[]
  return applyAvoidGenres(results, filters.avoidGenres)
}

// Count scheduled events matching the given filters (ignores `limit`). Used to
// report search coverage so the model knows how much it searched vs. returned.
// Mirrors the predicate in searchEventsWithFilters.
export async function countEventsWithFilters(filters: EventFilters, abortSignal?: AbortSignal): Promise<number> {
  const cloudflare = cloudflareSearchBackend()
  if (cloudflare) return countEventsWithFiltersD1(cloudflare.db, filters)
  // Avoid genres can't be expressed as a PostgREST filter (the `ov` operator on
  // a `facets->genres` jsonb path errors, and `cs`/overlap mishandles events
  // with no genres key). So when avoid is present we fetch matched `facets` and
  // apply the hard exclude in memory. The corpus is small and `avoid` is rare.
  const needAvoid = !!filters.avoidGenres && filters.avoidGenres.length > 0

  if (needAvoid) {
    // Avoid genres can't be expressed as a PostgREST filter (the `ov` operator
    // on a `facets->genres` jsonb path errors, and `cs`/overlap mishandles
    // events with no genres key). Fetch matched events' facets in pages and
    // apply the hard exclude in memory. PostgREST caps a single response at
    // 1000 rows, so page through in blocks below that.
    const PAGE = 1000
    let kept = 0
    let offset = 0
    for (;;) {
      let q = getSupabase()
        .from('events_with_venues')
        .select('id, facets')
        .eq('status', filters.status || 'scheduled')

      if (filters.startsAfter) q = q.gte('starts_at', filters.startsAfter)
      if (filters.startsBefore) q = q.lte('starts_at', filters.startsBefore)
      if (filters.neighborhoods && filters.neighborhoods.length > 0) {
        q = q.in('venue_neighborhood', filters.neighborhoods)
      }
      if (filters.venueIds && filters.venueIds.length > 0) {
        q = q.in('venue_id', filters.venueIds)
      }
      if (filters.categories && filters.categories.length > 0) {
        q = q.overlaps('categories', filters.categories)
      }
      if (filters.isFree !== undefined) q = q.eq('is_free', filters.isFree)
      if (filters.maxPrice !== undefined) q = q.lte('price', filters.maxPrice)
      if (filters.minAge !== undefined) q = q.or(`min_age.is.null,min_age.lte.${filters.minAge}`)

      const { data, error } = await withReadSignal(q
        .order('starts_at', { ascending: true })
        .range(offset, offset + PAGE - 1), abortSignal)
      if (error) throw error
      if (!data || data.length === 0) break
      const rows = applyAvoidGenres(data as ChatEventPayload[], filters.avoidGenres!)
      kept += rows.length
      offset += data.length
      if (data.length < PAGE) break
    }
    return kept
  }

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
  if (filters.neighborhoods && filters.neighborhoods.length > 0) {
    query = query.in('venue_neighborhood', filters.neighborhoods)
  }
  if (filters.venueIds && filters.venueIds.length > 0) {
    query = query.in('venue_id', filters.venueIds)
  }
  if (filters.categories && filters.categories.length > 0) {
    query = query.overlaps('categories', filters.categories)
  }
  if (filters.isFree !== undefined) {
    query = query.eq('is_free', filters.isFree)
  }
  if (filters.maxPrice !== undefined) {
    query = query.lte('price', filters.maxPrice)
  }
  if (filters.minAge !== undefined) {
    // Mirrors the predicate in searchEventsWithFilters
    query = query.or(`min_age.is.null,min_age.lte.${filters.minAge}`)
  }

  const { count, error } = await withReadSignal(query, abortSignal)
  if (error) throw error
  return count ?? 0
}

// Furthest future start date of any scheduled event. The source of truth for
// "what's the event furthest into the future" and for the coverage guard.
export async function getFurthestEventDate(abortSignal?: AbortSignal): Promise<string | null> {
  const cloudflare = cloudflareSearchBackend()
  if (cloudflare) return getFurthestEventDateD1(cloudflare.db)
  const { data, error } = await withReadSignal(getSupabase()
    .from('events')
    .select('starts_at')
    .eq('status', 'scheduled')
    .order('starts_at', { ascending: false })
    .limit(1), abortSignal)

  if (error) throw error
  return data?.[0]?.starts_at ?? null
}

// Get events happening now or starting soon
export async function getEventsHappeningNow(abortSignal?: AbortSignal): Promise<ChatEventPayload[]> {
  const cloudflare = cloudflareSearchBackend()
  if (cloudflare) return getEventsHappeningNowD1(cloudflare.db)
  const now = new Date().toISOString()

  const { data, error } = await withReadSignal(getSupabase()
    .from('events_with_venues')
    .select(CHAT_EVENT_COLUMNS)
    .eq('status', 'scheduled')
    .lte('starts_at', now)
    .or(`ends_at.is.null,ends_at.gte.${now}`)
    .order('starts_at', { ascending: true }), abortSignal)

  if (error) throw error
  return data as ChatEventPayload[]
}

// Dense (vector) semantic search with filter application done in PostgreSQL, or in Vectorize and D1 when the
// Worker binds them (search-bindings.server.ts).
interface SearchReadDependencies {
  client?: SupabaseClient
  embedQuery?: typeof generateEmbedding
}

export async function semanticEventSearch(
  query: string,
  filters: EventFilters,
  matchCount = 10,
  abortSignal?: AbortSignal,
  dependencies: SearchReadDependencies = {},
): Promise<ChatEventPayload[]> {
  // Empty/whitespace queries have no retrieval text — do NOT embed a blank
  // string. The filter-only path is the caller's responsibility.
  abortSignal?.throwIfAborted()
  if (!query.trim()) return []

  const cloudflare = dependencies.client ? null : cloudflareSearchBackend()
  if (cloudflare && !cloudflare.vectorize) throw new Error('Semantic search on D1 needs the VECTORIZE binding')

  // Generate embedding for the search query
  const queryEmbedding = await (dependencies.embedQuery ?? generateEmbedding)(query, abortSignal)
  if (cloudflare) return semanticEventSearchD1(cloudflare.db, cloudflare.vectorize!, queryEmbedding, filters, matchCount)

  // Call the PostgreSQL function with all filters applied server-side
  const { data, error } = await withReadSignal((dependencies.client ?? getSupabase()).rpc(
    'match_events_with_venues_filtered',
    {
      query_embedding: queryEmbedding,
      match_threshold: 0.2,
      match_count: matchCount,
      filter_starts_after: filters.startsAfter || null,
      filter_starts_before: filters.startsBefore || null,
      filter_neighborhoods: filters.neighborhoods && filters.neighborhoods.length > 0 ? filters.neighborhoods : null,
      filter_venue_ids: filters.venueIds && filters.venueIds.length > 0 ? filters.venueIds : null,
      filter_is_free: filters.isFree ?? null,
      filter_max_price: filters.maxPrice ?? null,
      filter_categories: filters.categories && filters.categories.length > 0 ? filters.categories : null,
      filter_min_age: filters.minAge ?? null,
      filter_avoid_genres: filters.avoidGenres && filters.avoidGenres.length > 0 ? filters.avoidGenres : null,
    }
  ), abortSignal)

  if (error) throw error
  return (data as ChatEventPayload[]) || []
}

// Lexical (full-text) search over the events search document, with the same
// filter surface applied server-side. Orders by ts_rank_cd (bm25 on D1).
export async function lexicalEventSearch(
  query: string,
  filters: EventFilters,
  matchCount = 50,
  abortSignal?: AbortSignal,
  dependencies: Pick<SearchReadDependencies, 'client'> = {},
): Promise<ChatEventPayload[]> {
  abortSignal?.throwIfAborted()
  if (!query.trim()) return []

  const cloudflare = dependencies.client ? null : cloudflareSearchBackend()
  if (cloudflare) return lexicalEventSearchD1(cloudflare.db, query, filters, matchCount)

  const { data, error } = await withReadSignal((dependencies.client ?? getSupabase()).rpc(
    'lexical_match_events_with_venues',
    {
      query,
      match_count: matchCount,
      filter_starts_after: filters.startsAfter || null,
      filter_starts_before: filters.startsBefore || null,
      filter_neighborhoods: filters.neighborhoods && filters.neighborhoods.length > 0 ? filters.neighborhoods : null,
      filter_venue_ids: filters.venueIds && filters.venueIds.length > 0 ? filters.venueIds : null,
      filter_is_free: filters.isFree ?? null,
      filter_max_price: filters.maxPrice ?? null,
      filter_categories: filters.categories && filters.categories.length > 0 ? filters.categories : null,
      filter_min_age: filters.minAge ?? null,
      filter_avoid_genres: filters.avoidGenres && filters.avoidGenres.length > 0 ? filters.avoidGenres : null,
    }
  ), abortSignal)

  if (error) throw error
  return (data as ChatEventPayload[]) || []
}

// Hybrid retrieval: dense (semanticEventSearch) + lexical (lexicalEventSearch)
// in parallel, fused by Reciprocal Rank Fusion to `candidateLimit` rows.
// An empty/whitespace query has no retrieval text and must NOT embed — the
// filter-only path is the caller's responsibility and never reaches here.
export async function hybridEventSearch(
  query: string,
  filters: EventFilters,
  candidateLimit = 50,
  abortSignal?: AbortSignal
): Promise<ChatEventPayload[]> {
  abortSignal?.throwIfAborted()
  if (!query.trim()) return []

  const [semanticResults, lexicalResults] = await Promise.all([
    semanticEventSearch(query, filters, candidateLimit, abortSignal),
    lexicalEventSearch(query, filters, candidateLimit, abortSignal),
  ])

  return rrfFuse([semanticResults, lexicalResults], { limit: candidateLimit })
}

// ============================================================================
// UPSERT OPERATIONS (for scrapers)
// ============================================================================

// ============================================================================
// STATS OPERATIONS (optimized with COUNT queries)
// ============================================================================
