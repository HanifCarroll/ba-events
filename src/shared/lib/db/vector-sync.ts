/** D1 owns the search document; Vectorize holds its values under the event id and epoch-ms start metadata. */
import type { D1Database, Vectorize } from '@cloudflare/workers-types'
import { buildSearchDocument, CURRENT_EMBEDDING_VERSION, embedEventWithDocument, generateEmbedding } from '../ai/embeddings.ts'
import type { EventFacets } from '../search-facets.ts'
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
export type StoredVector = VectorRow & DocumentState
type SearchInputRow = {
  name: string; description_es: string | null; description_en: string | null; categories: string; facets: string
  price: number | null; is_free: number; venue_name: string | null; venue_neighborhood: string | null
}
type StaleRow = StoredVector & SearchInputRow

export type VectorPatch = { search_document?: string | null; embedding_version?: number | null; embedding?: number[] | null; status?: string | null; starts_at?: string | null }
type VectorWrite = { source: 'catalog'; patch: VectorPatch; documentChanged?: boolean }
  | { source: 'intake'; patch: VectorPatch; previous: { status?: unknown; starts_at?: unknown } | null }

/** The write-capable catalog index binding; search's read-only checks stay independent. */
export function boundVectorize(env: { VECTORIZE?: unknown }): Vectorize | null {
  const index = env.VECTORIZE as Partial<Vectorize> | undefined
  return typeof index?.upsert === 'function' && typeof index.getByIds === 'function' ? index as Vectorize : null
}

const metadata = (row: VectorRow) => ({ status: row.status, starts_at: Date.parse(row.starts_at) })

type ExpectedDocument = Pick<VectorPatch, 'search_document' | 'embedding_version'>
// Unspecified catalog fields are wildcards; an explicit NULL search document must still match D1.
const DOCUMENT_MATCH = '(? OR search_document IS ?) AND (? OR embedding_version IS ?)'
const documentMatchParams = (expected: ExpectedDocument) => [
  Number(expected.search_document === undefined), expected.search_document ?? null,
  Number(expected.embedding_version === undefined), expected.embedding_version ?? null,
]
const readVector = (db: D1Database, id: string, expected: ExpectedDocument) => db
  .prepare(`SELECT ${VECTOR_FIELDS}, (${DOCUMENT_MATCH}) AS document_matches FROM events WHERE id = ?`)
  .bind(...documentMatchParams(expected), id).first<StoredVector & { document_matches: number }>()

async function clearQueue(db: D1Database, row: StoredVector) {
  // A newer commit may have arrived while the provider call was in flight. Keep its repair queued.
  await db.prepare(`DELETE FROM vector_sync WHERE event_id = ? AND EXISTS (
    SELECT 1 FROM events WHERE id = ? AND search_document IS ? AND embedding_version IS ? AND status IS ? AND starts_at IS ?)`)
    .bind(row.id, row.id, row.search_document, row.embedding_version, row.status, row.starts_at).run()
}

/** Only a document that stuck gets the prepared embedding. A nightly rebuild can supersede an intake receipt, too. */
async function upsertPrepared(vectors: Vectorize, row: StoredVector & { document_matches: number }, values: number[]) {
  if (!row.document_matches) return false
  await vectors.upsert([{ id: row.id, values, metadata: metadata(row) }])
  return true
}

/**
 * Plan the index work for an event write. Append `queue`, when present, to the caller's D1 batch, then call `settle`
 * after commit. A thrown Vectorize write leaves the queue for reconcile. The gateway supplies only changes that it
 * permits; the later document comparison prevents publishing a preparation superseded by a concurrent write.
 */
export function planVectorWrite(db: D1Database, id: string, write: VectorWrite) {
  const { source, patch } = write
  const intake = source === 'intake'
  const embedding = intake ? patch.embedding : patch.embedding?.length ? patch.embedding : undefined
  const metadataChanged = write.source === 'intake'
    ? write.previous !== null && (write.previous.status !== patch.status ||
      Date.parse(String(write.previous.starts_at)) !== Date.parse(patch.starts_at ?? ''))
    : patch.status !== undefined || patch.starts_at !== undefined
  const documentChanged = source === 'catalog' && write.documentChanged
  // Preserve older repair work when only metadata changes. The metadata settle must not clear that older entry.
  const queue = source === 'catalog' && (embedding || documentChanged)
    ? db.prepare('INSERT OR REPLACE INTO vector_sync (event_id) VALUES (?)').bind(id)
    : embedding || metadataChanged
      ? db.prepare('INSERT INTO vector_sync (event_id) VALUES (?) ON CONFLICT (event_id) DO NOTHING RETURNING event_id').bind(id)
      : null

  return {
    queue,
    async settle(vectors: Vectorize, ownsQueue = false): Promise<boolean> {
      if (!embedding && !metadataChanged) return false
      const expected = intake ? { ...patch, embedding_version: patch.embedding_version ?? 1 } : patch
      const row = await readVector(db, id, expected)
      if (!row) return false
      if (embedding && (!intake || expected.search_document !== undefined) && await upsertPrepared(vectors, row, embedding)) {
        await clearQueue(db, row)
        return true
      }
      if (intake && !embedding) {
        // Intake metadata updates leave the queue: Vectorize can return stale values.
        await syncMetadata(vectors, [row], true)
      } else if (source === 'catalog' && metadataChanged && row.document_matches && !documentChanged && !embedding) {
        const { missing } = await syncMetadata(vectors, [row])
        if (ownsQueue && !missing.length) await clearQueue(db, row)
      }
      return false
    },
  }
}

/** Check the pending row and the caller's receipt predicate in the same read. */
export const hasPendingVector = (db: D1Database, id: string, receiptCondition: string, ...params: unknown[]) => db
  .prepare(`SELECT 1 FROM vector_sync WHERE event_id = ? AND (${receiptCondition})`).bind(id, ...params).first()

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

async function clearSettledRows(db: D1Database, queue: 'vector_sync' | 'vector_metadata_sync', rows: readonly StoredVector[]) {
  for (let offset = 0; offset < rows.length; offset += VECTOR_CHUNK) {
    await db.prepare(`DELETE FROM ${queue} WHERE event_id IN (
      SELECT e.id FROM json_each(?) s JOIN events e ON e.id = json_extract(s.value, '$.id')
      WHERE ${vectorFields.slice(1).map(key => `e.${key} IS json_extract(s.value, '$.${key}')`).join(' AND ')})`)
      .bind(JSON.stringify(rows.slice(offset, offset + VECTOR_CHUNK))).run()
  }
}

/** Queue hourly aging in the event batch, then rewrite metadata without regenerating embeddings. */
export function planPastVectors(db: D1Database, eligibility: string, values: readonly unknown[]) {
  return {
    queue: db.prepare(`INSERT INTO vector_sync (event_id) SELECT id FROM events WHERE ${eligibility}
      ON CONFLICT (event_id) DO NOTHING RETURNING event_id AS id`).bind(...values),
    async settle(vectors: Vectorize, applied: readonly StoredVector[], queued: readonly string[]) {
      const { updated, missing } = await syncMetadata(vectors, applied)
      const owned = new Set(queued)
      const absent = new Set(missing)
      const settled = applied.filter(row => owned.has(row.id) && !absent.has(row.id))
      await clearSettledRows(db, 'vector_sync', settled)
      return { marked: applied.length, vectorsUpdated: updated }
    },
  }
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
export function planCorrectedVector(before: DocumentState, field: EventColumn, after: SearchInputRow) {
  const document = searchInputs.has(field) ? buildSearchDocument(sourceForEmbedding(after)) : before.search_document
  const changed = document !== before.search_document
  // The HTTP transport has no index binding. The SQL envelope queues this for nightly settlement.
  return { document, version: changed ? CURRENT_EMBEDDING_VERSION - 1 : before.embedding_version,
    sync: changed ? 'document' : field === 'status' || field === 'starts_at' ? 'metadata' : null }
}

function rebuildGuard(row: StaleRow, scheduled: boolean) {
  return { sql: `${scheduled ? "status = 'scheduled' AND " : ''}embedding_version IS ? AND search_document IS ?
    AND EXISTS (SELECT 1 FROM events_with_venues v WHERE v.id = events.id AND ${searchViewInputs.map(key => `v.${key} IS ?`).join(' AND ')})`,
    values: [row.embedding_version, row.search_document, ...searchViewInputs.map(key => row[key])] }
}

interface ReconcileOptions {
  /** Most events to send to the embedding model in one run (each is one OpenAI call). */
  maxEmbeds?: number
  embed?: typeof embedEventWithDocument
  embedText?: typeof generateEmbedding
  now?: Date
}

async function embedStoredDocument(db: D1Database, vectors: Vectorize, row: StoredVector, values: number[], queued = false) {
  const current = await readVector(db, row.id, row)
  if (!current || !await upsertPrepared(vectors, current, values)) return false
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

  const { writeEvent, INTAKE_UPDATE_WITHOUT_EMBEDDING } = await import('./event-write.ts')
  // 1. Artwork-only intake updates can retain stale text even at the current version. Compare the document first.
  const { results: candidates } = await db.prepare(`SELECT ${EMBEDDING_FIELDS} FROM events_with_venues e
    WHERE (${STALE_DOCUMENT}) OR (e.status = 'scheduled' AND e.embedding_version = ? AND ${INTAKE_UPDATE_WITHOUT_EMBEDDING})
    ORDER BY starts_at, id`).bind(CURRENT_EMBEDDING_VERSION, CURRENT_EMBEDDING_VERSION).all<StaleRow>()
  const reembedded = new Set<string>()
  for (const row of candidates) {
    const input = sourceForEmbedding(row)
    if (row.embedding_version >= CURRENT_EMBEDDING_VERSION && row.search_document === buildSearchDocument(input)) continue
    if (budget <= 0) { result.deferred++; continue }
    budget--
    const { embedding, searchDocument } = await embed(input)
    const write = await writeEvent(db, vectors, { writer: 'maintenance', id: row.id,
      patch: { embedding, search_document: searchDocument, embedding_version: CURRENT_EMBEDDING_VERSION },
      guard: rebuildGuard(row, true),
    })
    if (write.vectorFailure) throw write.vectorFailure.error
    if (!write.vectorUpdated) { result.deferred++; continue }
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

  // 3. Metadata-only publisher work needs no fresh embedding. Include it even outside the normal drift scan.
  const metadataQueued = 'EXISTS (SELECT 1 FROM vector_metadata_sync m WHERE m.event_id = e.id)'
  const { results: live } = await db.prepare(`SELECT ${VECTOR_FIELDS}, (${metadataQueued}) AS metadata_queued FROM events e
    WHERE status NOT IN ('canceled', 'past') OR updated_at >= ? OR ${metadataQueued} ORDER BY id`)
    .bind(new Date(now.getTime() - 48 * HOUR).toISOString()).all<StoredVector & { metadata_queued: number }>()
  const toCheck = live.filter(row => !reembedded.has(row.id))
  result.checked = toCheck.length
  const { updated, missing } = await syncMetadata(vectors, toCheck)
  result.metadataUpdated = updated
  // A missing vector has no metadata to refresh. The ordinary live-vector restoration path below still applies.
  await clearSettledRows(db, 'vector_metadata_sync', live.filter(row => row.metadata_queued))
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
  const { writeEvent } = await import('./event-write.ts')
  const result = { checked: 0, updated: 0, blocked: 0, more: false }
  async function repair(row: StaleRow, rebuild: boolean) {
    if (!rebuild && row.search_document) {
      if (await embedStoredDocument(db, vectors, row, await embedText(row.search_document))) result.updated++
      else result.blocked++
      return
    }
    const { embedding, searchDocument } = await embed(sourceForEmbedding(row))
    const write = await writeEvent(db, vectors, { writer: 'manual-repair', id: row.id,
      patch: { embedding, search_document: searchDocument, embedding_version: CURRENT_EMBEDDING_VERSION }, guard: rebuildGuard(row, rebuild) })
    if (write.vectorFailure) throw write.vectorFailure.error
    if (write.vectorUpdated) result.updated++
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
