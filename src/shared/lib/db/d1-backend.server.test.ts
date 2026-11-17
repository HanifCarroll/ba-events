/**
 * The D1 paths of the rate limiter, guest diagnostics, guest retention, Telegram delivery, and /api/feedback, on
 * Miniflare D1 through the same `useD1Binding` seam the staging Workers use. Without the binding these functions keep
 * calling Supabase (their own tests cover that path).
 */
import type { D1Database } from '@cloudflare/workers-types'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { freshD1 } from '../../../../tests/support/d1.ts'
import { useD1Binding } from './d1-binding.server.ts'
import { checkRateLimitD1 } from './rate-limit-d1.server.ts'
import { checkApiRateLimit, checkRateLimit, RateLimitUnavailableError } from '#features/auth/api/rate-limit.server.ts'
import { persistGuestChatDebug, recordGuestRequestStarted, recordGuestRequestTerminal } from '#features/chat/api/guest-debug.server.ts'
import { purgeGuestLifecycleRetention } from '../../../jobs-worker/guest-lifecycle-retention.ts'
import {
	attachTelegramUpdateConversation, claimTelegramUpdate, getTelegramUpdateEnvelopeKey, markTelegramUpdateCompleted,
	markTelegramUpdateFailed, redactTelegramIdentityClaims,
} from '#features/telegram/delivery.server.ts'
import { purgeTelegramRetention } from '#features/telegram/retention.ts'
import { countStaleTelegramFailures } from '#features/telegram/health.ts'
import { getOrCreateExternalConversation } from '#features/chat/api/external-conversations.server.ts'
import { POST as postFeedback } from '../../../routes/api/feedback/+server.ts'

let db: D1Database
let dispose: () => Promise<void>
beforeAll(async () => { ({ db, dispose } = await freshD1()) }, 60_000)
afterAll(async () => { await dispose() })
// Every test runs with D1 bound. Never test the unbound path here: Vitest loads .env, so it would reach production Supabase.
beforeEach(() => useD1Binding({ DB: db }))
afterEach(() => useD1Binding(undefined))

const count = (sql: string, ...values: unknown[]) => db.prepare(`SELECT count(*) AS n FROM ${sql}`).bind(...values).first<number>('n')

describe('check_rate_limit on D1', () => {
	it('allows exactly the limit within one window, then the next window starts over', async () => {
		const start = Date.UTC(2026, 10, 16, 12, 0, 0)
		const results = []
		for (let i = 0; i < 11; i++) results.push(await checkRateLimitD1(db, 't1', 'h', 10, 60, start + i * 1000))
		expect(results.map((r) => r.success)).toEqual([...Array(10).fill(true), false])
		expect(results.at(-1)).toMatchObject({ remaining: 0, reset: start + 60_000, request_count: 11 })
		expect(await checkRateLimitD1(db, 't1', 'h', 10, 60, start + 60_000)).toMatchObject({ success: true, request_count: 1 })
	})

	it('race: concurrent requests are each counted once', async () => {
		const now = Date.UTC(2026, 10, 16, 13, 0, 0)
		const results = await Promise.all(Array.from({ length: 20 }, () => checkRateLimitD1(db, 't2', 'h', 10, 60, now)))
		expect(results.map((r) => r.request_count).sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))
		expect(results.filter((r) => r.success)).toHaveLength(10)
	})

	it('deletes windows untouched for 7 days', async () => {
		const now = Date.UTC(2026, 10, 16, 14, 0, 0)
		await checkRateLimitD1(db, 't3', 'old', 10, 60, now - 8 * 24 * 60 * 60 * 1000)
		await checkRateLimitD1(db, 't3', 'new', 10, 60, now)
		expect(await count("rate_limit_windows WHERE scope = 't3'")).toBe(1)
	})

	it('keeps 50 an hour for chat and 10 a minute for the API, hashing the identifier', async () => {
		for (let i = 0; i < 50; i++) expect((await checkRateLimit('203.0.113.9')).success).toBe(true)
		expect((await checkRateLimit('203.0.113.9')).success).toBe(false)
		for (let i = 0; i < 10; i++) expect((await checkApiRateLimit('203.0.113.9')).success).toBe(true)
		expect((await checkApiRateLimit('203.0.113.9')).success).toBe(false)
		const rows = await db.prepare("SELECT scope, identifier_hash, window_starts_at FROM rate_limit_windows WHERE scope IN ('chat', 'public_api')").all<{
			scope: string; identifier_hash: string; window_starts_at: string
		}>()
		expect(rows.results.map((row) => row.scope).sort()).toEqual(['chat', 'public_api'])
		expect(rows.results.every((row) => /^[0-9a-f]{64}$/.test(row.identifier_hash))).toBe(true)
		expect(rows.results.find((row) => row.scope === 'chat')!.window_starts_at).toMatch(/T\d\d:00:00\.000Z$/)
	})

	it('fails closed when D1 is unavailable', async () => {
		useD1Binding({ DB: { prepare: () => { throw new Error('private detail') }, batch: async () => [] } })
		const error = await checkRateLimit('203.0.113.10').catch((cause) => cause)
		expect(error).toBeInstanceOf(RateLimitUnavailableError)
		expect(error.message).not.toContain('private detail')
	})
})

describe('guest lifecycle and debug rows on D1', () => {
	it('records start then terminal state, keeping started_at, and upserts the transcript', async () => {
		await recordGuestRequestStarted({ requestId: 'r1', conversationId: 'guest-1' })
		const started = await db.prepare('SELECT * FROM guest_request_lifecycle WHERE request_id = ?').bind('r1').first<{ started_at: string; status: string }>()
		expect(started?.status).toBe('started')
		await recordGuestRequestTerminal({ requestId: 'r1', conversationId: 'guest-1', status: 'completed_with_fallback', providerRequestId: 'p1' })
		await recordGuestRequestTerminal({ requestId: 'r2', conversationId: null, status: 'errored', errorType: 'runtime_interruption' })
		const rows = await db.prepare('SELECT * FROM guest_request_lifecycle ORDER BY request_id').all<Record<string, unknown>>()
		expect(rows.results).toMatchObject([
			{ request_id: 'r1', status: 'completed_with_fallback', started_at: started!.started_at, provider_request_id: 'p1' },
			{ request_id: 'r2', status: 'errored', error_type: 'runtime_interruption', conversation_id: null },
		])
		expect(rows.results.every((row) => typeof row.ended_at === 'string')).toBe(true)

		await persistGuestChatDebug({ conversationId: 'guest-1', locale: 'es', ip: '203.0.113.1', messages: [{ id: 'm1' }], lastUserText: 'hola' })
		await persistGuestChatDebug({ conversationId: 'guest-1', locale: 'es', ip: '203.0.113.1', messages: [{ id: 'm1' }, { id: 'm2' }], lastUserText: 'chau' })
		const debug = await db.prepare('SELECT messages, last_user_text FROM guest_chat_debug WHERE conversation_id = ?').bind('guest-1').first<{ messages: string; last_user_text: string }>()
		expect(JSON.parse(debug!.messages)).toHaveLength(2)
		expect(debug!.last_user_text).toBe('chau')
	})

	it('never throws to the chat when the write fails', async () => {
		await recordGuestRequestStarted({ requestId: 'r1', conversationId: 'guest-1' })
		await expect(recordGuestRequestStarted({ requestId: 'r1', conversationId: 'guest-1' })).resolves.toBeUndefined()
	})

	it('purges rows older than 30 days', async () => {
		const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString()
		await db.batch([
			db.prepare('DELETE FROM guest_request_lifecycle'), db.prepare('DELETE FROM guest_chat_debug'),
			db.prepare("INSERT INTO guest_request_lifecycle (request_id, status, started_at) VALUES ('old', 'started', ?), ('new', 'started', ?)").bind(old, new Date().toISOString()),
			db.prepare("INSERT INTO guest_chat_debug (conversation_id, updated_at) VALUES ('old', ?)").bind(old),
		])
		expect(await purgeGuestLifecycleRetention({ d1: db })).toEqual({ purged: 2 })
		expect(await count('guest_request_lifecycle')).toBe(1)
	})
})

describe('Telegram on D1', () => {
	const identity = 'b'.repeat(64)

	it('claims once, reuses the key on retry, completes, and redacts', async () => {
		const first = await claimTelegramUpdate('1001', identity)
		expect(first).toMatchObject({ completed: false, checkRateLimit: true })
		const key = (first as { envelopeKey: string }).envelopeKey
		expect(await claimTelegramUpdate('1001', identity)).toEqual({ completed: false, envelopeKey: key, checkRateLimit: false })
		await markTelegramUpdateFailed('1001', 'provider_failed')
		expect(await claimTelegramUpdate('1001', identity)).toEqual({ completed: false, envelopeKey: key, checkRateLimit: true })
		await expect(claimTelegramUpdate('1001', 'c'.repeat(64))).rejects.toThrow('identity mismatch')

		const conversation = await getOrCreateExternalConversation({ channel: 'telegram', externalIdentityHash: identity })
		await attachTelegramUpdateConversation('1001', identity, conversation.id)
		expect(await getTelegramUpdateEnvelopeKey('1001')).toBe(key)
		await markTelegramUpdateCompleted('1001', conversation.id)
		expect(await getTelegramUpdateEnvelopeKey('1001')).toBeNull()
		expect(await claimTelegramUpdate('1001', identity)).toEqual({ completed: true })
		await expect(attachTelegramUpdateConversation('1001', identity, conversation.id)).rejects.toThrow()

		await claimTelegramUpdate('1002', identity)
		await redactTelegramIdentityClaims(identity)
		const redacted = await db.prepare('SELECT * FROM telegram_updates WHERE update_id = 1002').first<Record<string, unknown>>()
		expect(redacted).toMatchObject({ status: 'completed', identity_hash: null, envelope_key: null, error_code: 'identity_redacted' })
	})

	it('race: concurrent claims of one update hand out one envelope key', async () => {
		const claims = await Promise.all([claimTelegramUpdate('2001', identity), claimTelegramUpdate('2001', identity)])
		const keys = claims.map((claim) => (claim as { envelopeKey: string }).envelopeKey)
		expect(keys[0]).toBe(keys[1])
		expect(claims.filter((claim) => (claim as { checkRateLimit: boolean }).checkRateLimit)).toHaveLength(1)
	})

	it('purges old conversations and claims, and counts stale failures', async () => {
		const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString()
		await db.batch([
			db.prepare('DELETE FROM telegram_updates'),
			db.prepare("INSERT INTO conversations (id, channel, external_identity_hash, created_at) VALUES ('t-old', 'telegram', ?, ?)").bind('d'.repeat(64), old),
			db.prepare("INSERT INTO telegram_updates (update_id, conversation_id, status, identity_hash, envelope_key, received_at, updated_at) VALUES (3001, 't-old', 'failed', ?, ?, ?, ?)")
				.bind(identity, `${'A'.repeat(43)}=`, old, old),
		])
		expect(await countStaleTelegramFailures({ d1: db })).toBe(1)
		expect(await purgeTelegramRetention({ d1: db })).toEqual({ conversations: 1, updates: 1 })
		expect(await countStaleTelegramFailures({ d1: db })).toBe(0)
	})
})

describe('/api/feedback on D1', () => {
	const ALICE = '00000000-0000-4000-8000-00000000000a'
	const request = (locals: { user: { id: string } | null }, body: unknown) => ({
		request: new Request('https://baeventos.com/api/feedback', { method: 'POST', body: JSON.stringify(body) }),
		locals, platform: {}, getClientAddress: () => `198.51.100.${Math.floor(Math.random() * 250)}`,
	}) as never

	it('stores feedback with the session user, never an id from the body', async () => {
		await db.batch([db.prepare('DELETE FROM product_feedback'), db.prepare('DELETE FROM profiles'),
			db.prepare("INSERT INTO profiles (id, email) VALUES (?, 'alice@example.test')").bind(ALICE)])
		expect((await postFeedback(request({ user: { id: ALICE } }, { message: ' Great app ', user_id: 'someone-else' }))).status).toBe(200)
		expect((await postFeedback(request({ user: null }, { message: 'Anonymous' }))).status).toBe(200)
		expect((await postFeedback(request({ user: null }, { message: '' }))).status).toBe(400)
		const rows = await db.prepare('SELECT user_id, message FROM product_feedback ORDER BY message').all()
		expect(rows.results).toEqual([{ user_id: null, message: 'Anonymous' }, { user_id: ALICE, message: 'Great app' }])
	})

	it('returns 503 when the rate limiter is unavailable', async () => {
		useD1Binding({ DB: { prepare: () => { throw new Error('down') }, batch: async () => [] } })
		expect((await postFeedback(request({ user: null }, { message: 'x' }))).status).toBe(503)
	})
})
