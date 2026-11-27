/** Executes the schema constraints, triggers, and projections against Miniflare D1. */
import type { D1Database } from '@cloudflare/workers-types'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { freshD1, withTestIntakeContext } from '../../../../tests/support/d1.ts'

let db: D1Database
let dispose: () => Promise<void>
beforeAll(async () => { ({ db, dispose } = await freshD1()) }, 60_000)
afterAll(async () => { await dispose() })

let n = 0
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString()
const DAY = 86_400_000

async function venue(name = 'Sala Sintética') {
	const venueId = id()
	await db.prepare('INSERT INTO venues (id, name) VALUES (?, ?)').bind(venueId, name).run()
	return venueId
}
async function event(fields: Record<string, unknown> = {}) {
	const row = { id: id(), name: 'Synthetic Jazz', starts_at: iso(DAY), source: 'luma', ...fields }
	const columns = Object.keys(row)
	await db.prepare(`INSERT INTO events (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`).bind(...Object.values(row)).run()
	return row.id
}
const read = (eventId: string) => db.prepare('SELECT * FROM events WHERE id = ?').bind(eventId).first<Record<string, unknown>>()

/** An intake-corrected event, as commit_intake_plan leaves it: an evidence chain and every fact protected. */
async function protectedEvent(fields: Record<string, unknown> = {}) {
	const eventId = await event({ search_document: 'Synthetic Jazz', embedding_version: 2, status: 'canceled', ...fields })
	const candidate = id(), plan = id()
	await db.batch([
		db.prepare("INSERT INTO intake_candidates (id, revision, payload) VALUES (?, 1, '{}')").bind(candidate),
		db.prepare("INSERT INTO intake_plans (id, candidate_id, revision, action, event_id, payload, evidence, reasons) VALUES (?, ?, 1, 'update', ?, '{}', '[]', '[]')").bind(plan, candidate, eventId),
		db.prepare('INSERT INTO event_intake_protection (event_id, fields, plan_id, authority, observed_at) VALUES (?, ?, ?, 2, ?)')
			.bind(eventId, JSON.stringify(['name', 'starts_at', 'ends_at', 'time_tba', 'venue_id', 'price', 'is_free', 'status', 'image_url',
				'image_width', 'image_height', 'description_es', 'description_en', 'description_display_es', 'description_display_en',
				'description_summary_es', 'description_summary_en', 'categories', 'ticket_url', 'facets', 'embedding', 'embedding_version',
				'search_document']), plan, iso()),
	])
	return eventId
}

describe('hidden location', () => {
	it('never keeps a venue on an event whose address is hidden', async () => {
		const v = await venue('Sala Sintética Oculta')
		const e = await event({ venue_id: v, location_hidden: 1 })
		expect((await read(e))?.venue_id).toBeNull()
		await db.prepare('UPDATE events SET location_hidden = 0, venue_id = ? WHERE id = ?').bind(v, e).run()
		expect((await read(e))?.venue_id).toBe(v)
		await db.prepare('UPDATE events SET location_hidden = 1 WHERE id = ?').bind(e).run()
		expect((await read(e))?.venue_id).toBeNull()
		await db.prepare('UPDATE events SET venue_id = ? WHERE id = ?').bind(v, e).run()
		expect((await read(e))?.venue_id).toBeNull()
	})

	it('wins over intake protection, which never restores a venue onto a hidden event', async () => {
		const v = await venue()
		const e = await protectedEvent({ venue_id: v })
		await db.prepare('UPDATE events SET location_hidden = 1, venue_id = NULL WHERE id = ?').bind(e).run()
		expect((await read(e))?.venue_id).toBeNull()
		// Hiding alone (venue_id untouched) also clears it, and the protection does not put it back.
		await db.prepare('UPDATE events SET location_hidden = 0 WHERE id = ?').bind(e).run()
		const again = await protectedEvent({ venue_id: v })
		await db.prepare('UPDATE events SET location_hidden = 1 WHERE id = ?').bind(again).run()
		expect((await read(again))?.venue_id).toBeNull()
	})
})

describe('intake protection trigger', () => {
	it('silently reverts a platform overwrite of corrected facts, with the search fields that go with them', async () => {
		const e = await protectedEvent({ starts_at: '2026-12-02T00:00:00.000Z' })
		await db.prepare("UPDATE events SET starts_at = '2026-11-21T00:00:00.000Z', status = 'scheduled', name = 'Stale platform name', search_document = 'Stale', embedding_version = 1, link = 'https://example.org/new' WHERE id = ?").bind(e).run()
		expect(await read(e)).toMatchObject({ status: 'canceled', starts_at: '2026-12-02T00:00:00.000Z', name: 'Synthetic Jazz',
			search_document: 'Synthetic Jazz', embedding_version: 2, link: 'https://example.org/new' })
	})

	it('keeps an unprotected change, and its search fields, when nothing protected changed', async () => {
		const e = await protectedEvent()
		await db.prepare("UPDATE events SET link = 'https://example.org/l', search_document = 'Refreshed', embedding_version = 3, location_tba = 1 WHERE id = ?").bind(e).run()
		// search_document and embedding_version are protected facts themselves, so they revert too.
		expect(await read(e)).toMatchObject({ link: 'https://example.org/l', location_tba: 1, search_document: 'Synthetic Jazz', embedding_version: 2 })
	})

	it('lets a scheduled event that has started become past', async () => {
		const e = await protectedEvent({ status: 'scheduled', starts_at: iso(-5 * 3_600_000) })
		await db.prepare("UPDATE events SET status = 'past' WHERE id = ?").bind(e).run()
		expect((await read(e))?.status).toBe('past')
		const future = await protectedEvent({ status: 'scheduled', starts_at: iso(DAY) })
		await db.prepare("UPDATE events SET status = 'past' WHERE id = ?").bind(future).run()
		expect((await read(future))?.status).toBe('scheduled')
	})

	it('lets the intake commit batch change protected facts, and only inside it', async () => {
		const e = await protectedEvent()
		await withTestIntakeContext(db, [
			db.prepare("UPDATE events SET name = 'Rescheduled', status = 'scheduled', search_document = 'Rescheduled' WHERE id = ?").bind(e),
		])
		expect(await read(e)).toMatchObject({ name: 'Rescheduled', status: 'scheduled', search_document: 'Rescheduled' })
		await db.prepare("UPDATE events SET name = 'Platform' WHERE id = ?").bind(e).run()
		expect((await read(e))?.name).toBe('Rescheduled')
	})

	it('leaves events without a protection row alone', async () => {
		const e = await event()
		await db.prepare("UPDATE events SET name = 'Renamed', status = 'canceled' WHERE id = ?").bind(e).run()
		expect(await read(e)).toMatchObject({ name: 'Renamed', status: 'canceled' })
	})
})

describe('event scope columns', () => {
	it('accepts a judgment without changing intake-protected facts or the event revision', async () => {
		const eventId = await protectedEvent({ status: 'scheduled', updated_at: '2026-01-01T00:00:00.000Z' })
		await db.prepare("UPDATE events SET scope = 'in', scope_reason = 'It is live jazz.', scope_judged_at = ?, scope_version = 'test' WHERE id = ?")
			.bind(iso(), eventId).run()
		expect(await read(eventId)).toMatchObject({ scope: 'in', scope_reason: 'It is live jazz.', status: 'scheduled',
			name: 'Synthetic Jazz', search_document: 'Synthetic Jazz', embedding_version: 2, updated_at: '2026-01-01T00:00:00.000Z' })
		expect(await db.prepare('SELECT count(*) FROM write_context').first('count(*)')).toBe(0)
		await withTestIntakeContext(db, [db.prepare("UPDATE events SET name = 'New title' WHERE id = ?").bind(eventId)])
		expect(await read(eventId)).toMatchObject({ name: 'New title', scope: null, scope_reason: null, scope_judged_at: null, scope_version: null })
	})

	it('rejects invalid scope and noncanonical judgment timestamps', async () => {
		await expect(event({ scope: 'maybe' })).rejects.toThrow(/CHECK/)
		await expect(event({ scope_judged_at: '2026-11-21T00:00:00Z' })).rejects.toThrow(/CHECK/)
	})
})

describe('updated_at triggers', () => {
	it.each(['venues', 'events', 'user_preferences', 'import_blocklist', 'venue_review_queue', 'conversations'])('%s stamps every update', async (table) => {
		const rowId = id()
		const old = '2026-01-01T00:00:00.000Z'
		const insert = {
			venues: "INSERT INTO venues (id, name, updated_at) VALUES (?1, 'V', ?2)",
			events: "INSERT INTO events (id, name, starts_at, source, updated_at) VALUES (?1, 'E', ?2, 'luma', ?2)",
			user_preferences: "INSERT INTO profiles (id, email, created_at) VALUES (?1, 'user@example.test', ?2); INSERT INTO user_preferences (id, user_id, updated_at) VALUES (?1, ?1, ?2)",
			import_blocklist: "INSERT INTO import_blocklist (id, pattern, target_field, source, updated_at) VALUES (?1, 'x', 'event_name', 'all', ?2)",
			venue_review_queue: "INSERT INTO venue_review_queue (id, source, source_venue_name, updated_at) VALUES (?1, 'luma', 'V', ?2)",
			conversations: "INSERT INTO conversations (id, updated_at) VALUES (?1, ?2)",
		}[table]!
		await db.batch(insert.split('; ').map((sql) => db.prepare(sql).bind(rowId, old)))
		const before = Date.now()
		const column = { venues: 'name', events: 'name', user_preferences: 'about_me', import_blocklist: 'reason', venue_review_queue: 'notes', conversations: 'title' }[table]!
		await db.prepare(`UPDATE ${table} SET ${column} = 'changed' WHERE id = ?`).bind(rowId).run()
		const stamped = await db.prepare(`SELECT updated_at FROM ${table} WHERE id = ?`).bind(rowId).first<string>('updated_at')
		expect(stamped).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/)
		expect(Date.parse(stamped!)).toBeGreaterThanOrEqual(before - 1000)
	})
})

describe('type map', () => {
	it('accepts only the ISO form toISOString() writes, and never datetime()', async () => {
		await expect(event({ starts_at: '2026-11-21T00:00:00.000Z' })).resolves.toBeTypeOf('string')
		for (const bad of ['2026-11-21T00:00:00+00:00', '2026-11-21T00:00:00Z', '2026-11-21 00:00:00', '2026-02-30T00:00:00.000Z']) {
			await expect(event({ starts_at: bad })).rejects.toThrow(/CHECK constraint failed/)
		}
		await expect(db.prepare("INSERT INTO events (id, name, starts_at, source) VALUES (?, 'E', datetime('now'), 'luma')").bind(id()).run()).rejects.toThrow(/CHECK/)
	})

	it('checks JSON columns, enums and booleans, and refuses a mistyped value (STRICT tables)', async () => {
		await expect(event({ categories: 'music' })).rejects.toThrow(/CHECK/)
		await expect(event({ categories: '{"music":true}' })).rejects.toThrow(/CHECK/)
		await expect(event({ facets: '[]' })).rejects.toThrow(/CHECK/)
		await expect(event({ status: 'cancelled' })).rejects.toThrow(/CHECK/)
		await expect(event({ is_free: 2 })).rejects.toThrow(/CHECK/)
		// STRICT still converts text that is exactly an integer ('1500'); anything else is refused.
		await expect(event({ price: 'gratis' })).rejects.toThrow(/cannot store TEXT value in INTEGER column/)
		await expect(event({ image_width: 0 })).rejects.toThrow(/CHECK/)
		await expect(db.prepare("INSERT INTO venues (id, name, neighborhood) VALUES (?, 'V', 'Palermo Soho')").bind(id()).run()).rejects.toThrow(/CHECK/)
		const e = await event({ categories: '["music","arts"]', facets: '{"genres":["jazz"]}' })
		expect(await db.prepare("SELECT count(*) AS n FROM events, json_each(events.categories) WHERE events.id = ? AND value = 'arts'").bind(e).first('n')).toBe(1)
	})

	it('keeps one event per source and external id', async () => {
		await event({ source: 'meetup', external_id: 'evt-1' })
		await expect(event({ source: 'meetup', external_id: 'evt-1' })).rejects.toThrow(/UNIQUE/)
		await event({ source: 'meetup' })
		await event({ source: 'meetup' })
	})

	it('cascades and nulls references like Postgres', async () => {
		const v = await venue(), e = await event()
		const user = id()
		await db.batch([
			db.prepare("INSERT INTO profiles (id, email) VALUES (?, 'saver@example.test')").bind(user),
			db.prepare('INSERT INTO saved_events (id, user_id, event_id) VALUES (?, ?, ?)').bind(id(), user, e),
			db.prepare('UPDATE events SET venue_id = ? WHERE id = ?').bind(v, e),
		])
		await expect(db.prepare('INSERT INTO saved_events (id, user_id, event_id) VALUES (?, ?, ?)').bind(id(), user, e).run()).rejects.toThrow(/UNIQUE/)
		await db.prepare('DELETE FROM venues WHERE id = ?').bind(v).run()
		expect((await read(e))?.venue_id).toBeNull()
		await db.prepare('DELETE FROM events WHERE id = ?').bind(e).run()
		expect(await db.prepare('SELECT count(*) AS n FROM saved_events WHERE user_id = ?').bind(user).first('n')).toBe(0)
		await expect(db.prepare("INSERT INTO saved_events (id, user_id, event_id) VALUES (?, ?, 'missing')").bind(id(), user).run()).rejects.toThrow(/FOREIGN KEY/)
	})

	it('exposes the two views with the joined venue', async () => {
		const v = await venue('Sala Vista')
		const e = await event({ venue_id: v, description_es: 'Hola' })
		expect(await db.prepare('SELECT venue_name, name FROM events_with_venues WHERE id = ?').bind(e).first()).toEqual({ venue_name: 'Sala Vista', name: 'Synthetic Jazz' })
		expect(await db.prepare('SELECT has_description_es, has_description_en, venue_name FROM events_admin_list WHERE id = ?').bind(e).first())
			.toEqual({ has_description_es: 1, has_description_en: 0, venue_name: 'Sala Vista' })
	})
})

describe('intake schema', () => {
	it('starts with one policy row, collection and publishing off, the wider watchlist limits, and caps max_sources at 500', async () => {
		expect(await db.prepare('SELECT * FROM intake_policy').all()).toMatchObject({ results: [{ id: 1, publishing_enabled: 0, collection_enabled: 0,
			max_sources: 200, posts_per_source: 20, run_cap_usd: 1.5, monthly_cap_usd: 18, actor_build: '0.0.679', data_detail_level: 'detailedData' }] })
		await expect(db.prepare('UPDATE intake_policy SET max_sources = 501').run()).rejects.toThrow(/CHECK/)
		await expect(db.prepare("UPDATE intake_policy SET data_detail_level = 'fullData'").run()).rejects.toThrow(/CHECK/)
		await expect(db.prepare('INSERT INTO intake_policy (id) VALUES (2)').run()).rejects.toThrow(/CHECK/)
	})

	it('checks usernames, hashes and one run per local day', async () => {
		await expect(db.prepare("INSERT INTO instagram_sources (username, authority, qualification) VALUES ('Synthetic', 'venue', 'x')").run()).rejects.toThrow(/CHECK/)
		await db.prepare("INSERT INTO instagram_sources (username, authority, enabled, qualification) VALUES ('synthetic_venue', 'venue', 1, 'Synthetic fixture')").run()
		const run = id()
		await db.prepare("INSERT INTO intake_runs (id, local_date, reserved_usd, input) VALUES (?, '2026-11-16', 1.5, '{}')").bind(run).run()
		await expect(db.prepare("INSERT INTO intake_runs (id, local_date, reserved_usd, input) VALUES (?, '2026-11-16', 1.5, '{}')").bind(id()).run()).rejects.toThrow(/UNIQUE/)
		await expect(db.prepare("INSERT INTO intake_runs (id, local_date, reserved_usd, input) VALUES (?, '2026-11-17', 0, '{}')").bind(id()).run()).rejects.toThrow(/CHECK/)
		const observe = (hash: string, post = 'synthetic-post') => db.prepare("INSERT INTO intake_observations (id, run_id, post_id, source_username, post_url, caption, content_hash) VALUES (?, ?, ?, 'synthetic_venue', 'https://www.instagram.com/p/synthetic/', 'Synthetic evidence', ?)").bind(id(), run, post, hash).run()
		await observe('a'.repeat(64))
		await expect(observe('a'.repeat(64))).rejects.toThrow(/UNIQUE/)
		await expect(observe('A'.repeat(64), 'other')).rejects.toThrow(/CHECK/)
		await expect(db.prepare("INSERT INTO intake_plans (id, candidate_id, revision, action, event_id, payload, evidence, reasons) VALUES (?, 'x', 1, 'publish', 'e', '{}', '[]', '[]')").bind(id()).run()).rejects.toThrow(/CHECK/)
	})

	it('defaults a plan to expire 24 hours after it was made', async () => {
		const candidate = id(), plan = id()
		await db.batch([
			db.prepare("INSERT INTO intake_candidates (id, revision, payload) VALUES (?, 1, '{}')").bind(candidate),
			db.prepare("INSERT INTO intake_plans (id, candidate_id, revision, action, event_id, payload, evidence, reasons) VALUES (?, ?, 1, 'create', ?, '{}', '[]', '[]')").bind(plan, candidate, id()),
		])
		const row = await db.prepare('SELECT created_at, expires_at FROM intake_plans WHERE id = ?').bind(plan).first<{ created_at: string; expires_at: string }>()
		expect(Date.parse(row!.expires_at) - Date.parse(row!.created_at)).toBe(DAY)
	})

	it('accepts the evidence row the venue operation writes, and filters held candidates by date as text', async () => {
		const v = await venue()
		const logged = id()
		await db.prepare("INSERT INTO venue_review_queue (id, source, source_venue_name, source_address, status, final_venue_id, reviewed_at, notes) VALUES (?, 'instagram-intake', 'Sala Sintética', 'Av. Ficticia 1234', 'approved', ?, ?, ?)")
			.bind(logged, v, iso(), JSON.stringify({ evidence: [{ url: 'https://example.org', confirms: 'address' }] })).run()
		expect(await db.prepare("SELECT json_extract(notes, '$.evidence[0].url') AS url FROM venue_review_queue WHERE id = ?").bind(logged).first('url')).toBe('https://example.org')
		const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
		await db.batch([['Past', '2000-01-01'], ['Today', today], ['Later', '2099-12-31']].map(([name, date]) =>
			db.prepare('INSERT INTO intake_candidates (id, revision, payload) VALUES (?, 1, ?)').bind(id(), JSON.stringify({ name, date }))))
		const held = await db.prepare("SELECT json_extract(payload, '$.name') AS name FROM intake_candidates WHERE json_extract(payload, '$.date') >= ? ORDER BY json_extract(payload, '$.date')").bind(today).all()
		expect(held.results.map((row) => row.name)).toEqual(['Today', 'Later'])
	})
})

describe('chat schema', () => {
	async function conversation(userId: string | null = null) {
		const conversationId = id()
		if (userId) await db.prepare("INSERT OR IGNORE INTO profiles (id, email) VALUES (?, 'chat@example.test')").bind(userId).run()
		await db.prepare('INSERT INTO conversations (id, user_id) VALUES (?, ?)').bind(conversationId, userId).run()
		return conversationId
	}
	const message = (conversationId: string, role: string, turn: number, parent: string | null = null) => {
		const messageId = id()
		return db.prepare("INSERT INTO messages (id, conversation_id, role, content, visible_content, turn_index, parent_id) VALUES (?, ?, ?, 'x', 'x', ?, ?)")
			.bind(messageId, conversationId, role, turn, parent).run().then(() => messageId)
	}

	it('requires an assistant message to name a user message of its own turn as parent', async () => {
		const c = await conversation(), other = await conversation()
		const user = await message(c, 'user', 0)
		await expect(message(c, 'assistant', 0)).rejects.toThrow('Assistant message must reference a user parent in the same turn')
		await expect(message(c, 'assistant', 0, await message(other, 'user', 0))).rejects.toThrow('Assistant parent message must reference a user message in the same turn')
		const assistant = await message(c, 'assistant', 0, user)
		await expect(db.prepare('UPDATE messages SET parent_id = NULL WHERE id = ?').bind(assistant).run()).rejects.toThrow('must reference a user parent')
		// A turn with no user message yet (an assistant greeting) needs no parent.
		await message(c, 'assistant', 5)
	})

	it('keeps chat turn statuses, locales and idempotency keys valid', async () => {
		const userId = id(), c = await conversation(userId)
		const userMessage = await message(c, 'user', 0)
		const turn = (fields: Record<string, unknown>) => {
			const row = { id: id(), conversation_id: c, user_id: userId, user_message_id: userMessage, user_client_message_id: 'u1', assistant_client_message_id: 'a1', content: 'hola', locale: 'es', ...fields }
			return db.prepare(`INSERT INTO chat_turns (${Object.keys(row).join(', ')}) VALUES (${Object.keys(row).map(() => '?').join(', ')})`).bind(...Object.values(row)).run()
		}
		await expect(turn({ status: 'expired' })).rejects.toThrow(/CHECK/)
		await expect(turn({ locale: 'pt' })).rejects.toThrow(/CHECK/)
		await turn({ status: 'running', claim_id: id(), claimed_until: iso(120_000) })
		await expect(turn({ assistant_client_message_id: 'a2' })).rejects.toThrow(/UNIQUE/)
		await expect(turn({ user_client_message_id: 'u2' })).rejects.toThrow(/UNIQUE/)
	})

	it('allows Telegram conversations only with a hash and no user, and checks Telegram update claims', async () => {
		const hash = 'a'.repeat(64)
		await db.prepare("INSERT INTO conversations (id, channel, external_identity_hash) VALUES (?, 'telegram', ?)").bind(id(), hash).run()
		await expect(db.prepare("INSERT INTO conversations (id, channel, external_identity_hash) VALUES (?, 'telegram', ?)").bind(id(), hash).run()).rejects.toThrow(/UNIQUE/)
		await expect(db.prepare("INSERT INTO conversations (id, channel) VALUES (?, 'telegram')").bind(id()).run()).rejects.toThrow(/CHECK/)
		await expect(db.prepare("INSERT INTO conversations (id, external_identity_hash) VALUES (?, ?)").bind(id(), 'b'.repeat(64)).run()).rejects.toThrow(/CHECK/)
		const update = (updateId: number, status: string, identity: string | null, key: string | null, error: string | null = null) =>
			db.prepare('INSERT INTO telegram_updates (update_id, status, identity_hash, envelope_key, error_code) VALUES (?, ?, ?, ?, ?)').bind(updateId, status, identity, key, error).run()
		const key = `${'A1+/'.repeat(10)}abc=`
		await update(1, 'processing', hash, key)
		await update(2, 'completed', hash, null)
		await update(3, 'completed', null, null, 'identity_redacted')
		await expect(update(4, 'processing', hash, null)).rejects.toThrow(/CHECK/)
		await expect(update(5, 'processing', hash, `${key.slice(0, 42)}!=`)).rejects.toThrow(/CHECK/)
		await expect(update(6, 'completed', hash, key)).rejects.toThrow(/CHECK/)
		await expect(update(7, 'completed', null, null)).rejects.toThrow(/CHECK/)
	})
})
