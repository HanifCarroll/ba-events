/** D1 owns the search document; Vectorize holds its values under the event id and epoch-ms start metadata. */
import type { D1Database, Vectorize } from '@cloudflare/workers-types'
import { buildSearchDocument, CURRENT_EMBEDDING_VERSION, embedEventWithDocument, generateEmbedding } from '../ai/embeddings.ts'
import type { EventFacets } from '../search-facets.ts'
import { intakeCommitBatch } from './d1.server.ts'
import { eventColumnsWith, type EventColumn } from './event-columns.ts'

const VECTOR_CHUNK = 20
const HOUR = 3_600_000
const STALE_DOCUMENT = "status = 'scheduled' AND (embedding_version < ? OR search_document IS NULL)"
const searchInputs = new Set<EventColumn>(eventColumnsWith('searchDocument', true))
// The document uses venue text from the view, not the physical foreign key.
const searchViewInputs = [...eventColumnsWith('searchDocument', true).filter(column => column !== 'venue_id'),
  'venue_name', 'venue_neighborhood'] as const
const vectorFields = ['id', 'status', 'starts_at', 'search_document', 'embedding_version']
const VECTOR_FIELDS = vectorFields.join(', ')
const EMBEDDING_FIELDS = `${VECTOR_FIELDS}, ${searchViewInputs.join(', ')}`

type VectorRow = { id: string; status: string; starts_at: string }
type DocumentState = { search_document: string | null; embedding_version: number }
type StoredVector = VectorRow & DocumentState
type SearchInputRow = {
  name: string; description_es: string | null; description_en: string | null; categories: string; facets: string
  price: number | null; is_free: number; venue_name: string | null; venue_neighborhood: string | null
}
type StaleRow = StoredVector & SearchInputRow

type VectorPatch = { search_document?: string | null; embedding_version?: number | null; embedding?: number[] | null; status?: string | null; starts_at?: string | null }
type VectorWrite = { source: 'catalog' | 'rebuild'; patch: VectorPatch }
  | { source: 'intake'; patch: VectorPatch; previous: { status?: unknown; starts_at?: unknown } | null }

/** The write-capable catalog index binding; search's read-only checks stay independent. */
export function boundVectorize(env: { VECTORIZE?: unknown }): Vectorize | null {
  const index = env.VECTORIZE as Partial<Vectorize> | undefined
  return typeof index?.upsert === 'function' && typeof index.getByIds === 'function' ? index as Vectorize : null
}

const metadata = (row: VectorRow) => ({ status: row.status, starts_at: Date.parse(row.starts_at) })
const readVector = (db: D1Database, id: string) => db.prepare(`SELECT ${VECTOR_FIELDS} FROM events WHERE id = ?`).bind(id).first<StoredVector>()

async function clearQueue(db: D1Database, row: StoredVector) {
  // A newer commit may have arrived while the provider call was in flight. Keep its repair queued.
  await db.prepare(`DELETE FROM vector_sync WHERE event_id = ? AND EXISTS (
    SELECT 1 FROM events WHERE id = ? AND search_document IS ? AND embedding_version IS ? AND status IS ? AND starts_at IS ?)`)
    .bind(row.id, row.id, row.search_document, row.embedding_version, row.status, row.starts_at).run()
}

/** Only a document that stuck gets the prepared embedding. A nightly rebuild can supersede an intake receipt, too. */
async function upsertPrepared(vectors: Vectorize, row: StoredVector, values: number[], expected: Pick<VectorPatch, 'search_document' | 'embedding_version'>) {
  if (expected.search_document !== undefined && row.search_document !== expected.search_document ||
      expected.embedding_version !== undefined && row.embedding_version !== expected.embedding_version) return false
  await vectors.upsert([{ id: row.id, values, metadata: metadata(row) }])
  return true
}

/**
 * Plan the index work for an event write. Append `queue`, when present, to the caller's D1 batch, then call `settle`
 * after commit. A thrown Vectorize write leaves the queue for reconcile. `rebuild` queues only after an immediately
 * preceding guarded UPDATE changed a row. Give `settle` a receipt plan id to retry only its still-pending work.
 */
export function planVectorWrite(db: D1Database, id: string, write: VectorWrite) {
  const { source, patch } = write
  const intake = source === 'intake'
  const embedding = intake ? patch.embedding : patch.embedding?.length ? patch.embedding : undefined
  const metadataChanged = write.source === 'intake'
    ? write.previous !== null && (write.previous.status !== patch.status ||
      Date.parse(String(write.previous.starts_at)) !== Date.parse(patch.starts_at ?? ''))
    : patch.status !== undefined || patch.starts_at !== undefined
  // Intake retains a pending entry's place in the retry order; importers and rebuilds replace it.
  const queue = intake ? (embedding || metadataChanged
    ? db.prepare('INSERT INTO vector_sync (event_id) VALUES (?) ON CONFLICT (event_id) DO NOTHING').bind(id) : null)
    : embedding ? db.prepare(source === 'rebuild'
      ? 'INSERT OR REPLACE INTO vector_sync (event_id) SELECT ? WHERE changes() > 0'
      : 'INSERT OR REPLACE INTO vector_sync (event_id) VALUES (?)').bind(id) : null

  return {
    queue,
    async settle(vectors: Vectorize, receiptPlanId?: string): Promise<boolean> {
      if (!embedding && !metadataChanged) return false
      if (receiptPlanId && !await db.prepare(`SELECT 1 FROM event_intake_protection p JOIN vector_sync q ON q.event_id = p.event_id
        WHERE p.event_id = ? AND p.plan_id = ?`).bind(id, receiptPlanId).first()) return false
      const row = await readVector(db, id)
      if (!row) return false
      const expected = intake ? { ...patch, embedding_version: patch.embedding_version ?? 1 } : patch
      if (embedding && (!intake || expected.search_document !== undefined) && await upsertPrepared(vectors, row, embedding, expected)) {
        await clearQueue(db, row)
        return true
      }
      if (intake && !embedding) {
        // Intake metadata updates leave the queue: Vectorize can return stale values.
        await syncMetadata(vectors, [row], true)
      } else if (source === 'catalog') {
        // Protection kept the old search document. Its vector can still need a metadata refresh.
        await syncMetadata(vectors, [row])
        if (embedding) await clearQueue(db, row)
      }
      return false
    },
  }
}

/** D1 deletes the event (and cascades the queue row) before the caller removes its vector. */
export async function removeEventVectors(vectors: Vectorize, ids: readonly string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += VECTOR_CHUNK) await vectors.deleteByIds(ids.slice(i, i + VECTOR_CHUNK))
}

/** Rewrite metadata without regenerating the values. Vectorize does not have a metadata-only write. */
async function syncMetadata(vectors: Vectorize, rows: readonly VectorRow[], rewrite = false) {
  let updated = 0
  const missing: string[] = []
  for (let i = 0; i < rows.length; i += VECTOR_CHUNK) {
    const part = rows.slice(i, i + VECTOR_CHUNK)
    const found = new Map((await vectors.getByIds(part.map(row => row.id))).map(vector => [vector.id, vector]))
    const stale = []
    for (const row of part) {
      const vector = found.get(row.id)
      if (!vector) { missing.push(row.id); continue }
      const want = metadata(row)
      if (!rewrite && vector.metadata?.status === want.status && vector.metadata?.starts_at === want.starts_at) continue
      stale.push({ id: row.id, values: [...vector.values], metadata: want })
    }
    if (stale.length) { await vectors.upsert(stale); updated += stale.length }
  }
  return { updated, missing }
}

/** Refresh metadata after an hourly status update, using the rows as the triggers left them. */
export async function settlePastVectors(db: D1Database, vectors: Vectorize, ids: readonly string[]) {
  if (!ids.length) return { marked: 0, vectorsUpdated: 0 }
  const { results: rows } = await db.prepare('SELECT id, status, starts_at FROM events WHERE id IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify(ids)).all<VectorRow>()
  const { updated } = await syncMetadata(vectors, rows)
  return { marked: rows.filter(row => row.status === 'past').length, vectorsUpdated: updated }
}

function sourceForEmbedding(row: SearchInputRow) {
  return {
    name: row.name, description_es: row.description_es, description_en: row.description_en,
    categories: JSON.parse(row.categories) as string[], facets: JSON.parse(row.facets) as EventFacets,
    price: row.price, is_free: row.is_free === 1 || row.price !== null ? row.is_free === 1 : undefined,
    venue_name: row.venue_name, venue_neighborhood: row.venue_neighborhood,
  }
}

/** A publisher correction runs over D1 HTTP without an embedding binding. Mark changed text stale for nightly rebuild. */
export function invalidateCorrectedVector(before: DocumentState, field: EventColumn, after: SearchInputRow) {
  const document = searchInputs.has(field) ? buildSearchDocument(sourceForEmbedding(after)) : before.search_document
  return { document, version: document === before.search_document ? before.embedding_version : CURRENT_EMBEDDING_VERSION - 1 }
}

interface ReconcileOptions {
  /** Most events to send to the embedding model in one run (each is one OpenAI call). */
  maxEmbeds?: number
  embed?: typeof embedEventWithDocument
  embedText?: typeof generateEmbedding
  now?: Date
}

async function embedStoredDocument(db: D1Database, vectors: Vectorize, row: StoredVector, values: number[], queued = false) {
  const current = await readVector(db, row.id)
  if (!current || !await upsertPrepared(vectors, current, values, row)) return false
  if (queued) await clearQueue(db, current)
  return true
}

/** Nightly repair: rebuild stale documents, drain failed writes, and check live or recently changed vectors. */
export async function reconcileCatalog(db: D1Database, vectors: Vectorize, options: ReconcileOptions = {}) {
  const now = options.now ?? new Date()
  let budget = options.maxEmbeds ?? 200
  const embed = options.embed ?? embedEventWithDocument
  const embedText = options.embedText ?? generateEmbedding
  const result = { reembedded: 0, resynced: 0, restored: 0, metadataUpdated: 0, checked: 0, deferred: 0 }

  // 1. Artwork-only intake updates can retain stale text even at the current version. Compare the document first.
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
    const write = planVectorWrite(db, row.id, { source: 'rebuild', patch: { embedding, search_document: searchDocument, embedding_version: CURRENT_EMBEDDING_VERSION } })
    // Bypass intake protection only for these derived fields, and only if the facts used above are still current.
    const [, updated] = await db.batch(intakeCommitBatch(db, [
      db.prepare(`UPDATE events SET search_document = ?, embedding_version = ? WHERE id = ? AND status = 'scheduled'
        AND embedding_version IS ? AND search_document IS ?
        AND EXISTS (SELECT 1 FROM events_with_venues v WHERE v.id = events.id AND ${searchViewInputs.map(key => `v.${key} IS ?`).join(' AND ')})
        RETURNING id`)
        .bind(searchDocument, CURRENT_EMBEDDING_VERSION, row.id, row.embedding_version, row.search_document, ...searchViewInputs.map(key => row[key])),
      ...(write.queue ? [write.queue] : []),
    ]))
    if (!updated?.results.length || !await write.settle(vectors)) { result.deferred++; continue }
    reembedded.add(row.id)
    result.reembedded++
  }

  // 2. Retry failed writes using the stored document, not a writer's superseded preparation.
  const { results: pending } = await db.prepare(`SELECT ${vectorFields.map(key => `e.${key}`).join(', ')} FROM vector_sync q
    JOIN events e ON e.id = q.event_id ORDER BY q.queued_at`).all<StoredVector>()
  for (const row of pending) {
    if (reembedded.has(row.id)) continue
    if (!row.search_document) { await clearQueue(db, row); continue }
    if (budget <= 0) { result.deferred++; continue }
    budget--
    if (!await embedStoredDocument(db, vectors, row, await embedText(row.search_document), true)) { result.deferred++; continue }
    reembedded.add(row.id)
    result.resynced++
  }

  // 3. Every live or recently changed event should have current metadata. Restore only searchable missing vectors.
  const { results: live } = await db.prepare(`SELECT ${VECTOR_FIELDS} FROM events
    WHERE status NOT IN ('canceled', 'past') OR updated_at >= ? ORDER BY id`)
    .bind(new Date(now.getTime() - 48 * HOUR).toISOString()).all<StoredVector>()
  const toCheck = live.filter(row => !reembedded.has(row.id))
  result.checked = toCheck.length
  const { updated, missing } = await syncMetadata(vectors, toCheck)
  result.metadataUpdated = updated
  const byId = new Map(toCheck.map(row => [row.id, row]))
  for (const id of missing) {
    const row = byId.get(id)!
    if (!row.search_document || row.status === 'past' || row.status === 'canceled') continue
    if (budget <= 0) { result.deferred++; continue }
    budget--
    if (await embedStoredDocument(db, vectors, row, await embedText(row.search_document))) result.restored++
    else result.deferred++
  }
  return result
}

export const EMBEDDING_TASK_LIMIT = 200

/** Bounded manual repair; unlike nightly rebuild, it does not bypass intake protection. */
export async function runEmbeddingTask(
  task: 'populate-embeddings' | 'reembed-stale', db: D1Database, vectors: Vectorize, limit: number,
  { embed = embedEventWithDocument, embedText = generateEmbedding }: Pick<ReconcileOptions, 'embed' | 'embedText'> = {},
) {
  const result = { checked: 0, updated: 0, blocked: 0, more: false }
  async function repair(row: StaleRow, rebuild: boolean) {
    if (!rebuild && row.search_document) {
      if (await embedStoredDocument(db, vectors, row, await embedText(row.search_document))) result.updated++
      else result.blocked++
      return
    }
    const { embedding, searchDocument } = await embed(sourceForEmbedding(row))
    const write = planVectorWrite(db, row.id, { source: 'catalog', patch: { embedding, search_document: searchDocument, embedding_version: CURRENT_EMBEDDING_VERSION } })
    await db.batch([
      db.prepare('UPDATE events SET search_document = ?, embedding_version = ? WHERE id = ?').bind(searchDocument, CURRENT_EMBEDDING_VERSION, row.id),
      ...(write.queue ? [write.queue] : []),
    ])
    if (await write.settle(vectors)) result.updated++
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
      WHERE id > ? ORDER BY id LIMIT ${VECTOR_CHUNK}`).bind(after).all<StaleRow>()
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
