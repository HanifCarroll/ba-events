import type { D1Database } from '@cloudflare/workers-types'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { freshD1 } from '../../tests/support/d1.ts'
import { fakeVectorize } from '../../tests/support/vectorize.ts'
import { CURRENT_EMBEDDING_VERSION } from '#shared/lib/ai/embeddings.ts'
import { markPastEvents, reconcileCatalog, runCatalogTask } from './catalog-maintenance.ts'
import { d1Catalog } from '#features/import/core/catalog-store-d1.ts'

let db: D1Database
let dispose: () => Promise<void>
beforeAll(async () => { ({ db, dispose } = await freshD1()) }, 60_000)
afterAll(async () => { await dispose() })
beforeEach(async () => { await db.batch(['vector_sync', 'event_intake_protection', 'intake_plans', 'intake_candidates', 'events', 'venues'].map((table) => db.prepare(`DELETE FROM ${table}`))) })

const NOW = new Date('2030-01-10T12:00:00.000Z')
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString()
async function insert(id: string, fields: Record<string, unknown>) {
  const row = { name: id, source: 'meetup', status: 'scheduled', search_document: `doc ${id}`, embedding_version: CURRENT_EMBEDDING_VERSION, ...fields }
  const columns = Object.keys(row)
  await db.prepare(`INSERT INTO events (id, ${columns.join(', ')}) VALUES (?, ${columns.map(() => '?').join(', ')})`).bind(id, ...Object.values(row)).run()
}
const status = (id: string) => db.prepare('SELECT status FROM events WHERE id = ?').bind(id).first<string>('status')

describe('markPastEvents (pg_cron mark-past-events, PR #38)', () => {
  it('ages timed events 4 hours after they start, date-only events 28 hours after, and ended events at once', async () => {
    const { index, vectors } = fakeVectorize()
    await insert('timed-old', { starts_at: hoursAgo(5) })
    await insert('timed-recent', { starts_at: hoursAgo(3) })
    await insert('date-only-old', { starts_at: hoursAgo(29), time_tba: 1 })
    await insert('date-only-today', { starts_at: hoursAgo(12), is_all_day: 1 })
    await insert('ended', { starts_at: hoursAgo(2), ends_at: hoursAgo(1) })
    await insert('running', { starts_at: hoursAgo(10), ends_at: hoursAgo(-1) })
    await insert('pending-review', { starts_at: hoursAgo(5), status: 'pending_review' })
    await insert('canceled', { starts_at: hoursAgo(50), status: 'canceled' })
    await index.upsert([{ id: 'timed-old', values: [0.1], metadata: { status: 'scheduled', starts_at: Date.parse(hoursAgo(5)) } }])

    expect(await markPastEvents(db, index, NOW)).toEqual({ marked: 4, vectorsUpdated: 1 })
    for (const id of ['timed-old', 'date-only-old', 'ended', 'pending-review']) expect(await status(id), id).toBe('past')
    for (const id of ['timed-recent', 'date-only-today', 'running']) expect(await status(id), id).toBe('scheduled')
    expect(await status('canceled')).toBe('canceled')
    expect(vectors.get('timed-old')).toMatchObject({ values: [0.1], metadata: { status: 'past' } })
    expect(await markPastEvents(db, index, NOW)).toEqual({ marked: 0, vectorsUpdated: 0 })
  })
})

describe('reconcileCatalog (nightly reembed-stale and Vectorize check)', () => {
  it('re-embeds stale documents, restores missing vectors, fixes metadata, and leaves past events alone', async () => {
    const { index, vectors } = fakeVectorize()
    const starts = '2030-02-01T23:00:00.000Z'
    await db.prepare("INSERT INTO venues (id, name, neighborhood) VALUES ('v', 'Sala Sintética', 'Palermo')").run()
    await insert('stale', { starts_at: starts, embedding_version: 1, venue_id: 'v', facets: '{"genres":["jazz"]}' })
    await insert('no-vector', { starts_at: starts })
    await insert('wrong-meta', { starts_at: starts })
    await insert('fine', { starts_at: starts })
    await insert('old-past', { starts_at: '2029-01-01T00:00:00.000Z', status: 'past' })
    await db.prepare("UPDATE events SET updated_at = '2029-01-02T00:00:00.000Z' WHERE id = 'old-past'").run()
    await index.upsert([
      { id: 'wrong-meta', values: [0.2], metadata: { status: 'canceled', starts_at: 0 } },
      { id: 'fine', values: [0.3], metadata: { status: 'scheduled', starts_at: Date.parse(starts) } },
    ])
    const embed = vi.fn(async (_event: object) => ({ embedding: [0.9], searchDocument: 'rebuilt' }))
    const embedText = vi.fn(async () => [0.7])

    const result = await reconcileCatalog(db, index, { embed, embedText, now: NOW })
    expect(result).toEqual({ reembedded: 1, resynced: 0, restored: 1, metadataUpdated: 1, checked: 3, deferred: 0 })
    expect(embed.mock.calls[0]![0]).toMatchObject({ venue_name: 'Sala Sintética', venue_neighborhood: 'Palermo', facets: { genres: ['jazz'] }, is_free: false })
    expect(await db.prepare("SELECT search_document, embedding_version FROM events WHERE id = 'stale'").first()).toEqual({ search_document: 'rebuilt', embedding_version: CURRENT_EMBEDDING_VERSION })
    expect(vectors.get('stale')!.values).toEqual([0.9])
    expect(embedText).toHaveBeenCalledWith('doc no-vector')
    expect(vectors.get('no-vector')).toMatchObject({ values: [0.7], metadata: { status: 'scheduled', starts_at: Date.parse(starts) } })
    expect(vectors.get('wrong-meta')).toMatchObject({ values: [0.2], metadata: { status: 'scheduled' } })
    expect(vectors.has('old-past')).toBe(false)

    expect(await reconcileCatalog(db, index, { embed, embedText, now: NOW })).toEqual({ reembedded: 0, resynced: 0, restored: 0, metadataUpdated: 0, checked: 4, deferred: 0 })
  })

  it('replaces a vector whose write failed after an event update committed', async () => {
    const { index, vectors, failUpserts } = fakeVectorize()
    const catalog = d1Catalog(db, index)
    await insert('changed', { starts_at: '2030-02-01T23:00:00.000Z', search_document: 'old text' })
    await index.upsert([{ id: 'changed', values: [0.1], metadata: { status: 'scheduled', starts_at: Date.parse('2030-02-01T23:00:00.000Z') } }])
    failUpserts(1)
    await expect(catalog.updateEvent('changed', { name: 'New name', search_document: 'new text', embedding: [0.8] })).rejects.toThrow('injected')
    expect(await db.prepare("SELECT search_document FROM events WHERE id = 'changed'").first('search_document')).toBe('new text')
    expect(vectors.get('changed')!.values).toEqual([0.1])

    const embedText = vi.fn(async () => [0.6])
    expect(await reconcileCatalog(db, index, { embedText, now: NOW })).toMatchObject({ resynced: 1, restored: 0 })
    expect(embedText).toHaveBeenCalledWith('new text')
    expect(vectors.get('changed')!.values).toEqual([0.6])
    expect(await db.prepare('SELECT count(*) AS n FROM vector_sync').first('n')).toBe(0)
  })

  it('retries a nightly re-embedding whose vector write failed', async () => {
    const { index, vectors, failUpserts } = fakeVectorize()
    await insert('stale', { starts_at: '2030-02-01T23:00:00.000Z', embedding_version: 1 })
    await index.upsert([{ id: 'stale', values: [0.1], metadata: { status: 'scheduled', starts_at: Date.parse('2030-02-01T23:00:00.000Z') } }])
    const embed = vi.fn(async (_event: object) => ({ embedding: [0.9], searchDocument: 'rebuilt' }))
    failUpserts(1)
    await expect(reconcileCatalog(db, index, { embed, now: NOW })).rejects.toThrow('injected')
    // D1 now says the document is current, so step 1 won't pick it up again; the queue entry does.
    expect(await db.prepare("SELECT embedding_version FROM events WHERE id = 'stale'").first('embedding_version')).toBe(CURRENT_EMBEDDING_VERSION)
    const embedText = vi.fn(async () => [0.7])
    expect(await reconcileCatalog(db, index, { embed, embedText, now: NOW })).toMatchObject({ reembedded: 0, resynced: 1 })
    expect(embedText).toHaveBeenCalledWith('rebuilt')
    expect(vectors.get('stale')!.values).toEqual([0.7])
  })

  it('stops calling the embedding model at its budget and reports what is left', async () => {
    const { index } = fakeVectorize()
    for (const id of ['a', 'b', 'c']) await insert(id, { starts_at: '2030-02-01T23:00:00.000Z', search_document: null })
    const embed = vi.fn(async () => ({ embedding: [0.1], searchDocument: 'x' }))
    expect(await reconcileCatalog(db, index, { embed, maxEmbeds: 2, now: NOW })).toMatchObject({ reembedded: 2, deferred: 1 })
    expect(embed).toHaveBeenCalledTimes(2)
  })
})

describe('runCatalogTask', () => {
  it('does nothing without a D1 binding, as in production until the cutover', async () => {
    await expect(runCatalogTask('mark-past-events', {} as never)).resolves.toEqual({ skipped: 'no D1 binding' })
    await expect(runCatalogTask('reconcile-vectors', {} as never)).resolves.toEqual({ skipped: 'no D1 binding' })
  })
})
