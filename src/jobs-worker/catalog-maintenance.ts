/**
 * Catalog upkeep that Postgres did for us and D1 doesn't, run by `baeventos-jobs` crons only when the env binds D1.
 *
 * - `markPastEvents` (hourly) is the pg_cron job `mark-past-events` from 20261114210000: a scheduled or pending-review
 *   event becomes `past` once it has ended, but date-only events stay through their Buenos Aires start day.
 *   Without an end, the fallbacks are 4 hours for timed events and 28 hours for date-only events. The vector follows.
 * - `reconcileCatalog` (nightly) is `scripts/reembed-stale.ts` on D1 plus a Vectorize check: it re-embeds scheduled
 *   events whose search document is stale or missing, re-embeds events left in `vector_sync` by a failed Vectorize
 *   write, puts back missing vectors, and rewrites vector metadata that no longer matches the row.
 */
import type { D1Database, Vectorize } from '@cloudflare/workers-types'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { BA_TIMEZONE } from '#shared/lib/constants.ts'
import { buildSearchDocument, CURRENT_EMBEDDING_VERSION, embedEventWithDocument, generateEmbedding } from '#shared/lib/ai/embeddings.ts'
import { d1Catalog, syncVectorMetadata, vectorMetadata, type VectorRow } from '#features/import/core/catalog-store-d1.ts'
import type { EventFacets } from '#shared/lib/search-facets.ts'
import { boundD1Database, intakeCommitBatch } from '#shared/lib/db/d1.server.ts'
import { boundVectorize } from '#features/import/core/catalog-store-for.ts'
import type { CatalogEnv } from '#features/import/core/catalog-store.ts'
import { judgeScheduledScope } from '#features/events/scope/catalog.ts'
import type { CRON_TASKS } from './schedule.ts'

const HOUR = 3_600_000
const DATE_ONLY = '(time_tba = 1 OR coalesce(is_all_day, 0) = 1)'

export async function markPastEvents(db: D1Database, vectors: Vectorize, now = new Date()): Promise<{ marked: number; vectorsUpdated: number }> {
  const iso = (ms: number) => new Date(ms).toISOString()
  const today = formatInTimeZone(now, BA_TIMEZONE, 'yyyy-MM-dd')
  const midnight = fromZonedTime(`${today}T00:00:00`, BA_TIMEZONE).toISOString()
  const { results } = await db.prepare(`UPDATE events SET status = 'past'
    WHERE status IN ('scheduled', 'pending_review') AND (
      (ends_at < ?1 AND (NOT ${DATE_ONLY} OR starts_at < ?4))
      OR (ends_at IS NULL AND NOT ${DATE_ONLY} AND starts_at < ?2)
      OR (ends_at IS NULL AND ${DATE_ONLY} AND starts_at < ?3))
    RETURNING id`).bind(now.toISOString(), iso(now.getTime() - 4 * HOUR), iso(now.getTime() - 28 * HOUR), midnight).all<{ id: string }>()
  if (!results.length) return { marked: 0, vectorsUpdated: 0 }
  // RETURNING shows the row before the intake-protection trigger, which can keep a protected pending_review status.
  const { results: rows } = await db.prepare('SELECT id, status, starts_at FROM events WHERE id IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify(results.map(row => row.id))).all<VectorRow>()
  const { updated } = await syncVectorMetadata(vectors, rows)
  return { marked: rows.filter(row => row.status === 'past').length, vectorsUpdated: updated }
}

interface StaleRow extends VectorRow {
  name: string
  description_es: string | null
  description_en: string | null
  categories: string
  facets: string
  price: number | null
  is_free: number
  venue_name: string | null
  venue_neighborhood: string | null
  search_document: string | null
  embedding_version: number
}

const SEARCH_INPUTS = ['name', 'description_es', 'description_en', 'categories', 'facets',
  'price', 'is_free', 'venue_name', 'venue_neighborhood'] as const
const EMBEDDING_FIELDS = `id, status, starts_at, ${SEARCH_INPUTS.join(', ')}, search_document, embedding_version`
const STALE_DOCUMENT = "status = 'scheduled' AND (embedding_version < ? OR search_document IS NULL)"

function sourceForEmbedding(row: StaleRow) {
  return {
    name: row.name, description_es: row.description_es, description_en: row.description_en,
    categories: JSON.parse(row.categories) as string[], facets: JSON.parse(row.facets) as EventFacets,
    price: row.price, is_free: row.is_free === 1 || row.price !== null ? row.is_free === 1 : undefined,
    venue_name: row.venue_name, venue_neighborhood: row.venue_neighborhood,
  }
}

export interface ReconcileOptions {
  /** Most events to send to the embedding model in one run (each is one OpenAI call). */
  maxEmbeds?: number
  embed?: typeof embedEventWithDocument
  embedText?: typeof generateEmbedding
  now?: Date
}

export interface ReconcileResult {
  reembedded: number
  /** Events in `vector_sync` (a Vectorize write that failed after D1 committed) whose vector was rebuilt. */
  resynced: number
  restored: number
  metadataUpdated: number
  checked: number
  /** Events left for the next night because `maxEmbeds` ran out or the rebuild inputs changed. */
  deferred: number
}

/**
 * Bring Vectorize and D1 back in step. Checks the events search can return (not canceled or past) plus every event
 * changed in the last two days, which covers events that just turned past or canceled.
 */
export async function reconcileCatalog(db: D1Database, vectors: Vectorize, options: ReconcileOptions = {}): Promise<ReconcileResult> {
  const now = options.now ?? new Date()
  let budget = options.maxEmbeds ?? 200
  const embed = options.embed ?? embedEventWithDocument
  const embedText = options.embedText ?? generateEmbedding
  const result: ReconcileResult = { reembedded: 0, resynced: 0, restored: 0, metadataUpdated: 0, checked: 0, deferred: 0 }

  // 1. An update that reused the stored document (such as artwork-only intake) may have retained stale text even
  //    at the current version. Compare those documents without a provider call until an actual mismatch is found.
  const { results: candidates } = await db.prepare(`SELECT ${EMBEDDING_FIELDS} FROM events_with_venues e
    WHERE (${STALE_DOCUMENT}) OR (e.status = 'scheduled' AND e.embedding_version = ? AND EXISTS (
      SELECT 1 FROM event_intake_protection p JOIN intake_plans i ON i.id = p.plan_id
      WHERE p.event_id = e.id AND i.action = 'update' AND json_extract(i.payload, '$.embedding') IS NULL))
    ORDER BY starts_at, id`).bind(CURRENT_EMBEDDING_VERSION, CURRENT_EMBEDDING_VERSION).all<StaleRow>()
  const reembedded = new Set<string>()
  for (const row of candidates) {
    const input = sourceForEmbedding(row)
    if (row.embedding_version >= CURRENT_EMBEDDING_VERSION && row.search_document === buildSearchDocument(input)) continue
    if (budget <= 0) { result.deferred++; continue }
    budget--
    const { embedding, searchDocument } = await embed(input)
    // Only this derived-field write uses the intake bypass. Check the same accepted facts (including venue text)
    // in the batch so a provider call that overlapped an edit cannot replace the new listing's search text.
    const [, updated] = await db.batch<VectorRow>(intakeCommitBatch(db, [
      db.prepare(`UPDATE events SET search_document = ?, embedding_version = ? WHERE id = ? AND status = 'scheduled'
        AND embedding_version IS ? AND search_document IS ?
        AND EXISTS (SELECT 1 FROM events_with_venues v WHERE v.id = events.id AND ${SEARCH_INPUTS.map(key => `v.${key} IS ?`).join(' AND ')})
        RETURNING id, status, starts_at`)
        .bind(searchDocument, CURRENT_EMBEDDING_VERSION, row.id, row.embedding_version, row.search_document, ...SEARCH_INPUTS.map(key => row[key])),
      db.prepare('INSERT OR REPLACE INTO vector_sync (event_id) SELECT ? WHERE changes() > 0').bind(row.id),
    ]))
    const stored = updated?.results[0]
    if (!stored) { result.deferred++; continue }
    await vectors.upsert([{ id: row.id, values: embedding, metadata: vectorMetadata(stored) }])
    reembedded.add(row.id)
    result.reembedded++
    await db.prepare(`DELETE FROM vector_sync WHERE event_id = ? AND EXISTS (
      SELECT 1 FROM events WHERE id = ? AND search_document IS ? AND embedding_version = ?)`)
      .bind(row.id, row.id, searchDocument, CURRENT_EMBEDDING_VERSION).run()
  }

  // 2. Events whose vector write failed after D1 committed: embed the stored document, so the vector matches the row
  //    whatever intake protection kept. An event without a document is left for step 1 once it has one.
  const { results: pending } = await db.prepare(`SELECT e.id, e.status, e.starts_at, e.search_document FROM vector_sync q
    JOIN events e ON e.id = q.event_id ORDER BY q.queued_at`).all<VectorRow & { search_document: string | null }>()
  for (const row of pending) {
    if (reembedded.has(row.id)) continue
    if (!row.search_document) { await db.prepare('DELETE FROM vector_sync WHERE event_id = ?').bind(row.id).run(); continue }
    if (budget <= 0) { result.deferred++; continue }
    budget--
    await vectors.upsert([{ id: row.id, values: await embedText(row.search_document), metadata: vectorMetadata(row) }])
    await db.prepare('DELETE FROM vector_sync WHERE event_id = ?').bind(row.id).run()
    reembedded.add(row.id)
    result.resynced++
  }

  // 3. Vectors: every live or recently changed event has one, with metadata that matches its row.
  const { results: live } = await db.prepare(`SELECT id, status, starts_at, search_document FROM events
    WHERE status NOT IN ('canceled', 'past') OR updated_at >= ? ORDER BY id`)
    .bind(new Date(now.getTime() - 48 * HOUR).toISOString()).all<VectorRow & { search_document: string | null }>()
  const toCheck = live.filter(row => !reembedded.has(row.id))
  result.checked = toCheck.length
  const { updated, missing } = await syncVectorMetadata(vectors, toCheck)
  result.metadataUpdated = updated
  const byId = new Map(toCheck.map(row => [row.id, row]))
  for (const id of missing) {
    const row = byId.get(id)!
    // Only searchable events need a vector back; past and canceled ones can't be returned anyway.
    if (!row.search_document || row.status === 'past' || row.status === 'canceled') continue
    if (budget <= 0) { result.deferred++; continue }
    budget--
    await vectors.upsert([{ id, values: await embedText(row.search_document), metadata: vectorMetadata(row) }])
    result.restored++
  }
  return result
}

export const EMBEDDING_TASK_LIMIT = 200

/** Manual backfill. The nightly reconcile still checks metadata and retries queued writes on its own schedule. */
export async function runEmbeddingTask(
  task: 'populate-embeddings' | 'reembed-stale', db: D1Database, vectors: Vectorize, limit: number,
  { embed = embedEventWithDocument, embedText = generateEmbedding }: Pick<ReconcileOptions, 'embed' | 'embedText'> = {},
) {
  const catalog = d1Catalog(db, vectors)
  const result = { checked: 0, updated: 0, blocked: 0, more: false }
  async function repair(row: StaleRow, rebuild: boolean) {
    if (!rebuild && row.search_document) {
      await vectors.upsert([{ id: row.id, values: await embedText(row.search_document), metadata: vectorMetadata(row) }])
      result.updated++
      return
    }
    const { embedding, searchDocument } = await embed(sourceForEmbedding(row))
    await catalog.updateEvent(row.id, { embedding, search_document: searchDocument, embedding_version: CURRENT_EMBEDDING_VERSION })
    const stored = await db.prepare('SELECT search_document, embedding_version FROM events WHERE id = ?').bind(row.id)
      .first<Pick<StaleRow, 'search_document' | 'embedding_version'>>()
    if (stored?.search_document === searchDocument && stored.embedding_version === CURRENT_EMBEDDING_VERSION) result.updated++
    else result.blocked++
  }

  if (task === 'reembed-stale') {
    const { results } = await db.prepare(`SELECT ${EMBEDDING_FIELDS} FROM events_with_venues
      WHERE ${STALE_DOCUMENT} ORDER BY starts_at, id LIMIT ?`).bind(CURRENT_EMBEDDING_VERSION, limit + 1).all<StaleRow>()
    result.more = results.length > limit
    for (const row of results.slice(0, limit)) {
      result.checked++
      await repair(row, true)
    }
    return result
  }

  // D1 has no vector column. Check actual index membership in small pages, including older events.
  let after = ''
  for (;;) {
    const { results } = await db.prepare(`SELECT ${EMBEDDING_FIELDS} FROM events_with_venues
      WHERE id > ? ORDER BY id LIMIT 20`).bind(after).all<StaleRow>()
    if (!results.length) return result
    const found = new Set((await vectors.getByIds(results.map(row => row.id))).map(vector => vector.id))
    result.checked += results.length
    for (const row of results) {
      if (found.has(row.id)) continue
      if (result.updated + result.blocked >= limit) return { ...result, more: true }
      await repair(row, false)
    }
    after = results[results.length - 1].id
  }
}

/** Hourly expiration and nightly Vectorize reconciliation. */
export async function runCatalogTask(task: (typeof CRON_TASKS)[keyof typeof CRON_TASKS], env: CatalogEnv): Promise<unknown> {
  const db = boundD1Database(env)
  if (!db) return { skipped: 'no D1 binding' }
  const vectors = boundVectorize(env)
  if (!vectors) throw new Error('The DB binding needs a VECTORIZE binding too')
  if (task === 'mark-past-events') {
    const past = await markPastEvents(db, vectors)
    console.log('[mark-past-events]', past)
    const scope = await judgeScheduledScope(db)
    console.log('[event-scope]', scope)
    return { ...past, scope }
  }
  const result = await reconcileCatalog(db, vectors)
  console.log(`[${task}]`, result)
  return result
}
