/** Catalog and search queries on D1 (FTS5) and Vectorize. */
import { Schema } from 'effect'
import type { D1Database, VectorizeIndex } from '@cloudflare/workers-types'
import type { ChatEventPayload, EventFilters, Venue } from '../types.ts'
import { BA_TIMEZONE } from '../constants.ts'
import { tsRankCd, websearchToFts5 } from '../search/websearch-fts5.ts'

/** Vectorize returns at most 100 matches when it doesn't return values or metadata. */
export const VECTORIZE_TOP_K = 100
/** The cosine similarity a semantic match must exceed, as in `match_events_with_venues_filtered`. */
export const SEMANTIC_MATCH_THRESHOLD = 0.2

/** The `events_with_venues` columns (without embedding and search_document), over events e and venues v. */
export const EVENT_COLUMNS = `e.id, e.name, e.description_es, e.description_en, e.description_display_es, e.description_display_en,
  e.description_summary_es, e.description_summary_en, e.starts_at, e.ends_at, e.doors_at, e.is_all_day, e.time_tba, e.venue_id,
  e.categories, e.price, e.is_free, e.min_age, e.image_url, e.image_width, e.image_height, e.link, e.ticket_url, e.source,
  e.external_id, e.status, e.location_hidden, e.location_tba, e.description_unavailable, e.enrichment_status,
  e.enrichment_error, e.enriched_at, e.created_at, e.updated_at, v.name AS venue_name, v.neighborhood AS venue_neighborhood,
  v.address AS venue_address, e.facets`
export const FROM_EVENTS = 'events e LEFT JOIN venues v ON v.id = e.venue_id'

const text = Schema.NullOr(Schema.String)
const integer = Schema.NullOr(Schema.Int)
const price = Schema.NullOr(Schema.Finite)
/** A row of EVENT_COLUMNS as D1 returns it, before decoding the public search projection. */
const EventRow = Schema.Struct({
  id: Schema.String, name: Schema.String,
  description_es: text, description_en: text, description_display_es: text, description_display_en: text,
  description_summary_es: text, description_summary_en: text,
  starts_at: Schema.String, ends_at: text, doors_at: text, is_all_day: Schema.BooleanFromBit, time_tba: Schema.BooleanFromBit,
  venue_id: text, categories: Schema.fromJsonString(Schema.Array(Schema.String)), price,
  is_free: Schema.BooleanFromBit, min_age: integer, image_url: text, image_width: integer, image_height: integer,
  link: text, ticket_url: text, source: Schema.String, external_id: text, status: Schema.String,
  location_hidden: Schema.NullOr(Schema.BooleanFromBit), location_tba: Schema.BooleanFromBit,
  description_unavailable: Schema.BooleanFromBit, enrichment_status: Schema.String, enrichment_error: text,
  enriched_at: text, created_at: Schema.String, updated_at: Schema.String,
  venue_name: text, venue_neighborhood: text, venue_address: text,
  facets: Schema.fromJsonString(Schema.Unknown),
})
const decodeEvent = Schema.decodeUnknownSync(EventRow)
/** Decodes one EVENT_COLUMNS row to the public event projection. */
export const toPayload = (row: unknown) => decodeEvent(row) as unknown as ChatEventPayload

const iso = (value: string) => new Date(value).toISOString()
const list = (values: readonly string[] | undefined) => (values && values.length > 0 ? JSON.stringify(values) : null)

type Where = { sql: string[]; values: unknown[] }

/**
 * Lexical and semantic searches let an unpriced event through a price cap
 * (`priceCap: 'or-null'`); the filter-only reads compare the price itself, so an unpriced event fails (`'strict'`).
 * The filter-only list applies avoided genres after decoding its bounded result.
 */
function filterSql(filters: EventFilters, options: { priceCap: 'or-null' | 'strict'; avoidGenres: boolean }): Where {
  const where: Where = { sql: ["e.scope = 'in'"], values: [] }
  const add = (sql: string, ...values: unknown[]) => { where.sql.push(sql); where.values.push(...values) }
  if (filters.today) {
    const { dayStart, dayEnd, now, explicitStart } = filters.today
    add(`(((e.time_tba = 1 OR e.is_all_day = 1) AND e.starts_at >= ? AND e.starts_at < ?) OR
      (e.time_tba = 0 AND e.is_all_day = 0 AND (e.starts_at >= ? OR e.ends_at > ?)))`,
      iso(dayStart), iso(dayEnd), iso(now), iso(now))
    if (explicitStart) add('e.starts_at >= ?', iso(explicitStart))
  } else if (filters.startsAfter) add('e.starts_at >= ?', iso(filters.startsAfter))
  if (filters.startsBefore) add(filters.today ? 'e.starts_at < ?' : 'e.starts_at <= ?', iso(filters.startsBefore))
  const excludedIds = list(filters.excludeEventIds)
  if (excludedIds) add('e.id NOT IN (SELECT value FROM json_each(?))', excludedIds)
  const neighborhoods = list(filters.neighborhoods)
  if (neighborhoods) add('v.neighborhood IN (SELECT value FROM json_each(?))', neighborhoods)
  const venueIds = list(filters.venueIds)
  if (venueIds) add('e.venue_id IN (SELECT value FROM json_each(?))', venueIds)
  const categories = list(filters.categories)
  if (categories) add('EXISTS (SELECT 1 FROM json_each(e.categories) c WHERE c.value IN (SELECT value FROM json_each(?)))', categories)
  if (filters.isFree !== undefined) add('e.is_free = ?', filters.isFree ? 1 : 0)
  if (filters.maxPrice !== undefined) {
    add(options.priceCap === 'or-null' ? '(e.price IS NULL OR e.price <= ?)' : 'e.price <= ?', filters.maxPrice)
  }
  if (filters.minAge !== undefined) add('(e.min_age IS NULL OR e.min_age <= ?)', filters.minAge)
  const avoid = options.avoidGenres ? list(filters.avoidGenres) : null
  if (avoid) {
    add(`NOT EXISTS (SELECT 1 FROM json_each(e.facets, '$.genres') g WHERE g.value IN (SELECT value FROM json_each(?)))`, avoid)
  }
  return where
}

const and = (where: Where) => where.sql.map(clause => ` AND ${clause}`).join('')

/** Lexical matches ranked in TypeScript; more than this many scheduled matches keeps the best by bm25. */
export const LEXICAL_RANK_POOL = 1000

/**
 * FTS5 version of `lexical_match_events_with_venues`: scheduled events matching `query`, ordered as Postgres ordered
 * them, by `ts_rank_cd` over the same text (`tsRankCd`), then by start. FTS5 finds and filters the matches; the rank
 * is computed here because FTS5 has no ts_rank_cd.
 */
export async function lexicalEventSearchD1(db: D1Database, query: string, filters: EventFilters, matchCount: number, signal?: AbortSignal): Promise<ChatEventPayload[]> {
  const match = websearchToFts5(query)
  if (!match) return []
  const where = filterSql(filters, { priceCap: 'or-null', avoidGenres: true })
  const { results: matches } = await db.prepare(`SELECT e.id, e.starts_at,
      coalesce(e.search_document, e.name || ' ' || coalesce(e.description_es, '')) || ' ' || coalesce(v.name, '') AS text
    FROM events_fts JOIN events e ON e.rowid = events_fts.rowid LEFT JOIN venues v ON v.id = e.venue_id
    WHERE events_fts MATCH ? AND e.status = 'scheduled'${and(where)}
    ORDER BY bm25(events_fts) LIMIT ?`).bind(match, ...where.values, LEXICAL_RANK_POOL)
    .all<{ id: string; starts_at: string; text: string }>()
  signal?.throwIfAborted()
  // Postgres' rank is a float4, so equal ranks there are equal here too and fall to the start time.
  const ranked = matches.map(row => ({ ...row, rank: Math.fround(tsRankCd(row.text, query)) }))
    .sort((a, b) => b.rank - a.rank || a.starts_at.localeCompare(b.starts_at) || a.id.localeCompare(b.id))
    .slice(0, matchCount)
  if (ranked.length === 0) return []
  const { results } = await db.prepare(`SELECT ${EVENT_COLUMNS} FROM ${FROM_EVENTS}
    WHERE e.id IN (SELECT value FROM json_each(?)) AND e.status = 'scheduled' AND e.scope = 'in'`)
    .bind(JSON.stringify(ranked.map(row => row.id))).all()
  const events = new Map(results.map(row => { const event = toPayload(row); return [event.id, event] }))
  return ranked.flatMap(row => {
    const event = events.get(row.id)
    return event ? [{ ...event, similarity: row.rank } as ChatEventPayload] : []
  })
}

/** Vectorize's `getByIds` takes at most 20 ids per call. */
const VECTORIZE_GET_BATCH = 20

const cosine = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  let dot = 0, left = 0, right = 0
  for (let index = 0; index < a.length; index++) {
    dot += a[index] * b[index]
    left += a[index] * a[index]
    right += b[index] * b[index]
  }
  return dot / Math.sqrt(left * right)
}

/**
 * Vectorize version of `match_events_with_venues_filtered`: the nearest scheduled events to `embedding`. Vectorize
 * filters on status and the date window (each vector's metadata is `{ status, starts_at }`, with starts_at in epoch
 * milliseconds) and returns the 100 nearest. For today, D1 also selects earlier events still running; the Vectorize
 * index does not have end times. D1 applies the remaining filters, then scores survivors by exact cosine because
 * Vectorize's own scores are approximate and reorder near ties that pgvector didn't.
 */
export async function semanticEventSearchD1(db: D1Database, vectorize: VectorizeIndex, embedding: number[],
  filters: EventFilters, matchCount: number, signal?: AbortSignal): Promise<ChatEventPayload[]> {
  const startsAt: Record<string, number> = {}
  const today = filters.today
  const canStartBeforeToday = today && (!today.explicitStart || today.explicitStart < today.dayStart)
  const earliestStart = canStartBeforeToday ? today.dayStart : today?.explicitStart ?? filters.startsAfter
  if (earliestStart) startsAt.$gte = Date.parse(earliestStart)
  if (filters.startsBefore) startsAt.$lte = Date.parse(filters.startsBefore)
  const where = filterSql(filters, { priceCap: 'or-null', avoidGenres: true })
  const [nearest, earlier] = await Promise.all([
    vectorize.query(embedding, {
      topK: VECTORIZE_TOP_K,
      returnValues: false,
      returnMetadata: 'none',
      filter: { status: 'scheduled', ...(Object.keys(startsAt).length ? { starts_at: startsAt } : {}) },
    }),
    today && canStartBeforeToday
      ? db.prepare(`SELECT e.id FROM ${FROM_EVENTS}
          WHERE e.status = 'scheduled' AND e.starts_at < ?${and(where)} ORDER BY e.starts_at DESC LIMIT ?`)
        .bind(today.dayStart, ...where.values, VECTORIZE_TOP_K).all<{ id: string }>()
      : Promise.resolve({ results: [] }),
  ])
  signal?.throwIfAborted()
  const candidateIds = [...nearest.matches.map(match => match.id), ...earlier.results.map(row => row.id)]
  if (!candidateIds.length) return []
  const { results } = await db.prepare(`SELECT ${EVENT_COLUMNS} FROM ${FROM_EVENTS}
    WHERE e.id IN (SELECT value FROM json_each(?)) AND e.status = 'scheduled'${and(where)}`)
    .bind(JSON.stringify(candidateIds), ...where.values).all()
  signal?.throwIfAborted()
  const events = results.map(toPayload)
  const batches: string[][] = []
  for (let index = 0; index < events.length; index += VECTORIZE_GET_BATCH) {
    batches.push(events.slice(index, index + VECTORIZE_GET_BATCH).map(event => event.id))
  }
  const vectors = (await Promise.all(batches.map(ids => vectorize.getByIds(ids)))).flat()
  const scores = new Map(vectors.flatMap(vector => vector.values ? [[vector.id, cosine(embedding, vector.values)] as const] : []))
  return events
    .flatMap(event => {
      const similarity = scores.get(event.id)
      return similarity !== undefined && similarity > SEMANTIC_MATCH_THRESHOLD ? [{ ...event, similarity }] : []
    })
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, matchCount) as ChatEventPayload[]
}

/** `searchEventsWithFilters` before its in-memory avoided-genre filter: matching events, soonest first. */
export async function searchEventsWithFiltersD1(db: D1Database, filters: EventFilters, limit: number): Promise<ChatEventPayload[]> {
  const where = filterSql(filters, { priceCap: 'strict', avoidGenres: false })
  const { results } = await db.prepare(`SELECT ${EVENT_COLUMNS} FROM ${FROM_EVENTS}
    WHERE e.status = ?${and(where)} ORDER BY e.starts_at LIMIT ?`)
    .bind(filters.status ?? 'scheduled', ...where.values, limit).all()
  return results.map(toPayload)
}

/** `countEventsWithFilters`: how many events match, avoided genres excluded. */
export async function countEventsWithFiltersD1(db: D1Database, filters: EventFilters): Promise<number> {
  const where = filterSql(filters, { priceCap: 'strict', avoidGenres: true })
  const row = await db.prepare(`SELECT count(*) AS count FROM ${FROM_EVENTS} WHERE e.status = ?${and(where)}`)
    .bind(filters.status ?? 'scheduled', ...where.values).first<{ count: number }>()
  return row?.count ?? 0
}

/** `getFurthestEventDate`: the latest start of any in-scope scheduled event. */
export async function getFurthestEventDateD1(db: D1Database): Promise<string | null> {
  const row = await db.prepare(`SELECT max(starts_at) AS starts_at FROM events WHERE status = 'scheduled' AND scope = 'in'`).first<{ starts_at: string | null }>()
  return row?.starts_at ?? null
}

const UNKNOWN_END_DURATION_MS = 3 * 60 * 60 * 1000

/** `getEventsHappeningNow`: scheduled events that have started and not ended. */
export async function getEventsHappeningNowD1(db: D1Database, now = new Date()): Promise<ChatEventPayload[]> {
  const at = now.toISOString()
  const day = new Intl.DateTimeFormat('sv-SE', { timeZone: BA_TIMEZONE }).format(now)
  const midnight = iso(`${day}T00:00:00-03:00`)
  const recent = new Date(now.getTime() - UNKNOWN_END_DURATION_MS).toISOString()
  const { results } = await db.prepare(`SELECT ${EVENT_COLUMNS} FROM ${FROM_EVENTS}
    WHERE e.status = 'scheduled' AND e.scope = 'in' AND e.time_tba = 0 AND e.starts_at <= ? AND (
      e.ends_at > ? OR (e.is_all_day = 1 AND e.starts_at >= ?) OR
      (e.is_all_day = 0 AND e.ends_at IS NULL AND e.starts_at > ?)
    ) ORDER BY e.starts_at`)
    .bind(at, at, midnight, recent).all()
  return results.map(toPayload)
}

/**
 * `searchVenuesByName`: up to 20 venues whose name contains `query` ignoring case, ordered by name, as Postgres' ilike
 * did. SQLite's LIKE folds ASCII letters only, so the match runs here over the venue names (about 2,600), where
 * `toLowerCase` folds accented capitals too ("casa gómez" finds "CASA GÓMEZ"). Accents still count, as in ilike, and
 * `%` and `_` are plain characters rather than wildcards.
 */
export async function searchVenuesByNameD1(db: D1Database, query: string): Promise<Venue[]> {
  const needle = query.toLowerCase()
  const { results } = await db.prepare('SELECT id, name FROM venues').all<{ id: string; name: string }>()
  const ids = results.filter(venue => venue.name.toLowerCase().includes(needle))
    .sort((a, b) => venueNameOrder.compare(a.name, b.name) || (a.id < b.id ? -1 : 1))
    .slice(0, 20).map(venue => venue.id)
  if (ids.length === 0) return []
  const { results: venues } = await db.prepare('SELECT * FROM venues WHERE id IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify(ids)).all<Venue>()
  const byId = new Map(venues.map(venue => [venue.id, venue]))
  return ids.flatMap(id => byId.get(id) ?? [])
}

// Production Postgres sorts names with a locale collation, not by bytes.
const venueNameOrder = new Intl.Collator('en-US')
