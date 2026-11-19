/**
 * Catalog upkeep that Postgres did for us and D1 doesn't, run by `baeventos-jobs` crons only when the env binds D1.
 *
 * - `markPastEvents` (hourly) is the pg_cron job `mark-past-events` from 20261114210000: a scheduled or pending-review
 *   event becomes `past` once it has ended, 4 hours after it starts when it has no end, or 28 hours after its midnight
 *   start when it is date-only (time TBA or all-day). The vector's `status` metadata follows.
 * - `reconcileCatalog` (nightly) is `scripts/reembed-stale.ts` on D1 plus a Vectorize check: it re-embeds scheduled
 *   events whose search document is stale or missing, re-embeds events left in `vector_sync` by a failed Vectorize
 *   write, puts back missing vectors, and rewrites vector metadata that no longer matches the row.
 */
import type { D1Database, Vectorize } from '@cloudflare/workers-types'
import { CURRENT_EMBEDDING_VERSION, embedEventWithDocument, generateEmbedding } from '#shared/lib/ai/embeddings.ts'
import { d1Catalog, syncVectorMetadata, vectorMetadata, type VectorRow } from '#features/import/core/catalog-store-d1.ts'
import type { EventFacets } from '#shared/lib/search-facets.ts'
import { boundD1Database } from '#shared/lib/db/d1.server.ts'
import { boundVectorize } from '#features/import/core/catalog-store-for.ts'
import type { CatalogEnv } from '#features/import/core/catalog-store.ts'
import type { CRON_TASKS } from './schedule.ts'

const HOUR = 3_600_000

export async function markPastEvents(db: D1Database, vectors: Vectorize, now = new Date()): Promise<{ marked: number; vectorsUpdated: number }> {
  const iso = (ms: number) => new Date(ms).toISOString()
  const { results } = await db.prepare(`UPDATE events SET status = 'past'
    WHERE status IN ('scheduled', 'pending_review') AND (
      ends_at < ?1
      OR (ends_at IS NULL AND NOT (time_tba = 1 OR coalesce(is_all_day, 0) = 1) AND starts_at < ?2)
      OR (ends_at IS NULL AND (time_tba = 1 OR coalesce(is_all_day, 0) = 1) AND starts_at < ?3))
    RETURNING id`).bind(iso(now.getTime()), iso(now.getTime() - 4 * HOUR), iso(now.getTime() - 28 * HOUR)).all<{ id: string }>()
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

const EMBEDDING_FIELDS = `id, status, starts_at, name, description_es, description_en, categories, facets,
  price, is_free, venue_name, venue_neighborhood, search_document, embedding_version`
const STALE_DOCUMENT = "status = 'scheduled' AND (embedding_version < ? OR search_document IS NULL)"

function sourceForEmbedding(row: StaleRow) {
  return {
    name: row.name, description_es: row.description_es, description_en: row.description_en,
    categories: JSON.parse(row.categories) as string[], facets: JSON.parse(row.facets) as EventFacets,
    price: row.price, is_free: row.is_free === 1, venue_name: row.venue_name, venue_neighborhood: row.venue_neighborhood,
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
  /** Events left for the next night because `maxEmbeds` ran out. */
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

  // 1. reembed-stale: scheduled events whose document is from an older version or missing. Document, version and vector
  //    are written together, so the three always agree.
  const { results: stale } = await db.prepare(`SELECT ${EMBEDDING_FIELDS} FROM events_with_venues
    WHERE ${STALE_DOCUMENT} ORDER BY starts_at, id`).bind(CURRENT_EMBEDDING_VERSION).all<StaleRow>()
  const reembedded = new Set<string>()
  for (const row of stale) {
    if (budget <= 0) { result.deferred++; continue }
    budget--
    const { embedding, searchDocument } = await embed(sourceForEmbedding(row))
    // Queued in the same transaction, so a failed upsert below is picked up by step 2 tomorrow.
    await db.batch([
      db.prepare('UPDATE events SET search_document = ?, embedding_version = ? WHERE id = ?').bind(searchDocument, CURRENT_EMBEDDING_VERSION, row.id),
      db.prepare('INSERT OR REPLACE INTO vector_sync (event_id) VALUES (?)').bind(row.id),
    ])
    // Intake protection can revert the document; only a document that stuck gets the new vector.
    const stored = await db.prepare('SELECT status, starts_at, search_document FROM events WHERE id = ?').bind(row.id).first<VectorRow & { search_document: string | null }>()
    if (stored?.search_document === searchDocument) {
      await vectors.upsert([{ id: row.id, values: embedding, metadata: vectorMetadata(stored) }])
      reembedded.add(row.id)
      result.reembedded++
    }
    await db.prepare('DELETE FROM vector_sync WHERE event_id = ?').bind(row.id).run()
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
  const result = task === 'mark-past-events' ? await markPastEvents(db, vectors) : await reconcileCatalog(db, vectors)
  console.log(`[${task}]`, result)
  return result
}
