import type { D1Database } from '@cloudflare/workers-types'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { freshD1 } from '../../tests/support/d1.ts'
import { checkTargets } from './lib.ts'
import { artworkKey, d1Columns, decodeValue, encodeValue, expectedRow, kindOf, rewriteArtworkUrl, sameValue, transformRow, vectorRecord, type Column } from './transform.ts'

const SOURCE = 'https://abcdefgh.supabase.co'
const SITE = 'https://baeventos.com'
const HASH = 'a'.repeat(64)
const EVENT_ID = '00000000-0000-4000-8000-000000000001'

describe('type map', () => {
	it('maps every PostgREST format the baseline uses', () => {
		expect(kindOf({ name: 'b', format: 'boolean', type: 'boolean' })).toBe('boolean')
		expect(kindOf({ name: 't', format: 'timestamp with time zone' })).toBe('timestamp')
		expect(kindOf({ name: 'j', format: 'jsonb' })).toBe('json')
		expect(kindOf({ name: 'a', format: 'text[]', type: 'array' })).toBe('json')
		expect(kindOf({ name: 'u', format: 'uuid[]', type: 'array' })).toBe('json')
		expect(kindOf({ name: 'e', format: 'extensions.vector(1536)' })).toBe('vector')
		for (const format of ['text', 'uuid', 'date', 'integer', 'bigint', 'smallint', 'numeric', 'public.event_status']) {
			expect(kindOf({ name: 'p', format })).toBe('plain')
		}
	})

	it('encodes booleans as 0 and 1', () => {
		const column = { name: 'is_free', format: 'boolean' }
		expect(encodeValue(column, true)).toBe(1)
		expect(encodeValue(column, false)).toBe(0)
		expect(() => encodeValue(column, 'true')).toThrow('expected a boolean')
	})

	it('writes timestamps in the toISOString form, rounding microseconds to milliseconds', () => {
		const column = { name: 'starts_at', format: 'timestamp with time zone' }
		expect(encodeValue(column, '2026-01-27T09:14:55.036861+00:00')).toBe('2026-01-27T09:14:55.036Z')
		expect(encodeValue(column, '2026-02-07T21:00:00+00:00')).toBe('2026-02-07T21:00:00.000Z')
		expect(encodeValue(column, '2026-02-07T18:00:00-03:00')).toBe('2026-02-07T21:00:00.000Z')
		expect(() => encodeValue(column, 'not a date')).toThrow('invalid timestamp')
	})

	it('stores jsonb, text[] and uuid[] as JSON text and reads them back', () => {
		const jsonb = { name: 'facets', format: 'jsonb' }
		const array = { name: 'categories', format: 'text[]', type: 'array' }
		expect(encodeValue(jsonb, { mood: ['chill'], n: 1 })).toBe('{"mood":["chill"],"n":1}')
		expect(encodeValue(jsonb, {})).toBe('{}')
		expect(encodeValue(jsonb, 'a string')).toBe('"a string"')
		expect(encodeValue(array, ['music', 'art'])).toBe('["music","art"]')
		expect(decodeValue(array, '["music","art"]')).toEqual(['music', 'art'])
		expect(decodeValue({ name: 'b', format: 'boolean' }, 0)).toBe(false)
	})

	it('passes text, enums, dates and numbers through', () => {
		expect(encodeValue({ name: 'status', format: 'public.event_status' }, 'scheduled')).toBe('scheduled')
		expect(encodeValue({ name: 'local_date', format: 'date' }, '2026-11-16')).toBe('2026-11-16')
		expect(encodeValue({ name: 'price', format: 'numeric' }, 15000.5)).toBe(15000.5)
		expect(encodeValue({ name: 'update_id', format: 'bigint' }, 9007199254740)).toBe(9007199254740)
		expect(() => encodeValue({ name: 'name', format: 'text' }, { nested: true })).toThrow('unexpected object')
	})

	it('keeps nulls null in every kind', () => {
		for (const format of ['boolean', 'timestamp with time zone', 'jsonb', 'text', 'numeric']) {
			expect(encodeValue({ name: 'x', format }, null)).toBeNull()
			expect(encodeValue({ name: 'x', format }, undefined)).toBeNull()
			expect(decodeValue({ name: 'x', format }, null)).toBeNull()
		}
		// A JSON null inside a document is data, not SQL NULL.
		expect(encodeValue({ name: 'x', format: 'jsonb' }, { a: null })).toBe('{"a":null}')
	})

	it('leaves the embedding out of D1', () => {
		const columns: Column[] = [{ name: 'id', format: 'uuid' }, { name: 'embedding', format: 'extensions.vector(1536)' }]
		expect(d1Columns(columns).map((c) => c.name)).toEqual(['id'])
		expect(() => encodeValue(columns[1]!, '[0.1]')).toThrow('Vectorize')
	})

	it('compares decoded values as facts', () => {
		const ts = { name: 't', format: 'timestamp with time zone' }
		expect(sameValue(ts, '2026-01-27T09:14:55.036+00:00', '2026-01-27T09:14:55.036Z')).toBe(true)
		expect(sameValue(ts, '2026-01-27T09:14:55.037+00:00', '2026-01-27T09:14:55.036Z')).toBe(false)
		expect(sameValue({ name: 'j', format: 'jsonb' }, { b: 1, a: 2 }, { a: 2, b: 1 })).toBe(true)
		expect(sameValue({ name: 'j', format: 'jsonb' }, { a: 1 }, { a: 2 })).toBe(false)
		expect(sameValue({ name: 's', format: 'text' }, null, null)).toBe(true)
		expect(sameValue({ name: 's', format: 'text' }, '', null)).toBe(false)
	})
})

describe('artwork URL rewrite', () => {
	const stored = `${SOURCE}/storage/v1/object/public/event-artwork/${HASH}.jpg`

	it('points a Supabase event-artwork URL at the site artwork route, keeping the object key', () => {
		expect(rewriteArtworkUrl(stored, EVENT_ID, SOURCE, SITE)).toBe(`${SITE}/api/event-artwork/${EVENT_ID}/${HASH}.jpg`)
		expect(artworkKey(stored)).toBe(`${HASH}.jpg`)
		expect(artworkKey(rewriteArtworkUrl(stored, EVENT_ID, SOURCE, SITE))).toBe(`${HASH}.jpg`)
	})

	it('leaves other URLs and nulls alone', () => {
		for (const url of ['https://images.lumacdn.com/event-covers/x.png', `${SOURCE}/storage/v1/object/public/instagram-evidence/${HASH}.jpg`,
			`https://other.supabase.co/storage/v1/object/public/event-artwork/${HASH}.jpg`, '']) {
			expect(rewriteArtworkUrl(url, EVENT_ID, SOURCE, SITE)).toBe(url)
		}
		expect(rewriteArtworkUrl(null, EVENT_ID, SOURCE, SITE)).toBeNull()
		expect(artworkKey(null)).toBeNull()
	})

	it('refuses an artwork key that is not a content hash', () => {
		expect(() => rewriteArtworkUrl(`${SOURCE}/storage/v1/object/public/event-artwork/../x.jpg`, EVENT_ID, SOURCE, SITE)).toThrow('unexpected artwork key')
	})

	it('rewrites only events.image_url', () => {
		expect(expectedRow('events', { id: EVENT_ID, image_url: stored }, SOURCE, SITE).image_url).toContain('/api/event-artwork/')
		const plan = { id: 'p', payload: { image_url: stored } }
		expect(expectedRow('intake_plans', plan, SOURCE, SITE)).toBe(plan)
	})
})

describe('vector records', () => {
	const values = Array.from({ length: 1536 }, (_, i) => i / 1536)
	it('copies the embedding unchanged with status and starts_at in epoch milliseconds', () => {
		const record = vectorRecord({ id: EVENT_ID, embedding: JSON.stringify(values), status: 'scheduled', starts_at: '2026-02-07T21:00:00+00:00' })
		expect(record).toEqual({ id: EVENT_ID, values, metadata: { status: 'scheduled', starts_at: Date.UTC(2026, 1, 7, 21) } })
	})
	it('skips a missing embedding and refuses a malformed one', () => {
		expect(vectorRecord({ id: EVENT_ID, embedding: null })).toBeNull()
		expect(() => vectorRecord({ id: EVENT_ID, embedding: '[1,2,3]' })).toThrow('1536')
	})
})

describe('targets', () => {
	const staging = { d1: 'baeventos-staging', vectorize: 'baeventos-events-staging', evidenceBucket: 'baeventos-intake-evidence-staging', artworkBucket: 'baeventos-artwork-staging' }
	it('accepts staging targets', () => expect(() => checkTargets(staging, false)).not.toThrow())
	it('refuses any production target without --production', () => {
		expect(() => checkTargets({ ...staging, vectorize: 'baeventos-events' }, false)).toThrow('baeventos-events')
		expect(() => checkTargets({ ...staging, d1: 'baeventos-production' }, false)).toThrow('--production')
		expect(() => checkTargets({ ...staging, d1: 'baeventos-production' }, true)).not.toThrow()
	})
})

describe('transformed rows on the D1 baseline', () => {
	let db: D1Database
	let dispose: () => Promise<void>
	beforeAll(async () => { ({ db, dispose } = await freshD1()) }, 60_000)
	afterAll(async () => { await dispose() })

	// The production columns of a slice of events, as PostgREST's schema lists them.
	const columns: Column[] = [
		{ name: 'id', format: 'uuid' }, { name: 'name', format: 'text' }, { name: 'starts_at', format: 'timestamp with time zone' },
		{ name: 'is_free', format: 'boolean', type: 'boolean' }, { name: 'price', format: 'integer' },
		{ name: 'categories', format: 'text[]', type: 'array' }, { name: 'source', format: 'text' },
		{ name: 'status', format: 'public.event_status' }, { name: 'facets', format: 'jsonb' }, { name: 'image_url', format: 'text' },
		{ name: 'enrichment_provenance', format: 'jsonb' }, { name: 'embedding', format: 'extensions.vector(1536)' },
	]
	const row = { id: EVENT_ID, name: 'Synthetic Jazz', starts_at: '2026-02-07T21:00:00.123456+00:00', is_free: false, price: 15000,
		categories: ['music'], source: 'instagram', status: 'scheduled', facets: { mood: ['chill'] },
		image_url: `${SOURCE}/storage/v1/object/public/event-artwork/${HASH}.jpg`, enrichment_provenance: null, embedding: '[0]' }

	it('inserts through the baseline CHECKs and decodes back to the production values', async () => {
		const stored = d1Columns(columns)
		await db.prepare(`INSERT INTO events (${stored.map((c) => c.name).join(', ')}) VALUES (${stored.map(() => '?').join(', ')})`)
			.bind(...transformRow('events', columns, row, SOURCE, SITE)).run()
		const back = (await db.prepare(`SELECT ${stored.map((c) => c.name).join(', ')} FROM events WHERE id = ?`).bind(EVENT_ID).first<Record<string, string | number | null>>())!
		const expected = expectedRow('events', row, SOURCE, SITE)
		for (const column of stored) expect(sameValue(column, expected[column.name], decodeValue(column, back[column.name]!))).toBe(true)
		expect(back.image_url).toBe(`${SITE}/api/event-artwork/${EVENT_ID}/${HASH}.jpg`)
		expect(back.starts_at).toBe('2026-02-07T21:00:00.123Z')
	})
})

describe('JSONL', () => {
	it('keeps U+2028 and U+2029 inside a row', async () => {
		const { mkdtempSync, rmSync } = await import('node:fs')
		const { tmpdir } = await import('node:os')
		const { join } = await import('node:path')
		const { jsonlWriter, readJsonl } = await import('./lib.ts')
		const dir = mkdtempSync(join(tmpdir(), 'd1-migrate-'))
		try {
			const out = jsonlWriter(join(dir, 'rows.jsonl'))
			const rows = [{ text: 'a\u2028b\u2029c' }, { text: 'second' }]
			for (const row of rows) await out.write(row)
			await out.close()
			const back = []
			for await (const row of readJsonl(join(dir, 'rows.jsonl'))) back.push(row)
			expect(back).toEqual(rows)
		} finally { rmSync(dir, { recursive: true }) }
	})
})
