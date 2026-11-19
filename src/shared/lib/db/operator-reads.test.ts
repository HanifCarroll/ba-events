import type { D1Database } from '@cloudflare/workers-types'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { freshD1 } from '../../../../tests/support/d1.ts'
import { readGuestChat } from '../../../../scripts/guest-chat-debug.ts'
import { sourceHealth } from '../../../../scripts/source-health.ts'
import { dumpLive } from '../../../../scripts/snapshot-search-corpus.ts'
import type { ReadD1 } from '../../../../scripts/read-d1.ts'

let db: D1Database
let dispose: () => Promise<void>
beforeAll(async () => { ({ db, dispose } = await freshD1()) }, 60_000)
afterAll(async () => { await dispose() })
const read: ReadD1 = async <T>(sql: string, params: readonly (string | number)[] = []) => (await db.prepare(sql).bind(...params).all<T>()).results
const now = new Date('2030-02-01T00:00:00.000Z')
const insert = (id: string, status: string, starts = now.toISOString()) => db.prepare(`INSERT INTO events
  (id, name, starts_at, status, source, categories, facets, is_free, location_tba, enrichment_status)
  VALUES (?, 'Synthetic', ?, ?, 'meetup', '["music"]', '{"genres":["jazz"]}', 1, 1, 'failed')`).bind(id, starts, status)

it('returns only the guest transcript columns and binds the supplied ID', async () => {
  const id = "guest'1"
  const messages = [{ role: 'user', content: 'Synthetic message' }]
  await db.prepare('INSERT INTO guest_chat_debug (conversation_id, ip, messages) VALUES (?, ?, ?)')
    .bind(id, '203.0.113.1', JSON.stringify(messages)).run()
  const row = await readGuestChat(read, id)
  expect(row).toMatchObject({ conversation_id: id, messages })
  expect(row).not.toHaveProperty('ip')
  expect(await readGuestChat(read, 'missing')).toBeNull()
})

it('distinguishes unavailable inventory from zero and keeps failures visible', async () => {
  await db.batch([
    insert('x-health', 'scheduled', '2030-01-01T00:00:00.000Z'),
    db.prepare("INSERT INTO scrape_runs (id, source, status, metadata) VALUES ('daily', 'all', 'completed', NULL)"),
    db.prepare("INSERT INTO scrape_runs (id, source, status) VALUES ('single', 'meetup', 'completed')"),
  ])
  expect((await sourceHealth(read, now)).inventory).toEqual({ scheduledUpcoming: 0, bothDescriptionsNull: 0, descriptionUnavailable: 0, enrichmentFailed: 0 })
  const unavailable: ReadD1 = (sql, params) => sql.includes('FROM events') ? Promise.reject(new Error('unavailable')) : read(sql, params)
  expect((await sourceHealth(unavailable, now)).inventory.scheduledUpcoming).toBeNull()
  await insert('y-health', 'scheduled').run()
  expect(await sourceHealth(read, now)).toMatchObject({ needsAttention: true, inventory: { scheduledUpcoming: 1, enrichmentFailed: 1 } })
})

it('selects upcoming scheduled rows with a stable tie break and decodes D1 fields', async () => {
  await db.batch([insert('b', 'scheduled'), insert('a', 'scheduled'), insert('0', 'canceled')])
  const corpus = await dumpLive(read, 1, now)
  expect(corpus.events).toMatchObject([{ id: 'a', categories: ['music'], facets: { genres: ['jazz'] }, is_free: true, price: 0, location_tba: true, time_tba: false }])
})
