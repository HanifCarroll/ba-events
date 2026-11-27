import type {
  EventWithVenue,
  EventStatus,
  ChatEventPayload,
  EventFilters,
  PublicEventRecord,
} from '../types.ts'
import { generateEmbedding } from '../ai/embeddings.ts'
import { rrfFuse } from '../search/rrf.ts'
import { withReadSignal } from './read-signal.ts'
import { eventColumnsWith } from './event-columns.ts'
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
  discoveryAgendaD1,
  enabledInstagramSourceCountD1,
  eventArtworkD1,
  eventByIdD1,
  eventsByIdsD1,
  eventsByStartD1,
  homeAgendaD1,
  upcomingEventSitemapRowsD1,
  venueByIdD1,
} from './event-reads-d1.server.ts'
import type { HomeWindow } from '#features/events/lib/home-feed.ts'

const boundCatalogD1 = () => cloudflareSearchBackend().db

function requireRow<T>(row: T | null, what: string): T {
  if (!row) throw new Error(`${what} not found`)
  return row
}

/** Project only the columns each public surface exposes. */
function pickColumns<T>(row: object, columns: string): T {
  const record = row as Record<string, unknown>
  return Object.fromEntries(columns.split(',').map(column => column.trim()).filter(Boolean)
    .map(column => [column, record[column]])) as T
}

export async function getVenueById(id: string, abortSignal?: AbortSignal) {
  return withReadSignal(async () => requireRow(await venueByIdD1(boundCatalogD1(), id), 'Venue'), abortSignal)
}

export async function searchVenuesByName(query: string, abortSignal?: AbortSignal) {
  return withReadSignal(() => searchVenuesByNameD1(boundCatalogD1(), query), abortSignal)
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

// Columns needed by chat tools and event cards.
const PUBLIC_EVENT_COLUMNS = [
  ...eventColumnsWith('public', 'card'), 'venue_name', 'venue_neighborhood', 'venue_address',
].join(', ')

export async function getEventsWithVenues(limit = 50) {
  return (await eventsByStartD1(boundCatalogD1(), limit)).map(row => pickColumns<EventWithVenue>(row, EVENT_ADMIN_COLUMNS))
}

export async function getHomeAgendaEvents(window: HomeWindow) {
  return homeAgendaD1(boundCatalogD1(), window)
}

export const getDiscoveryAgendaEvents = (window: HomeWindow) => discoveryAgendaD1(boundCatalogD1(), window)
export const getEnabledInstagramSourceCount = () => enabledInstagramSourceCountD1(boundCatalogD1())

export function getUpcomingEventSitemapRows(asOf: Date) {
  return upcomingEventSitemapRowsD1(boundCatalogD1(), asOf)
}

/** Catalog-mediated image lookup: callers cannot supply upstream URLs. */
export async function getEventArtwork(id: string, signal?: AbortSignal) {
  return withReadSignal(() => eventArtworkD1(boundCatalogD1(), id), signal)
}

// ============================================================================
// LIGHTWEIGHT ADMIN LIST QUERIES (Performance Optimized)
// ============================================================================

/** Public read boundary: only displayable statuses and explicit public columns. */
export async function getDisplayableEventById(id: string, abortSignal?: AbortSignal): Promise<PublicEventRecord | null> {
  const row = await withReadSignal(() => eventByIdD1(boundCatalogD1(), id, true), abortSignal)
  return row ? pickColumns<PublicEventRecord>(row, PUBLIC_EVENT_COLUMNS) : null
}

export async function getEventWithVenue(id: string, abortSignal?: AbortSignal) {
  return withReadSignal(async () => requireRow(await eventByIdD1(boundCatalogD1(), id), 'Event') as unknown as EventWithVenue, abortSignal)
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

  const rows = await withReadSignal(() => eventsByIdsD1(boundCatalogD1(), unique), abortSignal)
  return rows.map(row => pickColumns<{
    id: string
    name: string
    venue_id: string | null
    venue_name: string | null
    status: EventStatus
    location_hidden: boolean
    location_tba: boolean
  }>(row, FACT_COLUMNS)).map(({ location_hidden, location_tba, ...fact }) => ({
    ...fact, venue_id: location_hidden || location_tba ? null : fact.venue_id,
  }))
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
  return withReadSignal(async () => applyAvoidGenres(await searchEventsWithFiltersD1(boundCatalogD1(), filters, limit), filters.avoidGenres), abortSignal)
}

// Count scheduled events matching the given filters (ignores `limit`). Used to
// report search coverage so the model knows how much it searched vs. returned.
// Mirrors the predicate in searchEventsWithFilters.
export async function countEventsWithFilters(filters: EventFilters, abortSignal?: AbortSignal): Promise<number> {
  return withReadSignal(() => countEventsWithFiltersD1(boundCatalogD1(), filters), abortSignal)
}

// Furthest future start date of any scheduled event. The source of truth for
// "what's the event furthest into the future" and for the coverage guard.
export async function getFurthestEventDate(abortSignal?: AbortSignal): Promise<string | null> {
  return withReadSignal(() => getFurthestEventDateD1(boundCatalogD1()), abortSignal)
}

// Get events happening now or starting soon
export async function getEventsHappeningNow(abortSignal?: AbortSignal): Promise<ChatEventPayload[]> {
  return withReadSignal(() => getEventsHappeningNowD1(boundCatalogD1()), abortSignal)
}

export async function semanticEventSearch(
  query: string,
  filters: EventFilters,
  matchCount = 10,
  abortSignal?: AbortSignal,
  dependencies: { embedQuery?: typeof generateEmbedding } = {},
): Promise<ChatEventPayload[]> {
  // Empty/whitespace queries have no retrieval text — do NOT embed a blank
  // string. The filter-only path is the caller's responsibility.
  abortSignal?.throwIfAborted()
  if (!query.trim()) return []

  const { db, vectorize } = cloudflareSearchBackend()
  if (!vectorize) throw new Error('Semantic search on D1 needs the VECTORIZE binding')
  const queryEmbedding = await (dependencies.embedQuery ?? generateEmbedding)(query, abortSignal)
  return withReadSignal(() => semanticEventSearchD1(db, vectorize, queryEmbedding, filters, matchCount, abortSignal), abortSignal)
}

// Lexical (full-text) search over the events search document, with the same
// filter surface applied server-side. Orders by FTS5 bm25.
export async function lexicalEventSearch(
  query: string,
  filters: EventFilters,
  matchCount = 50,
  abortSignal?: AbortSignal,
): Promise<ChatEventPayload[]> {
  abortSignal?.throwIfAborted()
  if (!query.trim()) return []

  return withReadSignal(() => lexicalEventSearchD1(boundCatalogD1(), query, filters, matchCount, abortSignal), abortSignal)
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
