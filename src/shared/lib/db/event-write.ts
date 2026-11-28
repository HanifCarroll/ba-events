import type { D1Database, D1PreparedStatement, Vectorize } from '@cloudflare/workers-types'
import { buildSearchDocument, CURRENT_EMBEDDING_VERSION } from '../ai/embeddings.ts'
import { batchAssert } from './d1.server.ts'
import { eventColumnsWith, type EventColumn } from './event-columns.ts'
import { hasPendingVector, planCorrectedVector, planPastVectors, planVectorWrite, sourceForEmbedding, type StoredVector, type VectorPatch } from './vector-sync.ts'

type Row = Record<string, unknown>
type Patch = Partial<Record<EventColumn, unknown>>
type Writer = 'importer' | 'enrichment' | 'manual-repair' | 'maintenance'
type Guard = { sql: string; values: readonly unknown[] }

export interface EventWriteResult {
  /** Changed catalog columns, not attempted assignments or index-only work. */
  applied: EventColumn[]
  /** Requested changes rejected by field authority. Unchanged values are in neither list. */
  kept: EventColumn[]
}

export type VenueWriteResult = EventWriteResult & { id: string }
export type CatalogUpdateResult = EventWriteResult & { vectorFailure?: { error: unknown } }

const facts = new Set<string>(eventColumnsWith('protection', 'facts'))
const details = new Set<string>(eventColumnsWith('protection', 'details'))
const derived = ['search_document', 'embedding_version'] as const
const intakeFields = eventColumnsWith('intakeWrite', 'both')
export type IntakeEventPatch = Record<(typeof intakeFields)[number], unknown>
const intakeDetails = eventColumnsWith('protection', 'details')
const intakeProtected = [...eventColumnsWith('protectOnCommit', true), 'embedding'] // Legacy marker; vectors live outside D1.
const catalogFields = eventColumnsWith('catalog', 'write', 'read-write')
const revisionFields = eventColumnsWith('advancesRevision', true)

const searchInputs = new Set<EventColumn>(eventColumnsWith('searchDocument', true))

/** Field precedence for catalog writers; SQL triggers backstop direct writes.
 * A publisher correction owns its field until another publisher correction; intake's evidence and write context
 * cannot override it. Intake may still correct other facts. Import, enrichment, and manual repair also respect intake
 * authority. Never store a document or vector prepared from a refused search input. Hourly aging uses the stored start
 * (including a publisher-corrected start), and can expire a scheduled event even when status is locked.
 * Hidden locations always clear their venue. Guarded repairs can derive search data from the prevailing facts.
 */
const sqlNow = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"
const aged = `status = 'scheduled' AND starts_at < ${sqlNow}`

function pairs(patch: Patch, allowed: readonly EventColumn[]) {
  return Object.entries(patch).filter(([, value]) => value !== undefined).map(([key, value]) => {
    const column = allowed.find(column => column === key)
    if (!column) throw new Error(`Unknown event column ${key}`)
    return [column, value] as const
  })
}

type Assignments = ReturnType<typeof pairs>

/** Compare a proposed search input with the prevailing publisher value before calling the embedding provider. */
export function hasRefusedPublisherSearchInput(previous: Row | null | undefined, patch: Patch) {
  if (!previous) return false
  const locked = publisherSet(previous)
  return [...searchInputs].some(key => locked.has(key) && (previous[key] ?? null) !== (patch[key] ?? null))
}

/** Read the document inputs from the effective row, not from a refused proposal or a stale caller snapshot. */
async function documentFromEffectiveFacts(db: Pick<D1Database, 'prepare'>, previous: Row, effective: Assignments) {
  const row = { ...previous, ...Object.fromEntries(effective) }
  const venue = row.venue_id == null ? null : await db.prepare('SELECT name, neighborhood FROM venues WHERE id = ?')
    .bind(row.venue_id).first<{ name: string; neighborhood: string | null }>()
  return buildSearchDocument(sourceForEmbedding({ ...row, venue_name: venue?.name ?? null,
    venue_neighborhood: venue?.neighborhood ?? null } as Parameters<typeof sourceForEmbedding>[0]))
}

/** A mixed write can change unlocked search inputs. Queue only a changed, canonical document. */
const rebuiltDocument = (previous: Row, document: string): Assignments => document === previous.search_document ? [] :
  [['search_document', document], ['embedding_version', CURRENT_EMBEDDING_VERSION - 1]]

function insert(db: D1Database, id: string, entries: Assignments) {
  return db.prepare(`INSERT INTO events (id, ${entries.map(([key]) => key).join(', ')}) VALUES (?, ${entries.map(() => '?').join(', ')})`)
    .bind(id, ...entries.map(([, value]) => value))
}
function update(db: D1Database, id: string, entries: Assignments) {
  return db.prepare(`UPDATE events SET ${entries.map(([key]) => `${key} = ?`).join(', ')} WHERE id = ?`)
    .bind(...entries.map(([, value]) => value), id)
}

export async function insertImportedEvent(db: D1Database, vectors: Vectorize, id: string, patch: Patch & VectorPatch) {
  const { embedding, ...row } = patch
  if (row.location_hidden === 1) row.venue_id = null
  const statement = insert(db, id, pairs(row, catalogFields))
  if (!embedding?.length) { await statement.run(); return }
  const write = planVectorWrite(db, id, { source: 'catalog', patch: { ...row, embedding } })
  await db.batch([statement, ...(write.queue ? [write.queue] : [])])
  await write.settle(vectors)
}

const protectionFields = '(SELECT fields FROM event_intake_protection WHERE event_id = events.id)'
export const publisherFields = `(SELECT json_group_object(field, operation ORDER BY field) FROM publisher_field_lock WHERE event_id = events.id)`
const publisherSet = (row: Row) => new Set(Object.keys(JSON.parse(typeof row.publisher_fields === 'string' ? row.publisher_fields : '{}')))
const staleWrite = 'Event write snapshot changed'

/** Read authority on the primary, then check the same revision fields and ledger inside the write batch. */
export async function writeEvent(db: D1Database, vectors: Vectorize | null, request: {
  writer: Writer; id: string; patch: Patch & VectorPatch; guard?: Guard
}): Promise<CatalogUpdateResult & { vectorUpdated: boolean }> {
  const { writer, id, guard, patch: { embedding, ...patch } } = request
  const repair = writer === 'maintenance'
  const requested = pairs(patch, repair ? derived : catalogFields)
  if (repair && !guard) throw new Error('Maintenance repair requires a current-input check')
  const predicate = `id = ? AND (${guard?.sql ?? '1'})`
  const params = [id, ...(guard?.values ?? [])]
  const select = `${revisionFields.join(', ')}, ${protectionFields} AS protected_fields, ${publisherFields} AS publisher_fields, (${aged}) AS can_age`
  const session = db.withSession('first-primary')
  for (let attempt = 0; ; attempt++) {
    const previous = await session.prepare(`SELECT ${select} FROM events WHERE ${predicate}`).bind(...params).first<Row & { protected_fields: string | null; can_age: number }>()
    if (!previous) return { applied: [], kept: [], vectorUpdated: false }
    const protectedSet = new Set<string>(JSON.parse(previous.protected_fields ?? '[]'))
    const locked = publisherSet(previous)
    const kept: EventColumn[] = []
    const changes = requested.filter(([key, value]) => value !== previous[key])
    const hidden = (protectedSet.has('location_hidden') ? previous.location_hidden : (patch.location_hidden === undefined ? previous.location_hidden : patch.location_hidden)) === 1
    const allowed = changes.filter(([key, value]) => {
      if (writer === 'manual-repair' && !derived.some(column => column === key)) {
        if (!locked.has(key)) throw new Error(`Manual embedding repair cannot set ${key}`)
      } else {
        if (key === 'status' && value === 'past' && previous.can_age) return true
        if (!locked.has(key) && (repair || !protectedSet.has(key) || !facts.has(key) && !details.has(key) ||
          (key === 'venue_id' && value === null && hidden))) return true
      }
      kept.push(key)
      return false
    })
    const publisherRefusal = kept.some(key => locked.has(key))
    const effective = allowed.filter(([key]) => !derived.some(column => column === key) && (!hidden || key !== 'venue_id'))
    if (hidden && previous.venue_id !== null) effective.push(['venue_id', null])
    const changedSearch = effective.some(([key]) => searchInputs.has(key))
    const protectsInputs = [...searchInputs].some(key => locked.has(key))
    const proposesDocument = embedding?.length || changes.some(([key]) => derived.some(column => key))
    const document = (publisherRefusal && changedSearch || protectsInputs && (changedSearch || proposesDocument))
      ? await documentFromEffectiveFacts(session, previous, effective) : undefined
    const stalePreparation = document !== undefined && proposesDocument &&
      (patch.search_document === undefined ? previous.search_document : patch.search_document) !== document
    const keepDocument = stalePreparation || kept.some(key => facts.has(key))
    for (const entry of allowed) {
      if (!derived.some(column => column === entry[0])) continue
      if (keepDocument) kept.push(entry[0])
      else effective.push(entry)
    }
    // When a mixed write discarded its proposal, only our local derivation may bypass intake's derived-field lock.
    const rebuilt = changedSearch && document !== undefined && (keepDocument || !proposesDocument ||
      !effective.some(([key]) => key === 'search_document')) ? rebuiltDocument(previous, document) : []
    if (rebuilt.length) {
      effective.push(...rebuilt.filter(([key]) => !effective.some(([existing]) => existing === key)))
    }
    const applied = effective.filter(([key, value]) => value !== previous[key]).map(([key]) => key)
    const next: Row = { ...previous, ...Object.fromEntries(effective) }
    const vector = planVectorWrite(db, id, { source: 'catalog', patch: {
      // Match the full stored pair before using a prepared vector, including fields omitted by the caller.
      search_document: next.search_document as string | null,
      embedding_version: next.embedding_version as number,
      embedding: keepDocument || rebuilt.length ? undefined : embedding,
      status: applied.includes('status') ? patch.status : undefined,
      starts_at: applied.includes('starts_at') ? patch.starts_at : undefined,
    }, documentChanged: applied.some(key => derived.some(column => column === key)) })
    if (!applied.length && !vector.queue) return { applied, kept, vectorUpdated: false }
    // Comparing revision columns as well as the timestamp catches independent writes in the same millisecond.
    const same = `(${revisionFields.join(', ')}) IS (${revisionFields.map(key => `json_extract(snapshot.row, '$.${key}')`).join(', ')})`
    const check = batchAssert(db, staleWrite, `EXISTS (SELECT 1 FROM events, (SELECT ? AS row) snapshot WHERE ${predicate}
      AND ${same} AND ${protectionFields} IS ? AND ${publisherFields} IS ? AND (${aged}) IS ?)`,
      JSON.stringify(previous), ...params, previous.protected_fields, previous.publisher_fields, previous.can_age)
    const writes = [...(effective.length ? [update(db, id, effective)] : []), ...(vector.queue ? [vector.queue] : [])]
    let queued = false
    try {
      const override = repair || rebuilt.length > 0
      const result = await session.batch(override ? withProtectionOverride(db, [check], writes) : [check, ...writes])
      queued = !!vector.queue && !!result[result.length - (override ? 2 : 1)]?.results.length
    } catch (error) {
      if (attempt === 2 || !(error instanceof Error && error.message.includes(`${staleWrite}: SQLITE_CONSTRAINT`))) throw error
      continue
    }
    try {
      return { applied, kept, vectorUpdated: vectors ? await vector.settle(vectors, queued) : false }
    } catch (error) {
      // The catalog and its retry entry have committed. Let callers report indexing failure without counting a failed write.
      return { applied, kept, vectorUpdated: false, vectorFailure: { error } }
    }
  }
}

/** Classify and apply venue review assignments together. No search text or metadata changes. */
export async function setEventVenues(db: D1Database, ids: readonly string[], venue: string): Promise<VenueWriteResult[]> {
  if (!ids.length) return []
  const targets = 'id IN (SELECT value FROM json_each(?)) AND venue_id IS NOT ?'
  const blocked = `(location_hidden IS 1 OR EXISTS (SELECT 1 FROM json_each(${protectionFields}) WHERE value = 'venue_id'))`
  const params = [JSON.stringify(ids), venue]
  const [kept, applied] = await db.batch<{ id: string }>([
    db.prepare(`SELECT id FROM events WHERE ${targets} AND ${blocked}`).bind(...params),
    db.prepare(`UPDATE events SET venue_id = ? WHERE ${targets} AND NOT ${blocked} RETURNING id`).bind(venue, ...params),
  ])
  const keptIds = new Set(kept.results.map(row => row.id))
  const appliedIds = new Set(applied.results.map(row => row.id))
  return ids.map(id => ({ id, applied: appliedIds.has(id) ? ['venue_id'] : [], kept: keptIds.has(id) ? ['venue_id'] : [] }))
}

export async function expireEvents(db: D1Database, vectors: Vectorize, { sql, values }: Guard) {
  const eligible = `(${sql}) AND ((status = 'scheduled' AND starts_at < ?) OR NOT EXISTS (
    SELECT 1 FROM json_each(${protectionFields}) WHERE value = 'status'
    UNION ALL SELECT 1 FROM publisher_field_lock WHERE event_id = events.id AND field = 'status'))`
  const params = [...values, new Date().toISOString()]
  const vector = planPastVectors(db, eligible, params)
  const [queued, expired] = await db.batch<StoredVector>([
    vector.queue, db.prepare(`UPDATE events SET status = 'past' WHERE ${eligible} RETURNING id, status, starts_at, search_document, embedding_version`).bind(...params),
  ])
  return vector.settle(vectors, expired.results, queued.results.map(row => row.id))
}

function withProtectionOverride(db: D1Database, checks: D1PreparedStatement[], writes: D1PreparedStatement[]) {
  return [...checks, db.prepare('INSERT INTO write_context (intake_commit) VALUES (1)'), ...writes, db.prepare('DELETE FROM write_context')]
}

export async function checkIntakeAuthority(db: D1Database, id: string, authority: number, observedAt: string) {
  const existing = await db.prepare('SELECT authority, observed_at FROM event_intake_protection WHERE event_id = ?').bind(id)
    .first<{ authority: number; observed_at: string }>()
  if (authority < 2 || existing && (authority < existing.authority || observedAt < existing.observed_at)) {
    throw new Error('Correction needs current organizer or venue evidence')
  }
  return existing?.observed_at
}

/** An artwork-only update can leave an old document even at the current version. */
export const INTAKE_UPDATE_WITHOUT_EMBEDDING = `EXISTS (
  SELECT 1 FROM event_intake_protection p JOIN intake_plans i ON i.id = p.plan_id
  WHERE p.event_id = e.id AND i.action = 'update' AND json_extract(i.payload, '$.embedding') IS NULL)`

/** A prepared document can contain the proposed venue. Reject it before preparation and again in the commit batch. */
export function intakeVenueChecks(db: D1Database, id: string, venue: unknown): D1PreparedStatement[] {
  return venue == null ? [] : [batchAssert(db, 'Intake cannot attach a venue to a hidden-location event',
    'NOT EXISTS (SELECT 1 FROM events WHERE id = ? AND location_hidden = 1)', id)]
}

export async function commitIntakeEvent(db: D1Database, vectors: Vectorize, request: {
  id: string; planId: string; action: 'create' | 'update' | 'link'; patch: IntakeEventPatch
  create: { link: string | null; external_id: string }; previous: Row | null; vectorPatch: VectorPatch
  evidence: { authority: number; observedAt: string; details: readonly EventColumn[] }
  checks: D1PreparedStatement[]; recordEvidence: D1PreparedStatement; recordReceipt: (result: EventWriteResult) => D1PreparedStatement
}): Promise<{ result: EventWriteResult; settle: () => Promise<boolean | undefined> }> {
  const { id, action, previous, evidence, planId } = request
  const linked = action === 'link'
  const { patch } = request
  const fields = linked ? [] : pairs(action === 'create' ? { ...patch, ...request.create, source: 'instagram' } : patch,
    action === 'create' ? eventColumnsWith('intakeWrite', 'create', 'both') : intakeFields)
  const locked = previous ? publisherSet(previous) : new Set<string>()
  const kept = fields.filter(([key, value]) => locked.has(key) && value !== previous?.[key]).map(([key]) => key)
  const refusedSearch = kept.some(key => searchInputs.has(key))
  const effective = fields.filter(([key]) => !locked.has(key) && (!refusedSearch || !derived.some(column => column === key)))
  if (refusedSearch && previous && effective.some(([key, value]) => searchInputs.has(key) && previous[key] !== value)) {
    effective.push(...rebuiltDocument(previous, await documentFromEffectiveFacts(db, previous, effective)))
  }
  const applied = effective.filter(([key, value]) => !previous || previous[key] !== value).map(([key]) => key)
  const next = Object.fromEntries(effective)
  const vector = linked ? null : refusedSearch ? planVectorWrite(db, id, { source: 'catalog', patch: {
    status: applied.includes('status') ? patch.status as string : undefined,
    starts_at: applied.includes('starts_at') ? patch.starts_at as string : undefined,
  }, documentChanged: applied.some(key => derived.some(column => column === key)) }) : planVectorWrite(db, id, {
    source: 'intake', previous, patch: { ...request.vectorPatch, status: (next.status ?? previous?.status) as string,
      starts_at: (next.starts_at ?? previous?.starts_at) as string },
  })
  const writes = []
  if (!linked && effective.length) writes.push(action === 'create' ? insert(db, id, effective) : update(db, id, effective))
  writes.push(request.recordEvidence)
  if (!linked) {
    if (vector?.queue) writes.push(vector.queue)
    const protects = [...intakeProtected, ...intakeDetails.filter(column => evidence.details.includes(column))]
    writes.push(db.prepare(`INSERT INTO event_intake_protection (event_id, fields, plan_id, authority, observed_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (event_id) DO UPDATE SET fields = (SELECT json_group_array(value) FROM (
        SELECT value FROM json_each(event_intake_protection.fields) UNION SELECT value FROM json_each(excluded.fields)
      )), plan_id = excluded.plan_id, authority = excluded.authority, observed_at = excluded.observed_at`)
      .bind(id, JSON.stringify(protects), planId, evidence.authority, evidence.observedAt))
  }
  const result = { applied, kept }
  writes.push(request.recordReceipt(result))
  const checks = [...request.checks, ...(action === 'update' ? [...intakeVenueChecks(db, id, patch.venue_id),
    batchAssert(db, 'Catalog changed after preview', `EXISTS (SELECT 1 FROM events WHERE id = ? AND ${publisherFields} IS ?)`,
      id, previous?.publisher_fields)] : [])]
  await db.batch(withProtectionOverride(db, checks, writes))
  // The caller must settle outside the catch that handles a concurrent receipt.
  return { result, settle: async () => vector?.settle(vectors) }
}

export async function replayIntakeVector(db: D1Database, vectors: Vectorize, id: string, planId: string, patch: VectorPatch, previous: Row | null,
  kept: unknown) {
  const refused = new Set(Array.isArray(kept) ? kept : [])
  // Mixed writes queued a rebuild from the effective row. The plan may still carry an older, refused preparation.
  if ([...searchInputs].some(key => refused.has(key))) return
  if (!await hasPendingVector(db, id, 'EXISTS (SELECT 1 FROM event_intake_protection WHERE event_id = ? AND plan_id = ?)', id, planId)) return
  await planVectorWrite(db, id, { source: 'intake', previous, patch: { ...patch,
    status: refused.has('status') ? previous?.status as string : patch.status,
    starts_at: refused.has('starts_at') ? previous?.starts_at as string : patch.starts_at,
  } }).settle(vectors)
}

/** D1 HTTP's one-statement transport uses the existing guarded publisher-fix trigger as its atomic write envelope. */
export async function writePublisherCorrection(query: (sql: string, params: string[]) => Promise<unknown[]>, input: {
  candidatesSql: string; params: string[]; snapshot: Array<{ id: string }>; compare: readonly string[]
  beforeCommit: () => string | Promise<string>; field: EventColumn; patch: Array<{ id: string; to: string | number | null;
    before: Parameters<typeof planCorrectedVector>[0]; after: Parameters<typeof planCorrectedVector>[2] }>
}) {
  const compare = input.compare.map(key => `c.${key} IS json_extract(old.value, '$.${key}')`).join(' AND ')
  const updates = input.patch.map(({ id, to, before, after }) => ({ id, to, ...planCorrectedVector(before, input.field, after) }))
  const operation = await input.beforeCommit()
  const acknowledgement = await query(`WITH candidates AS (${input.candidatesSql}), snapshot AS (SELECT value FROM json_each(?))
    INSERT INTO publisher_catalog_fixes (operation, field, changes)
    SELECT ?, ?, ? WHERE (SELECT count(*) FROM candidates) = CAST(? AS INTEGER) AND NOT EXISTS (
      SELECT 1 FROM snapshot old WHERE NOT EXISTS (
        SELECT 1 FROM candidates c WHERE c.id = json_extract(old.value, '$.id') AND ${compare}))
    RETURNING operation`, [...input.params, JSON.stringify(input.snapshot), operation, input.field, JSON.stringify(updates), String(input.snapshot.length)])
  const applied = acknowledgement.length ? updates.map((update, index) => {
    const columns = [input.field]
    const { before } = input.patch[index]
    if (before.search_document !== update.document) columns.push('search_document')
    if (before.embedding_version !== update.version) columns.push('embedding_version')
    return { id: update.id, applied: columns, kept: [] } satisfies EventWriteResult & { id: string }
  }) : []
  return { operation, acknowledgement, applied }
}
