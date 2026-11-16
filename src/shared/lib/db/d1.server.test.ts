import type { D1Database } from '@cloudflare/workers-types'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { freshD1 } from '../../../../tests/support/d1.ts'
import { batchAssert, boundD1Database, intakeCommitBatch } from './d1.server.ts'

let db: D1Database
let dispose: () => Promise<void>
beforeAll(async () => { ({ db, dispose } = await freshD1()) }, 60_000)
afterAll(async () => { await dispose() })

describe('boundD1Database', () => {
	it('returns the DB binding when the env has one, and null otherwise', () => {
		expect(boundD1Database({ DB: db })).toBe(db)
		// Production envs today: no DB binding, so callers stay on Supabase.
		expect(boundD1Database({ SUPABASE_URL: 'https://example.supabase.co' })).toBeNull()
		expect(boundD1Database(undefined)).toBeNull()
		expect(boundD1Database({ DB: 'not a database' })).toBeNull()
	})
})

describe('batchAssert', () => {
	it('aborts the whole batch with its reason when the condition is false', async () => {
		const insert = db.prepare("INSERT INTO import_blocklist (id, pattern, target_field, source) VALUES ('b1', 'promo', 'event_name', 'all')")
		await expect(db.batch([insert, batchAssert(db, 'Candidate revision conflict', '? = 1', 2)])).rejects.toThrow('Candidate revision conflict')
		expect(await db.prepare('SELECT count(*) AS n FROM import_blocklist').first('n')).toBe(0)
	})

	it('lets the batch commit when the condition holds, and stores nothing', async () => {
		await db.batch([
			batchAssert(db, 'Blocklist entry already exists', "NOT EXISTS (SELECT 1 FROM import_blocklist WHERE id = ?)", 'b2'),
			db.prepare("INSERT INTO import_blocklist (id, pattern, target_field, source) VALUES ('b2', 'promo', 'event_name', 'all')"),
		])
		expect(await db.prepare('SELECT count(*) AS n FROM import_blocklist').first('n')).toBe(1)
		expect(await db.prepare('SELECT count(*) AS n FROM _assert').first('n')).toBe(0)
	})
})

describe('intakeCommitBatch', () => {
	it('sets write_context for the batch only, and a failed batch leaves no bypass behind', async () => {
		await db.batch(intakeCommitBatch(db, [batchAssert(db, 'bypass active', 'EXISTS (SELECT 1 FROM write_context)')]))
		expect(await db.prepare('SELECT count(*) AS n FROM write_context').first('n')).toBe(0)
		await expect(db.batch(intakeCommitBatch(db, [batchAssert(db, 'Plan is held or expired', '0')]))).rejects.toThrow('Plan is held or expired')
		expect(await db.prepare('SELECT count(*) AS n FROM write_context').first('n')).toBe(0)
	})

	it('refuses to start while a stale bypass row exists', async () => {
		await db.prepare('INSERT INTO write_context (intake_commit) VALUES (1)').run()
		await expect(db.batch(intakeCommitBatch(db, []))).rejects.toThrow(/UNIQUE|PRIMARY KEY/)
		await db.prepare('DELETE FROM write_context').run()
	})
})
