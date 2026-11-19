import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { D1Database } from '@cloudflare/workers-types'
import { NAME_FOLD_FROM, venueNameKey } from '#features/import/core/venue-identity.ts'
import { freshD1 } from '../../../../tests/support/d1.ts'
import { catalogSql } from '#features/instagram-publisher/runtime.ts'
import { runWindow } from '#features/instagram-publisher/formats.ts'
import { judgeScheduledScope, processScopeBatch, readScopePage, scopeDayStart } from './catalog.ts'
import { SCOPE_VERSION } from './judge.ts'

const now = new Date('2026-11-20T02:59:00.000Z')
const start = '2026-11-21T01:00:00.000Z'
const fakeModel = async (inputs: readonly unknown[]) => ({ judgments: inputs.map((_, index) => ({ index, scope: 'in', reason: 'It is live music.' })) })
let db: D1Database
let dispose: () => Promise<void>
beforeAll(async () => ({ db, dispose } = await freshD1()), 60_000)
afterAll(async () => { await dispose() })
beforeEach(async () => {
  await db.batch(['event_source_evidence', 'intake_candidates', 'intake_observations', 'intake_runs', 'instagram_sources', 'events', 'venues']
    .map(table => db.prepare(`DELETE FROM ${table}`)))
})

const stored = (id: string) => db.prepare('SELECT scope, scope_reason, scope_version, scope_judged_at FROM events WHERE id = ?').bind(id).first()

async function insertEvent(id: string, venueId: string | null = null, startsAt = start) {
  await db.prepare(`INSERT INTO events (id, name, source, starts_at, venue_id, description_es)
    VALUES (?, 'Concierto sintético', 'passline', ?, ?, 'Música en vivo')`).bind(id, startsAt, venueId).run()
}

async function insertEvidence(id: string) {
  await db.prepare(`INSERT INTO event_source_evidence (event_id, candidate_id, observation_id, revision) VALUES (?, 'c', 'o', 1)`).bind(id).run()
}

async function seedEvidence() {
  await db.batch([
    db.prepare("INSERT INTO instagram_sources (username, authority, qualification) VALUES ('sala_sintetica', 'venue', 'Synthetic fixture')"),
    db.prepare(`INSERT INTO intake_runs (id, local_date, reserved_usd, input) VALUES ('r', '2026-11-20', 1.5, '{}')`),
    db.prepare(`INSERT INTO intake_observations (id, run_id, post_id, source_username, post_url, caption, content_hash)
      VALUES ('o', 'r', 'p', 'sala_sintetica', 'https://example.test', 'Synthetic live show caption.', ?)`).bind('a'.repeat(64)),
    db.prepare(`INSERT INTO intake_candidates (id, revision, payload) VALUES ('c', 1, '{}')`),
  ])
}

it('uses the current Buenos Aires date before the UTC day rolls over locally', () => {
  expect(scopeDayStart(now)).toBe('2026-11-19T03:00:00.000Z')
  expect(scopeDayStart(new Date('2026-11-20T03:00:00.000Z'))).toBe('2026-11-20T03:00:00.000Z')
})

describe('D1 scope judgments', () => {
  it('selects from today, pages by start/id, and dry-run never writes', async () => {
    await insertEvent('before', null, '2026-11-19T02:59:59.000Z')
    await insertEvent('a')
    await insertEvent('b')
    const rows = await readScopePage(db, scopeDayStart(now), 1)
    expect(rows.map(row => row.id)).toEqual(['a'])
    expect((await readScopePage(db, scopeDayStart(now), 1, { after: rows[0] })).map(row => row.id)).toEqual(['b'])
    const result = await processScopeBatch(db, rows, { apply: false, request: fakeModel })
    expect(result).toEqual({ report: [{ id: 'a', name: 'Concierto sintético', venue: null, source: 'passline', scope: 'in', reason: 'It is live music.' }], failed: 0, applied: 0 })
    expect(await stored('a')).toMatchObject({ scope: null, scope_judged_at: null })
  })

  it('retains null after a failed model call or malformed judgment and retries on the next run', async () => {
    await insertEvent('event')
    const reject = vi.fn().mockRejectedValueOnce(new Error('provider unavailable'))
      .mockResolvedValueOnce({ judgments: [{ index: 2, scope: 'in', reason: 'It is live music.' }] })
      .mockImplementation(fakeModel)
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(await judgeScheduledScope(db, now, reject)).toMatchObject({ selected: 1, failed: 1, in: 0, applied: 0 })
      expect(await stored('event')).toMatchObject({ scope: null, scope_judged_at: null })
    }
    expect(await judgeScheduledScope(db, now, reject)).toMatchObject({ selected: 1, in: 1, applied: 1, failed: 0 })
    const judged = await stored('event')
    expect(judged).toMatchObject({ scope: 'in', scope_reason: 'It is live music.', scope_version: SCOPE_VERSION })
    const judgedAt = String(judged?.scope_judged_at)
    expect(new Date(judgedAt).toISOString()).toBe(judgedAt)
    expect(await judgeScheduledScope(db, now, reject)).toMatchObject({ selected: 0 })
    expect(reject).toHaveBeenCalledTimes(3)
    expect(await stored('event')).toEqual(judged)
  })

  it('rejudges an older rule version without leaving an old in-scope judgment after a provider error', async () => {
    await insertEvent('event')
    await db.prepare("UPDATE events SET scope = 'in', scope_version = 'old-rule' WHERE id = 'event'").run()
    expect(await judgeScheduledScope(db, now, async () => { throw new Error('provider down') })).toMatchObject({ selected: 1, failed: 1 })
    expect(await stored('event')).toMatchObject({ scope: null, scope_version: null })
  })

  it('uses captions and venue data, rejects a racing edit, and invalidates a judgment on a later venue edit', async () => {
    await db.prepare("INSERT INTO venues (id, name, neighborhood) VALUES ('v', 'Sala Ficticia', 'Almagro')").run()
    await insertEvent('event', 'v')
    await seedEvidence()
    await judgeScheduledScope(db, now, fakeModel)
    await insertEvidence('event')
    expect(await stored('event')).toMatchObject({ scope: null })
    const result = await judgeScheduledScope(db, now, async inputs => {
      expect(inputs).toEqual([expect.objectContaining({ name: 'Concierto sintético', venue: 'Sala Ficticia', barrio: 'Almagro',
        source: 'passline', caption: 'Synthetic live show caption.', descriptionEs: 'Música en vivo', descriptionEn: null, price: null, facets: {} })])
      await db.prepare("UPDATE events SET description_en = 'After-office DJ night' WHERE id = 'event'").run()
      return fakeModel(inputs)
    })
    expect(result).toMatchObject({ selected: 1, applied: 0, skipped: 1 })
    expect(await stored('event')).toMatchObject({ scope: null })
    await judgeScheduledScope(db, now, fakeModel)
    expect(await stored('event')).toMatchObject({ scope: 'in' })
    await db.prepare("UPDATE venues SET neighborhood = 'Boedo' WHERE id = 'v'").run()
    expect(await stored('event')).toMatchObject({ scope: null, scope_reason: null, scope_judged_at: null })
  })

  it('keeps judgments for venue renames with the same matching key and clears real renames without changing event revisions', async () => {
    const original = `Sala ${NAME_FOLD_FROM.slice(0, -3)} Del Río - Buenos Aires —`
    await db.prepare("INSERT INTO venues (id, name) VALUES ('v', ?)").bind(original).run()
    await insertEvent('event', 'v')
    await judgeScheduledScope(db, now, fakeModel)
    const judgment = await stored('event')
    const revision = () => db.prepare("SELECT updated_at FROM events WHERE id = 'event'").first('updated_at')
    const updatedAt = await revision()
    const rename = (name: string) => db.prepare("UPDATE venues SET name = ? WHERE id = 'v'").bind(name).run()
    const key = venueNameKey(original)
    for (const name of [original.normalize('NFD'), `${key.toUpperCase().replaceAll(' ', '._\u00a0')}  —–`, `${key} – CABA - Argentina`]) {
      expect(venueNameKey(name)).toBe(key)
      await rename(name)
      expect(await stored('event')).toEqual(judgment)
    }
    await rename(`${key} Sala Dos`)
    expect(await stored('event')).toMatchObject({ scope: null, scope_reason: null, scope_version: null, scope_judged_at: null })
    expect(await revision()).toBe(updatedAt)
  })

  it('prioritizes a recently cleared judgment over new imports and earlier starts, without changing the backfill order', async () => {
    await db.prepare("INSERT INTO venues (id, name) VALUES ('v', 'Sala Ficticia')").run()
    await insertEvent('cleared', 'v', '2026-11-22T01:00:00.000Z')
    await db.prepare("UPDATE events SET scope = 'in', updated_at = '2026-11-18T00:00:00.000Z' WHERE id = 'cleared'").run()
    await db.prepare("UPDATE venues SET name = 'Otra Sala' WHERE id = 'v'").run()
    await insertEvent('other')
    const recentSince = new Date(Date.now() - 7_200_000).toISOString()
    expect((await readScopePage(db, scopeDayStart(now), 1, { recentSince })).map(row => row.id)).toEqual(['cleared'])
    expect((await readScopePage(db, scopeDayStart(now), 1)).map(row => row.id)).toEqual(['other'])
  })

  it('filters the Instagram catalog selection before ranking, even with intake evidence for every event', async () => {
    await db.prepare("INSERT INTO venues (id, name, neighborhood) VALUES ('v', 'Sala Ficticia', 'Almagro')").run()
    await seedEvidence()
    for (const id of ['in', 'out', 'unjudged']) {
      await insertEvent(id, 'v')
      await insertEvidence(id)
    }
    await db.prepare("UPDATE events SET scope = id WHERE id IN ('in', 'out')").run()
    const { results } = await db.prepare(catalogSql(runWindow('finde', '2026-11-20'))).all<{ id: string }>()
    expect(results.map(row => row.id)).toEqual(['in'])
  })
})
