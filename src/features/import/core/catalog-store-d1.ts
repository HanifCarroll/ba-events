/**
 * The catalog repository on D1, with Vectorize kept in step (catalog-store.ts has the interface).
 *
 * Rows are decoded with Effect Schema at this edge: D1 gives back 0/1 for booleans and JSON text for arrays and
 * objects. Writes encode the other way and store timestamps in the exact `toISOString()` form the baseline requires.
 * The shared event write gateway resolves authority before changing the catalog.
 */
import type { D1Database, Vectorize } from '@cloudflare/workers-types'
import { Schema } from 'effect'
import { eventColumnsWith } from '#shared/lib/db/event-columns.ts'
import { insertImportedEvent, setEventVenues, writeEvent } from '#shared/lib/db/event-write.ts'
import { removeEventVectors } from '#shared/lib/db/vector-sync.ts'
import type { BlocklistSource, ImportBlocklistEntry, Venue } from '#shared/lib/types.ts'
import { trigramSimilarity } from '#shared/lib/search/trigram.ts'
import type { ExistingEventData } from '../api/duplicate-detection.ts'
import type { CatalogStore, EnrichmentRow, ScrapeRunPatch } from './catalog-store.ts'
import { venueNameKey } from './venue-identity.ts'

// ---------------------------------------------------------------------------------------------------------------------
// Encoding

const TIMESTAMPS = new Set(['starts_at', 'ends_at', 'enriched_at', 'created_at', 'updated_at', 'started_at', 'completed_at', 'reviewed_at', 'offers_valid_from', 'doors_at'])
const BOOLEANS = new Set(['is_all_day', 'is_free', 'location_hidden', 'location_tba', 'description_unavailable', 'time_tba'])
const JSON_COLUMNS = new Set(['categories', 'facets', 'performers', 'enrichment_provenance', 'metadata', 'error_details', 'source_coordinates', 'source_event_ids'])

const EVENT_COLUMNS = new Set<string>(eventColumnsWith('catalog', 'write', 'read-write'))
const SCRAPE_RUN_COLUMNS = new Set(['status', 'completed_at', 'error_message', 'error_details', 'events_fetched', 'events_inserted',
  'events_updated', 'events_skipped', 'venues_auto_created', 'enrichments_completed', 'enrichments_failed', 'metadata'])

/** One column value as D1 stores it. */
export function encodeColumn(column: string, value: unknown): unknown {
  if (value === undefined || value === null) return null
  if (TIMESTAMPS.has(column)) {
    const time = new Date(value as string)
    if (Number.isNaN(time.getTime())) throw new Error(`${column} is not a time: ${String(value)}`)
    return time.toISOString()
  }
  if (BOOLEANS.has(column)) return value ? 1 : 0
  if (JSON_COLUMNS.has(column)) return JSON.stringify(value)
  return value
}

/** `[columns, values]` for the defined keys of `row`, refusing any column outside `allowed`. */
function encodeRow(row: Record<string, unknown>, allowed: Set<string>): [string[], unknown[]] {
  const columns: string[] = []
  const values: unknown[] = []
  for (const [column, value] of Object.entries(row)) {
    if (value === undefined) continue
    if (!allowed.has(column)) throw new Error(`Unknown column ${column}`)
    columns.push(column)
    values.push(encodeColumn(column, value))
  }
  return [columns, values]
}

function encodeEvent(row: Record<string, unknown>) {
  const [columns, values] = encodeRow(row, EVENT_COLUMNS)
  return Object.fromEntries(columns.map((column, index) => [column, values[index]]))
}

// ---------------------------------------------------------------------------------------------------------------------
// Decoding

const Bit = Schema.BooleanFromBit
const NullableBit = Schema.NullOr(Schema.BooleanFromBit)
const Json = Schema.fromJsonString(Schema.Unknown)
const Strings = Schema.fromJsonString(Schema.Array(Schema.String))
const Text = Schema.NullOr(Schema.String)
const Int = Schema.NullOr(Schema.Int)
const Price = Schema.NullOr(Schema.Finite)

const venueRow = Schema.Struct({
  id: Schema.String, name: Schema.String, neighborhood: Text, address: Text, website: Text, instagram_handle: Text, parent_id: Text,
  enrichment_status: Schema.String, enrichment_error: Text, enriched_at: Text, address_check_status: Schema.String,
  created_at: Schema.String, updated_at: Schema.String,
})
const venueWithCount = Schema.Struct({ ...venueRow.fields, event_count: Schema.Int })

const detailFields = {
  organizer_name: Text, organizer_url: Text, offers_valid_from: Text, doors_at: Text,
  performers: Schema.NullOr(Schema.fromJsonString(Schema.Array(Schema.Struct({
    name: Schema.String, url: Schema.optional(Schema.String),
  })))),
}

const existingEventRow = Schema.Struct({
  ...detailFields,
  id: Schema.String, external_id: Schema.String, name: Schema.String, description_es: Text, description_en: Text,
  starts_at: Schema.String, ends_at: Text, is_all_day: Bit, time_tba: Bit, venue_id: Text, categories: Strings, price: Price,
  is_free: Bit, min_age: Int, image_url: Text, image_width: Int, image_height: Int, link: Text, ticket_url: Text,
  status: Schema.String, location_hidden: NullableBit, location_tba: Bit, description_unavailable: Bit, facets: Json,
  embedding_version: Int,
})

const enrichmentRow = Schema.Struct({
  ...detailFields,
  id: Schema.String, name: Schema.String, link: Text, source: Schema.String, categories: Strings, venue_id: Text,
  description_es: Text, description_en: Text, facets: Json, enrichment_status: Schema.String, price: Price, is_free: Bit,
  enrichment_provenance: Schema.NullOr(Json),
})

const blocklistRow = Schema.Struct({
  id: Schema.String, pattern: Schema.String, target_field: Schema.String, source: Schema.String, reason: Text,
  created_at: Schema.String, updated_at: Schema.String,
})

const decode = <S extends Schema.Top & { readonly DecodingServices: never }>(schema: S) => {
  const run = Schema.decodeUnknownSync(schema)
  return (row: unknown) => run(row) as S['Type']
}
const decodeVenue = decode(venueWithCount)
const decodeExisting = decode(existingEventRow)
const decodeEnrichment = decode(enrichmentRow)
const decodeBlocklist = decode(blocklistRow)
const decodeCreatedVenue = decode(venueRow)

// ---------------------------------------------------------------------------------------------------------------------
// The store

const EXISTING_EVENT_COLUMNS = eventColumnsWith('catalog', 'read', 'read-write').join(', ')

function enrichmentWhere(query: { statuses?: string[]; startsAtFloor: string; retiredSources: readonly string[]; source?: string; createdAfter?: string }) {
  const clauses = [
    'enrichment_status IN (SELECT value FROM json_each(?))', "status NOT IN ('canceled', 'past')", 'starts_at >= ?',
    'link IS NOT NULL', 'source NOT IN (SELECT value FROM json_each(?))',
  ]
  const values: unknown[] = [JSON.stringify(query.statuses ?? ['pending', 'failed']), encodeColumn('starts_at', query.startsAtFloor), JSON.stringify(query.retiredSources)]
  if (query.source) { clauses.push('source = ?'); values.push(query.source) }
  if (query.createdAfter) { clauses.push('created_at >= ?'); values.push(encodeColumn('created_at', query.createdAfter)) }
  return { sql: clauses.join(' AND '), values }
}

/**
 * The catalog on D1. Build one per Workflow step or request. It keeps the venue list (2,600 rows) in memory and checks
 * before each venue lookup that no venue was added or removed since, by any writer (the three sources import
 * concurrently with their own stores), reloading the list when one was.
 */
export function d1Catalog(db: D1Database, vectors: Vectorize): CatalogStore {
  let cached: { signature: string; venues: Array<Venue & { event_count: number }> } | undefined
  async function venueList() {
    // An insert, delete, or edit changes the count, the newest rowid, or the newest updated_at (a trigger keeps it).
    const stamp = await db.prepare('SELECT count(*) AS n, max(rowid) AS last, max(updated_at) AS edited FROM venues').first<{ n: number; last: number | null; edited: string | null }>()
    const signature = `${stamp?.n}:${stamp?.last}:${stamp?.edited}`
    if (cached?.signature !== signature) {
      const { results } = await db.prepare(
        'SELECT v.*, (SELECT count(*) FROM events e WHERE e.venue_id = v.id) AS event_count FROM venues v ORDER BY v.created_at, v.id',
      ).all()
      cached = { signature, venues: results.map(row => decodeVenue(row) as Venue & { event_count: number }) }
    }
    return cached.venues
  }

  return {
    async blocklistEntries(source?: BlocklistSource) {
      const filter = source && source !== 'all' ? " WHERE source IN (?, 'all')" : ''
      const statement = db.prepare(`SELECT * FROM import_blocklist${filter} ORDER BY created_at DESC`)
      const { results } = await (filter ? statement.bind(source) : statement).all()
      return results.map(row => decodeBlocklist(row) as ImportBlocklistEntry)
    },

    async venuesNamed(name) {
      const key = venueNameKey(name)
      if (!key) return []
      return (await venueList()).filter(venue => venueNameKey(venue.name) === key)
    },

    async similarVenue(name, threshold) {
      // find_similar_venue: highest similarity, then oldest, then lowest id.
      let best: { id: string; name: string; similarity: number } | null = null
      for (const venue of await venueList()) {
        const similarity = trigramSimilarity(venue.name, name)
        if (similarity >= threshold && (!best || similarity > best.similarity)) best = { id: venue.id, name: venue.name, similarity }
      }
      return best
    },

    async venueNameAndNeighborhood(id) {
      const row = await db.prepare('SELECT name, neighborhood FROM venues WHERE id = ?').bind(id).first<{ name: string; neighborhood: string | null }>()
      return { name: row?.name ?? null, neighborhood: row?.neighborhood ?? null }
    },

    async createVenue(venue) {
      const [columns, values] = encodeRow({ id: crypto.randomUUID(), ...venue },
        new Set(['id', 'name', 'address', 'neighborhood', 'enrichment_status', 'address_check_status']))
      const row = await db.prepare(`INSERT INTO venues (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')}) RETURNING *`)
        .bind(...values).first()
      if (!row) throw new Error('Failed to create venue')
      return decodeCreatedVenue(row) as Venue
    },

    async queueVenueReview(entry) {
      const [columns, values] = encodeRow({ id: crypto.randomUUID(), ...entry }, new Set(['id', 'scrape_run_id', 'source',
        'source_venue_name', 'source_address', 'source_coordinates', 'best_match_venue_id', 'match_confidence', 'source_event_ids', 'status']))
      await db.prepare(`INSERT INTO venue_review_queue (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`).bind(...values).run()
    },

    async settleVenueReview(id, settlement) {
      const [columns, values] = encodeRow({ ...settlement }, new Set(['status', 'final_venue_id', 'reviewed_at', 'reviewed_by', 'notes']))
      await db.prepare(`UPDATE venue_review_queue SET ${columns.map(column => `${column} = ?`).join(', ')} WHERE id = ?`).bind(...values, id).run()
    },

    async venueReviewEventIds(id) {
      const ids = await db.prepare('SELECT source_event_ids FROM venue_review_queue WHERE id = ?').bind(id).first<string | null>('source_event_ids')
      return ids ? Schema.decodeSync(Strings)(ids) as string[] : []
    },

    setEventsVenue: (eventIds, venueId) => setEventVenues(db, eventIds, venueId),

    async existingEvents(source, externalIds) {
      if (!externalIds.length) return []
      const { results } = await db.prepare(`SELECT ${EXISTING_EVENT_COLUMNS} FROM events WHERE source = ? AND external_id IN (SELECT value FROM json_each(?))`)
        .bind(source, JSON.stringify(externalIds)).all()
      return results.map(row => {
        const event = decodeExisting(row)
        // ExistingEventData has a plain boolean; NULL counts as not hidden, as the column's default.
        return { ...event, location_hidden: event.location_hidden ?? false } as unknown as ExistingEventData
      })
    },

    insertEvent(event) {
      const { embedding, ...row } = event
      return insertImportedEvent(db, vectors, crypto.randomUUID(), { ...encodeEvent(row), embedding })
    },

    updateEvent(id, patch, writer = 'importer') {
      const { embedding, ...row } = patch
      return writeEvent(db, vectors, { writer, id, patch: { ...encodeEvent(row), embedding } })
    },

    async eventsNeedingEnrichment(query) {
      const where = enrichmentWhere(query)
      const { results } = await db.prepare(`SELECT id, name, link, source, categories, venue_id, description_es, description_en, facets, enrichment_status, price, is_free, enrichment_provenance,
          organizer_name, organizer_url, performers, offers_valid_from, doors_at
        FROM events WHERE ${where.sql} ORDER BY starts_at LIMIT ?`).bind(...where.values, query.limit || 100).all()
      return results.map(row => decodeEnrichment(row) as EnrichmentRow)
    },

    async countEventsNeedingEnrichment(query) {
      const where = enrichmentWhere(query)
      return (await db.prepare(`SELECT count(*) AS n FROM events WHERE ${where.sql}`).bind(...where.values).first<number>('n')) ?? 0
    },

    async blocklistCandidates() {
      const { results } = await db.prepare('SELECT id, name, source, venue_name FROM events_with_venues').all<{ id: string; name: string | null; source: string; venue_name: string | null }>()
      return results
    },

    async deleteEvents(ids) {
      await db.prepare('DELETE FROM events WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(ids)).run()
      await removeEventVectors(vectors, ids)
    },

    async createScrapeRun(run) {
      const id = crypto.randomUUID()
      await db.prepare('INSERT INTO scrape_runs (id, source, status, trigger_id, metadata) VALUES (?, ?, ?, ?, ?)')
        .bind(id, run.source, run.status, run.trigger_id, JSON.stringify(run.metadata)).run()
      return { id, metadata: run.metadata }
    },

    async failStaleScrapeRuns(cutoff, patch) {
      const [columns, values] = encodeRow({ ...patch }, SCRAPE_RUN_COLUMNS)
      const { results } = await db.prepare(`UPDATE scrape_runs SET ${columns.map(column => `${column} = ?`).join(', ')} WHERE status = 'running' AND started_at < ? RETURNING id`)
        .bind(...values, encodeColumn('started_at', cutoff)).all()
      return results.length
    },

    async scrapeRunMetadata(id) {
      const row = await db.prepare('SELECT metadata FROM scrape_runs WHERE id = ?').bind(id).first<{ metadata: string | null }>()
      if (!row) return undefined
      return row.metadata === null ? null : JSON.parse(row.metadata)
    },

    async updateScrapeRun(id, patch: ScrapeRunPatch) {
      const [columns, values] = encodeRow({ ...patch }, SCRAPE_RUN_COLUMNS)
      if (columns.length) await db.prepare(`UPDATE scrape_runs SET ${columns.map(column => `${column} = ?`).join(', ')} WHERE id = ?`).bind(...values, id).run()
    },
  }
}
