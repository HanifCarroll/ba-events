import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { D1Database } from '@cloudflare/workers-types'
import type { RequestEvent } from '@sveltejs/kit'
import { freshD1 } from '../../../../tests/support/d1.ts'
import * as chat from '#features/chat/api/chat-d1.server.ts'
import { EXTERNAL_CHANNEL } from '#features/chat/api/channels.ts'
import { betterAuthFor, createBetterAuth, type BetterAuthEnv } from './better-auth.server.ts'
import { magicLinkEmail, MAGIC_LINK_FROM } from './magic-link-email.server.ts'
import { getSessionUser } from './session.server.ts'
import { deleteAccountEffect } from './server.server.ts'
import { d1UserStore } from './user-store.server.ts'
import { Effect, Exit } from 'effect'
import * as savedRoute from '../../../routes/api/saved/+server.ts'

const ORIGIN = 'https://staging.example'
const SECRET = 'test-secret-that-is-long-enough-for-better-auth'
const ALICE = '00000000-0000-4000-8000-00000000a11c'
const BOB = '00000000-0000-4000-8000-000000000b0b'
const ALICE_CHAT = 'alice-chat'
const EVENT = '00000000-0000-4000-8000-0000000000e1'
const OTHER_EVENT = '00000000-0000-4000-8000-0000000000e2'
const DRAFT_EVENT = '00000000-0000-4000-8000-0000000000e3'

type Mail = { from: typeof MAGIC_LINK_FROM; to: string; subject: string; html: string; text: string }

let db: D1Database
let dispose: () => Promise<void>
let outbox: Mail[]
let env: BetterAuthEnv
beforeAll(async () => ({ db, dispose } = await freshD1()), 60_000)
afterAll(async () => { await dispose() })

beforeEach(async () => {
	outbox = []
	env = { DB: db, AUTH_SECRET: SECRET, EMAIL: { send: async (message) => { outbox.push(message) } } }
	await db.batch([
		db.prepare('DELETE FROM users'), db.prepare('DELETE FROM profiles'), db.prepare('DELETE FROM events'),
		db.prepare('DELETE FROM verification_tokens'), db.prepare('DELETE FROM auth_rate_limits'),
		db.prepare('DELETE FROM product_feedback'), db.prepare('DELETE FROM telegram_updates'),
	])
	// Seed existing accounts with preserved IDs and references.
	await db.batch([
		db.prepare(`INSERT INTO profiles (id, email, role) VALUES (?, 'alice@example.test', 'admin'), (?, 'bob@example.test', 'user')`).bind(ALICE, BOB),
		...[[EVENT, 'scheduled'], [OTHER_EVENT, 'scheduled'], [DRAFT_EVENT, 'pending_review']].map(([id, status]) =>
			db.prepare(`INSERT INTO events (id, name, starts_at, source, status) VALUES (?, 'Milonga', '2026-12-01T22:00:00.000Z', 'luma', ?)`).bind(id, status)),
		db.prepare(`INSERT INTO saved_events (id, user_id, event_id) VALUES (?, ?, ?)`).bind(crypto.randomUUID(), ALICE, EVENT),
		db.prepare(`INSERT INTO conversations (id, user_id) VALUES (?, ?)`).bind(ALICE_CHAT, ALICE),
	])
	await db.batch([
		...[[ALICE, 'alice@example.test'], [BOB, 'bob@example.test']].flatMap(([id, email]) => [
			db.prepare('INSERT INTO users (id, name, email, email_verified) VALUES (?, ?, ?, 1)').bind(id, email, email),
			db.prepare("INSERT INTO accounts (id, user_id, account_id, provider_id, issuer, created_at, updated_at) VALUES (?, ?, ?, 'email', 'local:email', ?, ?)").bind(crypto.randomUUID(), id, id, new Date(0).toISOString(), new Date(0).toISOString()),
		]),
	])
})

const auth = () => createBetterAuth(ORIGIN, env)
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
	new Request(`${ORIGIN}/api/auth${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN, 'cf-connecting-ip': '203.0.113.7', ...headers }, body: JSON.stringify(body) })

/** Signs in through the emailed link and returns the Cookie header the browser would send next. */
async function signInByEmail(email: string, locale = 'es') {
	const sent = await auth().handler(post('/sign-in/magic-link', { email, callbackURL: '/', metadata: { locale } }))
	expect(sent.status).toBe(200)
	const link = /https:\/\/staging\.example\/api\/auth\/magic-link\/verify\?\S+/.exec(outbox.at(-1)!.text)![0]
	const verified = await auth().handler(new Request(link))
	expect(verified.status).toBe(302)
	return cookieHeader(verified)
}

const cookieHeader = (response: Response) =>
	response.headers.getSetCookie().map((cookie) => cookie.split(';')[0]).filter((pair) => !pair.endsWith('=')).join('; ')

/** The part of a SvelteKit RequestEvent the session and routes read. */
function requestEvent(cookie: string, init: RequestInit & { path?: string } = {}) {
	const url = new URL(init.path ?? '/', ORIGIN)
	const jar = new Map(cookie.split('; ').filter(Boolean).map((pair) => pair.split('=') as [string, string]))
	return {
		url, platform: { env }, request: new Request(url, { ...init, headers: { cookie, 'content-type': 'application/json', ...(init.headers as object) } }),
		cookies: { get: (name: string) => jar.get(name), set: () => {}, getAll: () => [] },
	} as unknown as RequestEvent
}

describe('magic link', () => {
	it('emails a one-time link in the requested language from the baeventos.com sender', async () => {
		await auth().handler(post('/sign-in/magic-link', { email: 'Alice@Example.test', callbackURL: '/', metadata: { locale: 'en' } }))
		expect(outbox).toHaveLength(1)
		expect(outbox[0]).toMatchObject({ from: { name: 'BA Eventos', email: 'accounts@baeventos.com' }, to: 'alice@example.test', subject: 'Your BA Eventos sign-in link' })
		const link = /https:\/\/staging\.example\/api\/auth\/magic-link\/verify\?\S+/.exec(outbox[0]!.text)![0]
		expect(outbox[0]!.html).toContain(link.replace(/&/g, '&amp;'))
		expect((await auth().handler(new Request(link))).status).toBe(302)
		// The token works once.
		const reused = await auth().handler(new Request(link))
		expect(reused.headers.get('location')).toContain('error=INVALID_TOKEN')
	})

	it('signs an imported user in under their preserved id, with their profile and admin role', async () => {
		const cookie = await signInByEmail('alice@example.test')
		const session = await getSessionUser(requestEvent(cookie))
		expect(session).toMatchObject({ user: { id: ALICE, email: 'alice@example.test' }, isAdmin: true, profile: { id: ALICE, role: 'admin' } })
		expect(await d1UserStore(db).savedMembership(ALICE, [EVENT])).toEqual(new Set([EVENT]))
	})

	it('gives a new email a new user and profile, and a plain user is not an admin', async () => {
		const cookie = await signInByEmail('new@example.test')
		const session = await getSessionUser(requestEvent(cookie))
		expect(session?.user.email).toBe('new@example.test')
		expect(session?.profile).toMatchObject({ id: session!.user.id, email: 'new@example.test', role: 'user' })
		expect(session?.isAdmin).toBe(false)
	})

	it('limits magic-link requests per address', async () => {
		const statuses = []
		for (let i = 0; i < 6; i++) statuses.push((await auth().handler(post('/sign-in/magic-link', { email: 'bob@example.test' }))).status)
		expect(statuses).toEqual([200, 200, 200, 200, 200, 429])
	})
})

describe('session', () => {
	it('fails closed without a D1 binding', async () => {
		const cookie = await signInByEmail('alice@example.test')
		const event = { ...requestEvent(cookie), platform: undefined }
		expect(betterAuthFor(event)).toBeNull()
		expect(await getSessionUser(event)).toBeNull()
	})

	it('is signed out without a cookie, with a forged cookie, and when AUTH_SECRET is missing', async () => {
		expect(await getSessionUser(requestEvent(''))).toBeNull()
		expect(await getSessionUser(requestEvent('__Secure-baeventos.session_token=forged.value'))).toBeNull()
		const cookie = await signInByEmail('bob@example.test')
		env = { ...env, AUTH_SECRET: '' }
		expect(await getSessionUser(requestEvent(cookie))).toBeNull()
	})

	it('ends on sign-out', async () => {
		const cookie = await signInByEmail('bob@example.test')
		const out = await auth().handler(post('/sign-out', {}, { cookie }))
		expect(out.status).toBe(200)
		// The session row is gone; only the signed cache cookie (at most 60 s old) could still vouch for it.
		const tokenOnly = cookie.split('; ').filter((pair) => pair.includes('session_token')).join('; ')
		expect(await getSessionUser(requestEvent(tokenOnly))).toBeNull()
	})
})

describe('Google', () => {
	const googleSignIn = (emailVerified: boolean, email = 'alice@example.test', sub = 'google-sub-1') => {
		env = { ...env, GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'secret' }
		const google = createBetterAuth(ORIGIN, env, {
			clientId: 'client', clientSecret: 'secret',
			verifyIdToken: async () => true,
			getUserInfo: async () => ({ user: { email, emailVerified, name: 'Someone' }, data: { sub } as never }),
		})
		return google.handler(post('/sign-in/social', { provider: 'google', idToken: { token: 'synthetic' } }))
	}

	it('never links a Google identity whose email Google has not verified, and gives it no session', async () => {
		const response = await googleSignIn(false)
		expect(response.status).toBe(401)
		expect(response.headers.getSetCookie().some((cookie) => cookie.includes('session_token=') && !cookie.includes('session_token=;'))).toBe(false)
		expect(await db.prepare(`SELECT count(*) AS n FROM accounts WHERE provider_id = 'google'`).first<number>('n')).toBe(0)
		expect(await db.prepare('SELECT count(*) AS n FROM sessions').first<number>('n')).toBe(0)
		expect(await db.prepare('SELECT count(*) AS n FROM users').first<number>('n')).toBe(2)
	})

	it('links a Google account with the same verified email to the imported user instead of making a new one', async () => {
		const response = await googleSignIn(true)
		expect(response.status).toBe(200)
		const { results } = await db.prepare(`SELECT user_id, provider_id, issuer, account_id FROM accounts WHERE user_id = ? ORDER BY provider_id`).bind(ALICE).all()
		expect(results).toEqual([
			{ user_id: ALICE, provider_id: 'email', issuer: 'local:email', account_id: ALICE },
			{ user_id: ALICE, provider_id: 'google', issuer: 'https://accounts.google.com', account_id: 'google-sub-1' },
		])
		expect((await db.prepare('SELECT count(*) AS n FROM users').first<number>('n'))).toBe(2)
	})

	const sessionCookieSet = (response: Response) =>
		response.headers.getSetCookie().some((cookie) => cookie.includes('session_token=') && !cookie.includes('session_token=;'))

	it('never registers an unknown Google email that Google has not verified', async () => {
		const response = await googleSignIn(false, 'carol@example.test', 'google-sub-carol')
		expect(response.status).toBe(403)
		expect(sessionCookieSet(response)).toBe(false)
		expect(await db.prepare(`SELECT count(*) AS n FROM users WHERE email = 'carol@example.test'`).first<number>('n')).toBe(0)
		expect(await db.prepare(`SELECT count(*) AS n FROM accounts WHERE provider_id = 'google'`).first<number>('n')).toBe(0)
		expect(await db.prepare('SELECT count(*) AS n FROM sessions').first<number>('n')).toBe(0)
	})

	it('signs an unknown verified Google email in as a new user', async () => {
		const response = await googleSignIn(true, 'carol@example.test', 'google-sub-carol')
		expect(response.status).toBe(200)
		expect(sessionCookieSet(response)).toBe(true)
		const user = await db.prepare(`SELECT id, email_verified FROM users WHERE email = 'carol@example.test'`).first<{ id: string; email_verified: number }>()
		expect(user).toMatchObject({ email_verified: 1 })
		expect(await db.prepare(`SELECT count(*) AS n FROM accounts WHERE provider_id = 'google' AND user_id = ?`).bind(user!.id).first<number>('n')).toBe(1)
		expect(await db.prepare('SELECT count(*) AS n FROM sessions WHERE user_id = ?').bind(user!.id).first<number>('n')).toBe(1)
	})
})

describe('user store keeps each user to their own rows', () => {
	const store = () => d1UserStore(db)

	it('saving twice keeps one row, and only displayable events can be saved', async () => {
		expect(await store().save(BOB, OTHER_EVENT)).toBe('saved')
		expect(await store().save(BOB, OTHER_EVENT)).toBe('saved')
		expect(await db.prepare('SELECT count(*) AS n FROM saved_events WHERE user_id = ?').bind(BOB).first<number>('n')).toBe(1)
		expect(await store().save(BOB, DRAFT_EVENT)).toBe('event_not_found')
		expect(await store().save(BOB, 'no-such-event')).toBe('event_not_found')
	})

	it("user B can't read, unsave, or rename user A's rows", async () => {
		expect(await store().savedEvents(BOB)).toEqual([])
		expect(await store().savedMembership(BOB, [EVENT])).toEqual(new Set())
		await store().unsave(BOB, EVENT)
		await store().updateProfile(BOB, { display_name: 'Bob' })
		expect(await store().savedMembership(ALICE, [EVENT])).toEqual(new Set([EVENT]))
		expect((await store().profile(ALICE))?.display_name).toBeNull()
		const [saved] = await store().savedEvents(ALICE)
		expect(saved).toMatchObject({ id: EVENT, name: 'Milonga', is_free: false, categories: [] })
		expect(saved!.saved_at).toMatch(/Z$/)
	})

	it('deleting an account removes its profile, saved events, and conversations, and nobody else\'s', async () => {
		await store().save(BOB, EVENT)
		await store().deleteAccount(ALICE)
		expect(await db.prepare('SELECT count(*) AS n FROM profiles WHERE id = ?').bind(ALICE).first<number>('n')).toBe(0)
		expect(await db.prepare('SELECT count(*) AS n FROM saved_events WHERE user_id = ?').bind(ALICE).first<number>('n')).toBe(0)
		expect(await db.prepare('SELECT count(*) AS n FROM conversations WHERE user_id = ?').bind(ALICE).first<number>('n')).toBe(0)
		expect(await store().savedMembership(BOB, [EVENT])).toEqual(new Set([EVENT]))
	})

	it('account deletion deletes the session user, never the id the browser names', async () => {
		const cookie = await signInByEmail('bob@example.test')
		const exit = await Effect.runPromiseExit(deleteAccountEffect(requestEvent(cookie), { userId: ALICE }))
		expect(Exit.isFailure(exit)).toBe(true)
		expect(await db.prepare('SELECT count(*) AS n FROM users WHERE id = ?').bind(ALICE).first<number>('n')).toBe(1)
		await Effect.runPromise(deleteAccountEffect(requestEvent(cookie), { userId: BOB }))
		expect(await db.prepare('SELECT count(*) AS n FROM users WHERE id = ?').bind(BOB).first<number>('n')).toBe(0)
	})
})

describe('account deletion and chat history', () => {
	const tables = [
		'users', 'profiles', 'accounts', 'sessions', 'saved_events', 'conversations', 'messages', 'chat_turns',
		'product_feedback', 'telegram_updates',
	]
	const counts = () => db.prepare(`SELECT ${tables.map((table) => `(SELECT count(*) FROM ${table}) AS ${table}`).join(', ')}`)
		.first<Record<string, number>>()

	async function startTurn(userId: string, conversationId: string) {
		const input = {
			conversationId, turnId: `${conversationId}-turn`, userClientMessageId: 'question',
			assistantClientMessageId: 'reply', content: 'Synthetic question', locale: 'en' as const,
		}
		await chat.bootstrapTurn(db, userId, input)
		const claim = await chat.claimTurn(db, userId, input.turnId, 'fixture-claim', false)
		expect(claim).toMatchObject({ status: 'running', claim_id: 'fixture-claim' })
		const reply = {
			turnId: input.turnId, claimId: 'fixture-claim', assistantClientMessageId: input.assistantClientMessageId,
			content: 'Synthetic reply', attachedData: {}, executionTrace: [],
		}
		return { input, reply }
	}

	it('erases the session user’s chat without reviving an in-flight turn or affecting other owners', async () => {
		const active = await startTurn(ALICE, ALICE_CHAT)
		const archived = await startTurn(ALICE, 'alice-archived-chat')
		await chat.completeTurn(db, ALICE, archived.reply)
		await chat.softDeleteConversation(db, ALICE, archived.input.conversationId)
		const other = await startTurn(BOB, 'bob-chat')
		const otherTurn = await chat.completeTurn(db, BOB, other.reply)
		const otherChat = await chat.getConversation(db, BOB, other.input.conversationId)
		const channel = EXTERNAL_CHANNEL.telegram
		const hash = 'a'.repeat(64)
		const telegram = await chat.getOrCreateExternalConversation(db, channel, hash, 'Synthetic Telegram chat', {})
		const telegramMessage = await chat.insertMessage(db, { channel }, {
			conversationId: telegram.id, role: 'user', content: 'Synthetic Telegram question', responseContractVersion: 5,
		})
		await db.batch([
			db.prepare("INSERT INTO product_feedback (id, user_id, message) VALUES ('fixture', ?, 'Synthetic feedback')").bind(ALICE),
			db.prepare("INSERT INTO telegram_updates (update_id, conversation_id, identity_hash, status) VALUES (1, ?, ?, 'completed')").bind(telegram.id, hash),
		])

		const cookie = await signInByEmail('alice@example.test')
		const before = await counts()
		expect(before).toEqual({
			users: 2, profiles: 2, accounts: 2, sessions: 1, saved_events: 1, conversations: 4, messages: 6,
			chat_turns: 3, product_feedback: 1, telegram_updates: 1,
		})
		const result = await Effect.runPromise(deleteAccountEffect(requestEvent(cookie), { userId: ALICE }))
		expect(result).toEqual({ success: true })
		const after = await counts()
		expect(after).toEqual({
			users: 1, profiles: 1, accounts: 1, sessions: 0, saved_events: 0, conversations: 2, messages: 3,
			chat_turns: 1, product_feedback: 1, telegram_updates: 1,
		})
		expect(await db.prepare('SELECT user_id, message FROM product_feedback WHERE id = ?').bind('fixture').first())
			.toEqual({ user_id: null, message: 'Synthetic feedback' })
		expect(await db.prepare('SELECT conversation_id, status FROM telegram_updates WHERE update_id = 1').first())
			.toEqual({ conversation_id: telegram.id, status: 'completed' })
		expect(await chat.loadExternalMessages(db, channel, telegram.id)).toEqual([telegramMessage])
		expect(await chat.getConversation(db, BOB, other.input.conversationId)).toEqual(otherChat)
		expect(await chat.listTurns(db, BOB, other.input.conversationId)).toEqual([otherTurn])

		// An executor may still hold the old user ID and claim. Completion and recovery must reject at storage, too.
		await expect(chat.completeTurn(db, ALICE, active.reply)).rejects.toThrow('Turn claim lost')
		await expect(chat.claimTurn(db, ALICE, active.input.turnId, active.reply.claimId, true)).rejects.toThrow('Turn not found')
		await expect(chat.bootstrapTurn(db, ALICE, active.input)).rejects.toThrow()
		const afterRecovery = await counts()
		expect(afterRecovery).toEqual(after)

		if (process.env.BA_HISTORY_ERASURE_PROOF === '1') {
			console.log('Request: deleteAccount({ userId: <synthetic signed-in account> })')
			console.log('Result:', JSON.stringify(result))
			console.table(Object.fromEntries(tables.map((table) => [table, {
				before: before?.[table], after: after?.[table], afterRecovery: afterRecovery?.[table],
			}])))
		}
	})

	it.each([
		{
			stage: 'history erasure', error: 'history erasure blocked', sql: `BEFORE DELETE ON messages BEGIN
				SELECT RAISE(ABORT, 'history erasure blocked'); END`,
		},
		{
			stage: 'user deletion', error: 'user deletion blocked after history erasure', sql: `BEFORE DELETE ON users BEGIN
				SELECT RAISE(ABORT, 'history still present') WHERE EXISTS (SELECT 1 FROM conversations WHERE user_id = OLD.id);
				SELECT RAISE(ABORT, 'user deletion blocked after history erasure'); END`,
		},
	])('rolls back when $stage fails', async ({ error, sql }) => {
		const { input } = await startTurn(ALICE, ALICE_CHAT)
		const cookie = await signInByEmail('alice@example.test')
		const before = await counts()
		await db.prepare(`CREATE TRIGGER test_block_account_removal ${sql}`).run()
		try {
			await expect(Effect.runPromise(deleteAccountEffect(requestEvent(cookie), { userId: ALICE }))).rejects.toThrow(error)
		} finally {
			await db.prepare('DROP TRIGGER test_block_account_removal').run()
		}
		expect(await counts()).toEqual(before)
		expect(await chat.listTurns(db, ALICE, input.conversationId)).toMatchObject([{ id: input.turnId, status: 'running' }])
	})
})

describe('/api/saved', () => {
	const call = async (handler: 'GET' | 'POST' | 'DELETE', cookie: string, init: { body?: unknown; path?: string } = {}) => {
		const response = await savedRoute[handler](requestEvent(cookie, {
			method: handler, path: init.path ?? '/api/saved', body: init.body === undefined ? undefined : JSON.stringify(init.body),
		}) as never)
		return { status: response.status, body: await response.json() as Record<string, unknown> }
	}

	it('needs a session', async () => {
		expect((await call('GET', '')).status).toBe(401)
		expect((await call('POST', '', { body: { eventId: EVENT } })).status).toBe(401)
	})

	it('acts for the session user only, whatever user id the body names', async () => {
		const bob = await signInByEmail('bob@example.test')
		expect((await call('POST', bob, { body: { eventId: OTHER_EVENT, userId: ALICE } })).status).toBe(200)
		expect(await d1UserStore(db).savedMembership(ALICE, [OTHER_EVENT])).toEqual(new Set())
		expect((await call('DELETE', bob, { body: { eventId: EVENT } })).status).toBe(200)
		expect(await d1UserStore(db).savedMembership(ALICE, [EVENT])).toEqual(new Set([EVENT]))
		expect((await call('GET', bob)).body.events).toMatchObject([{ id: OTHER_EVENT }])
		expect((await call('GET', bob, { path: `/api/saved?ids=${EVENT},${OTHER_EVENT}` })).body).toEqual({ savedIds: [OTHER_EVENT] })
	})

	it('refuses with 409 when the session is not the account the page expected', async () => {
		const bob = await signInByEmail('bob@example.test')
		expect((await call('POST', bob, { body: { eventId: OTHER_EVENT, expectedUserId: ALICE } })).status).toBe(409)
		expect((await call('GET', bob, { path: `/api/saved?expectedUserId=${ALICE}` })).status).toBe(409)
		expect(await d1UserStore(db).savedMembership(BOB, [OTHER_EVENT])).toEqual(new Set())
	})

	it('rejects a missing event id and unknown events', async () => {
		const bob = await signInByEmail('bob@example.test')
		expect((await call('POST', bob, { body: {} })).status).toBe(400)
		expect((await call('POST', bob, { body: { eventId: DRAFT_EVENT } })).status).toBe(404)
	})
})

describe('magic-link email', () => {
	it('is Spanish by default, English on request, and escapes the link in HTML', () => {
		const url = 'https://baeventos.com/api/auth/magic-link/verify?token=a"b&callbackURL=/'
		const es = magicLinkEmail(url, 'es', 2026)
		expect(es.subject).toBe('Tu enlace para entrar a BA Eventos')
		expect(es.html).toContain('href="https://baeventos.com/api/auth/magic-link/verify?token=a&quot;b&amp;callbackURL=/"')
		expect(es.html).toContain('&copy; 2026 BA Eventos')
		expect(es.text).toContain(url)
		expect(magicLinkEmail(url, 'en').html).toContain('Sign in to your account')
	})
})
