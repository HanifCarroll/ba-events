import type { D1Database } from '@cloudflare/workers-types'
import { expect, it } from 'vitest'
import { applyD1Migration, freshD1, withTestIntakeContext } from '../../../../tests/support/d1.ts'
import { fakeVectorize } from '../../../../tests/support/vectorize.ts'
import { markPastEvents } from '../../../jobs-worker/catalog-maintenance.ts'
import { writeEvent } from './event-write.ts'

const migration = '0011_publisher_field_lock.sql'
const oldStart = '2025-02-02T00:00:00.000Z'
const future = '2099-02-02T00:00:00.000Z'
const older = '2025-02-01T20:00:00.000Z'
const event = (db: D1Database, id: string, start = future) => db.prepare(`INSERT INTO events (id, name, starts_at, source,
  search_document, embedding_version) VALUES (?, 'Synthetic', ?, 'luma', 'Synthetic', 2)`).bind(id, start).run()
const fix = (db: D1Database, operation: string, field: string, changes: object[]) => db.prepare(`INSERT INTO publisher_catalog_fixes
  (operation, field, changes, applied_at) VALUES (?, ?, ?, '2025-01-01T00:00:00.000Z')`).bind(operation, field, JSON.stringify(changes)).run()
const change = (id: string, to: string | number | null, document = 'Synthetic') => ({ id, to, document, version: 2 })
const locks = async (db: D1Database) => (await db.prepare('SELECT * FROM publisher_field_lock ORDER BY event_id, field').all()).results

it('backfills historical publisher authority once, and supports legacy receipt writes against the new schema', async () => {
  const { db, dispose } = await freshD1('0010_publisher_vector_queue.sql')
  try {
    await event(db, 'a'); await event(db, 'b'); await event(db, 'removed')
    await fix(db, 'z-first', 'name', [change('a', 'First'), change('b', 'First'), change('removed', 'First')])
    await fix(db, 'a-later', 'name', [change('a', 'Latest')])
    await fix(db, 'price', 'price', [change('a', 1500)])
    await db.prepare("DELETE FROM events WHERE id = 'removed'").run()
    // A legacy write could already have superseded a historical fix. Backfill does not rewrite the current row.
    await db.prepare("UPDATE events SET name = 'Currently stored', search_document = 'Currently stored' WHERE id = 'a'").run()
    const before = await db.prepare('SELECT * FROM events ORDER BY id').all()
    const expected = [
      { event_id: 'a', field: 'name', operation: 'a-later' }, { event_id: 'a', field: 'price', operation: 'price' },
      { event_id: 'b', field: 'name', operation: 'z-first' },
    ]
    for (let pass = 0; pass < 2; pass++) {
      await applyD1Migration(db, migration)
      expect(await locks(db)).toEqual(expected)
      expect((await db.prepare('SELECT * FROM events ORDER BY id').all()).results).toEqual(before.results)
    }
    const bad = db.prepare("UPDATE events SET name = 'Bad', search_document = 'Bad', min_age = 18 WHERE id = 'a'")
    await expect(bad.run()).rejects.toThrow('Publisher-corrected event field is locked')
    await expect(withTestIntakeContext(db, [bad])).rejects.toThrow('Publisher-corrected event field is locked')
    expect(await db.prepare('SELECT * FROM write_context').first()).toBeNull()
    expect(await db.prepare("SELECT name, search_document, min_age FROM events WHERE id = 'a'").first())
      .toEqual({ name: 'Currently stored', search_document: 'Currently stored', min_age: null })
    // Legacy command payloads omit the vector sync hint, but still atomically acquire the lock.
    await fix(db, 'legacy', 'name', [change('a', 'Legacy publisher', 'Legacy publisher')])
    expect(await locks(db)).toEqual([{ ...expected[0], operation: 'legacy' }, ...expected.slice(1)])
    expect(await db.prepare("SELECT name FROM events WHERE id = 'a'").first('name')).toBe('Legacy publisher')
    await expect(fix(db, 'failed', 'name', [change('a', null)])).rejects.toThrow()
    expect(await db.prepare("SELECT operation FROM publisher_catalog_fixes WHERE operation = 'failed'").first()).toBeNull()
    await db.prepare(`INSERT OR IGNORE INTO publisher_catalog_fixes (operation, field, changes)
      VALUES ('legacy', 'name', '[]')`).run()
    expect(await db.prepare('SELECT operation FROM publisher_fix_context').first()).toBeNull()
    expect(await locks(db)).toEqual([{ ...expected[0], operation: 'legacy' }, ...expected.slice(1)])
  } finally { await dispose() }
}, 30_000)

it('queues a mixed write from accepted search facts and keeps manual repair from changing a corrected field', async () => {
  const { db, dispose } = await freshD1()
  try {
    const { index, vectors } = fakeVectorize()
    await event(db, 'mixed')
    await index.upsert([{ id: 'mixed', values: [0.2], metadata: { status: 'scheduled', starts_at: Date.parse(future) } }])
    await fix(db, 'title', 'name', [change('mixed', 'Publisher title', 'Publisher title')])
    const manual = await writeEvent(db, index, { id: 'mixed', writer: 'manual-repair', patch: { name: 'Refused title' } })
    expect(manual).toMatchObject({ applied: [], kept: ['name'], vectorUpdated: false })
    const mixed = await writeEvent(db, index, { id: 'mixed', writer: 'importer', patch: {
      name: 'Refused title', description_es: 'Descripción nueva', search_document: 'Refused title', embedding: [0.9],
    } })
    expect(mixed).toMatchObject({ kept: ['name', 'search_document'], vectorUpdated: false })
    const document = await db.prepare("SELECT search_document FROM events WHERE id = 'mixed'").first('search_document')
    expect(document).toContain('Publisher title')
    expect(document).toContain('Descripción nueva')
    expect(document).not.toContain('Refused title')
    expect(vectors.get('mixed')?.values).toEqual([0.2])
    expect(await db.prepare("SELECT event_id FROM vector_sync WHERE event_id = 'mixed'").first()).not.toBeNull()
  } finally { await dispose() }
}, 30_000)

it('ages a publisher-locked scheduled status using the publisher-corrected start', async () => {
  const { db, dispose } = await freshD1()
  try {
    for (const id of ['aged', 'future']) {
      await event(db, id, id === 'aged' ? future : oldStart)
      await fix(db, `${id}-status`, 'status', [change(id, 'scheduled')])
      await fix(db, `${id}-start`, 'starts_at', [change(id, id === 'aged' ? older : future)])
    }
    const vectors = fakeVectorize()
    await vectors.index.upsert([{ id: 'aged', values: [0.2], metadata: { status: 'scheduled', starts_at: Date.parse(older) } }])
    const attempted = await writeEvent(db, vectors.index, { writer: 'enrichment', id: 'aged', patch: { status: 'canceled', starts_at: future, min_age: 16 } })
    expect(attempted).toMatchObject({ applied: ['min_age'], kept: ['status', 'starts_at'] })
    const earlyPast = await writeEvent(db, vectors.index, { writer: 'importer', id: 'aged', patch: { status: 'past' } })
    expect(earlyPast).toMatchObject({ applied: [], kept: ['status'] })
    const expired = await markPastEvents(db, vectors.index, new Date('2025-02-02T10:00:00.000Z'))
    expect(expired).toEqual({ marked: 1, vectorsUpdated: 1 })
    expect(vectors.vectors.get('aged')).toEqual({ id: 'aged', values: [0.2], metadata: { status: 'past', starts_at: Date.parse(older) } })
    expect(await db.prepare("SELECT status FROM events WHERE id = 'future'").first('status')).toBe('scheduled')
    await expect(db.prepare("UPDATE events SET status = 'scheduled' WHERE id = 'aged'").run()).rejects.toThrow('Publisher-corrected event field is locked')
  } finally { await dispose() }
}, 30_000)
