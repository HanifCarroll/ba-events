import type { D1Database } from '@cloudflare/workers-types'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { freshD1 } from '../../../tests/support/d1.ts'
import { buildSearchDocument, CURRENT_EMBEDDING_VERSION } from '#shared/lib/ai/embeddings.ts'
import { applyCatalogFix, type CatalogQuery, type FixInput } from './catalog-fix.ts'

const old = 'Entrenamiento canino.'
const corrected = 'Un montaje de teatro físico.'
const show = '18 mundos — Montaje anual'
let db: D1Database
let dispose: () => Promise<void>
beforeAll(async () => { ({ db, dispose } = await freshD1()) }, 60_000)
afterAll(async () => { await dispose?.() })
const query: CatalogQuery = async (sql, params) => (await db.prepare(sql).bind(...params).all()).results

async function fixture() {
  const venue = randomUUID(), candidate = randomUUID(), observation = randomUUID(), otherPost = randomUUID(), plan = randomUUID(), run = randomUUID()
  const ids = Array.from({ length: 8 }, () => randomUUID())
  const unrelated = randomUUID()
  const name = `Café Artigas ${venue.slice(0, 8)}`
  const document = buildSearchDocument({ name: show, description_es: corrected, venue_name: name })
  await db.batch([
    db.prepare('INSERT INTO venues (id, name) VALUES (?, ?)').bind(venue, name),
    db.prepare("INSERT OR IGNORE INTO instagram_sources (username, authority, qualification) VALUES ('synthetic_theatre', 'venue', 'Fixture')"),
    db.prepare("INSERT INTO intake_runs (id, local_date, reserved_usd, input) VALUES (?, ?, 0.01, '{}')")
      .bind(run, `2099-01-${String(++fixtureNumber).padStart(2, '0')}`),
    ...[observation, otherPost].map(id => db.prepare(`INSERT INTO intake_observations (id, run_id, post_id, source_username, post_url, caption, content_hash)
      VALUES (?, ?, ?, 'synthetic_theatre', ?, 'Entrenamiento Perro presenta teatro físico.', ?)`).bind(id, run, id, `https://www.instagram.com/p/${id}/`, 'a'.repeat(64))),
    db.prepare("INSERT INTO intake_candidates (id, revision, payload) VALUES (?, 1, '{}')").bind(candidate),
    db.prepare("INSERT INTO intake_plans (id, candidate_id, revision, action, event_id, payload, evidence, reasons) VALUES (?, ?, 1, 'create', ?, '{}', '[]', '[]')")
      .bind(plan, candidate, ids[0]),
    ...[...ids, unrelated].flatMap((id, index) => [
      db.prepare(`INSERT INTO events (id, name, starts_at, venue_id, source, description_es, description_summary_es, search_document, embedding_version)
        VALUES (?, ?, ?, ?, 'instagram', ?, ?, ?, ?)`).bind(id, show, `2026-12-${String(index + 3).padStart(2, '0')}T00:00:00.000Z`, venue, corrected, old, document, CURRENT_EMBEDDING_VERSION),
      db.prepare('INSERT INTO event_source_evidence (event_id, candidate_id, observation_id, revision) VALUES (?, ?, ?, 1)')
        .bind(id, candidate, index < ids.length ? observation : otherPost),
      db.prepare("INSERT INTO event_intake_protection (event_id, fields, plan_id, authority, observed_at) VALUES (?, ?, ?, 1, '2026-11-25T00:00:00.000Z')")
        .bind(id, '["name","status","starts_at","description_summary_es"]', plan),
    ]),
  ])
  const input: FixInput = { id: ids[0]!, field: 'description_summary_es', from: old, to: corrected, allOccurrences: true, evidence: 'Synthetic flyer: teatro físico.' }
  return { ids, unrelated, input, document, name }
}
let fixtureNumber = 0

describe('catalog-fix on real D1', () => {
  it('corrects the eight 18 mundos summaries, bypasses intake protection only in the guarded operation, and leaves the unrelated same-title show alone', async () => {
    const { ids, input, unrelated, document } = await fixture()
    const operation = randomUUID()
    expect(await applyCatalogFix(query, input, () => operation)).toHaveLength(8)
    for (const id of [...ids, unrelated]) {
      expect(await query('SELECT description_summary_es, search_document, embedding_version FROM events WHERE id = ?', [id])).toEqual([
        { description_summary_es: id === unrelated ? old : corrected, search_document: document, embedding_version: CURRENT_EMBEDDING_VERSION },
      ])
    }
    expect(await query('SELECT operation FROM publisher_catalog_fixes WHERE operation = ?', [operation])).toEqual([{ operation }])
    expect(await query('SELECT * FROM write_context', [])).toEqual([])
    await db.prepare('UPDATE events SET description_summary_es = ? WHERE id = ?').bind(old, ids[0]).run()
    expect(await query('SELECT description_summary_es FROM events WHERE id = ?', [ids[0]!])).toEqual([{ description_summary_es: corrected }])
    await expect(applyCatalogFix(query, input, () => randomUUID())).rejects.toThrow('stale --from')
  })

  it('refuses the entire set if another writer changes a protected input between planning and the write', async () => {
    const { ids, input } = await fixture()
    const operation = randomUUID()
    await expect(applyCatalogFix(query, input, async () => {
      await db.prepare('UPDATE events SET categories = ? WHERE id = ?').bind('["theatre"]', ids[7]).run()
      return operation
    })).rejects.toThrow('catalog changed before the write')
    expect(await query('SELECT description_summary_es FROM events WHERE id = ?', [input.id])).toEqual([{ description_summary_es: old }])
    expect(await query('SELECT operation FROM publisher_catalog_fixes WHERE operation = ?', [operation])).toEqual([])
  })

  it('changes one title and its canonical search document without pretending the vector was refreshed', async () => {
    const { ids, input, name } = await fixture()
    const title = '18 mundos de teatro físico'
    await applyCatalogFix(query, { ...input, field: 'name', from: show, to: title, allOccurrences: false }, () => randomUUID())
    expect(await query('SELECT name, search_document, embedding_version FROM events WHERE id = ?', [input.id])).toEqual([{
      name: title, search_document: buildSearchDocument({ name: title, description_es: corrected, venue_name: name }),
      embedding_version: CURRENT_EMBEDDING_VERSION - 1,
    }])
    expect(await query('SELECT name FROM events WHERE id = ?', [ids[1]!])).toEqual([{ name: show }])
  })

  it('applies a shared start-clock correction to different dates, but refuses a date shift', async () => {
    const { ids, input } = await fixture()
    const correction: FixInput = { ...input, field: 'starts_at', from: '2026-12-03T00:00:00.000Z', to: '2026-12-03T00:30:00.000Z' }
    await expect(applyCatalogFix(query, { ...correction, to: '2026-12-04T00:30:00.000Z' }, () => randomUUID())).rejects.toThrow('original local date')
    await applyCatalogFix(query, correction, () => randomUUID())
    expect(await query('SELECT starts_at FROM events WHERE id = ?', [ids[7]!])).toEqual([{ starts_at: '2026-12-10T00:30:00.000Z' }])
  })
})
