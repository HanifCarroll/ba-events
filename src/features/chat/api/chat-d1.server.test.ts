/**
 * The chat-turn RPCs ported to D1 batches, on Miniflare D1 with the real migrations. Covers the cases of
 * the claim and turn invariants, races, and cross-user isolation for user-owned tables.
 */
import type { D1Database } from '@cloudflare/workers-types'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { freshD1 } from '../../../../tests/support/d1.ts'
import * as chat from './chat-d1.server.ts'
import { EXTERNAL_CHANNEL } from './channels.ts'

let db: D1Database
let dispose: () => Promise<void>
beforeAll(async () => { ({ db, dispose } = await freshD1()) }, 60_000)
afterAll(async () => { await dispose() })

const ALICE = '00000000-0000-4000-8000-00000000000a'
const BOB = '00000000-0000-4000-8000-00000000000b'
const id = () => crypto.randomUUID()

beforeEach(async () => {
	await db.batch([
		db.prepare('DELETE FROM chat_turns'), db.prepare('DELETE FROM messages'), db.prepare('DELETE FROM conversations'),
		db.prepare('DELETE FROM product_feedback'), db.prepare('DELETE FROM profiles'),
		db.prepare("INSERT INTO profiles (id, email) VALUES (?, 'alice@example.test'), (?, 'bob@example.test')").bind(ALICE, BOB),
	])
})

function turnInput(overrides: Partial<chat.BootstrapTurnInput> = {}): chat.BootstrapTurnInput {
	return { conversationId: id(), turnId: id(), userClientMessageId: id(), assistantClientMessageId: id(), content: 'What is on tonight?', locale: 'en', ...overrides }
}

async function claimed(userId = ALICE) {
	const input = turnInput()
	await chat.bootstrapTurn(db, userId, input)
	const claimId = id()
	const turn = await chat.claimTurn(db, userId, input.turnId, claimId, false)
	return { input, claimId, turn }
}

function complete(userId: string, input: chat.BootstrapTurnInput, claimId: string, content = 'reply') {
	return chat.completeTurn(db, userId, {
		turnId: input.turnId, claimId, assistantClientMessageId: input.assistantClientMessageId, content,
		attachedData: { canonical: { text: content } }, executionTrace: [],
	})
}

const count = (sql: string, ...values: unknown[]) => db.prepare(`SELECT count(*) AS n FROM ${sql}`).bind(...values).first<number>('n')

it('classifies every foreign key to a profile or a chat history row', async () => {
	const { results: tables } = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*'")
		.all<{ name: string }>()
	const keys = await db.batch<{ table: string; on_delete: string }>(tables.map(({ name }) =>
		db.prepare(`PRAGMA foreign_key_list('${name.replaceAll("'", "''")}')`)))
	const parents = new Set(['profiles', 'conversations', 'messages', 'chat_turns'])
	const references = tables.flatMap(({ name }, index) => keys[index]!.results
		.filter((key) => parents.has(key.table.toLowerCase()))
		.map((key) => ({ name, parent: key.table, on_delete: key.on_delete })))
	const erased = chat.prepareUserHistoryErasure(db, ALICE).map(({ table }) => table)
	const outsideChat = [
		'dismissed_venue_duplicates', 'saved_events', 'user_preferences', 'venue_review_queue',
		'product_feedback', // Retained, with its account reference cleared.
		'telegram_updates', // Telegram has no account owner; its delivery records are retained.
	]
	expect([...new Set(references.map(({ name }) => name))].sort()).toEqual([...erased, ...outsideChat].sort())
	expect(references).toEqual(expect.arrayContaining([
		{ name: 'product_feedback', parent: 'profiles', on_delete: 'SET NULL' },
		{ name: 'telegram_updates', parent: 'conversations', on_delete: 'SET NULL' },
	]))
})

it('deletes each history table directly before deleting its parent', async () => {
	const { input, claimId } = await claimed()
	await complete(ALICE, input, claimId)
	const operations = chat.prepareUserHistoryErasure(db, ALICE)
	// changes() counts the preceding statement's direct writes, not foreign-key actions.
	const results = await db.batch<{ deleted: number }>(operations.flatMap(({ statement }) => [
		statement, db.prepare('SELECT changes() AS deleted'),
	]))
	expect(Object.fromEntries(operations.map(({ table }, index) => [table, results[2 * index + 1]?.results[0]?.deleted])))
		.toEqual({ chat_turns: 1, messages: 2, conversations: 1 })
	expect(await count('profiles WHERE id = ?', ALICE)).toBe(1)
})

describe('bootstrap_chat_turn', () => {
	it('creates the conversation, the user message, and a pending turn together', async () => {
		const input = turnInput()
		const turn = await chat.bootstrapTurn(db, ALICE, input)
		expect(turn).toMatchObject({ id: input.turnId, status: 'pending', attempt_count: 0, locale: 'en', content: input.content })
		const message = await db.prepare('SELECT * FROM messages WHERE id = ?').bind(turn.user_message_id).first<{ role: string; turn_index: number; client_message_id: string }>()
		expect(message).toMatchObject({ role: 'user', turn_index: 0, client_message_id: input.userClientMessageId })
		expect(await db.prepare('SELECT user_id FROM conversations WHERE id = ?').bind(input.conversationId).first('user_id')).toBe(ALICE)
	})

	it('replays the same turn, and two concurrent bootstraps store it once', async () => {
		const input = turnInput()
		const [a, b] = await Promise.all([chat.bootstrapTurn(db, ALICE, input), chat.bootstrapTurn(db, ALICE, input)])
		expect(a.id).toBe(b.id)
		expect(await chat.bootstrapTurn(db, ALICE, input)).toEqual(a)
		expect(await count('messages')).toBe(1)
		expect(await count('chat_turns')).toBe(1)
	})

	it('refuses a changed replay and another user’s conversation, writing nothing', async () => {
		const input = turnInput()
		await chat.bootstrapTurn(db, ALICE, input)
		await expect(chat.bootstrapTurn(db, ALICE, { ...input, content: 'Something else' })).rejects.toThrow('Turn conflict')
		await expect(chat.bootstrapTurn(db, BOB, input)).rejects.toThrow('Turn conflict')
		await expect(chat.bootstrapTurn(db, BOB, { ...input, turnId: id(), userClientMessageId: id() })).rejects.toThrow('Turn conflict')
		expect(await count('messages')).toBe(1)
	})

	it('validates its input like the RPC', async () => {
		await expect(chat.bootstrapTurn(db, ALICE, turnInput({ content: '  ' }))).rejects.toThrow('Invalid message')
		await expect(chat.bootstrapTurn(db, ALICE, turnInput({ userClientMessageId: 'x'.repeat(129) }))).rejects.toThrow('Invalid message id')
		await expect(chat.bootstrapTurn(db, ALICE, turnInput({ locale: 'fr' as 'en' }))).rejects.toThrow('Invalid locale')
	})
})

describe('claim_chat_turn', () => {
	it('takes a pending turn for two minutes and counts the attempt', async () => {
		const { turn, claimId } = await claimed()
		expect(turn).toMatchObject({ status: 'running', claim_id: claimId, attempt_count: 1, last_error: null })
		expect(Date.parse(turn.claimed_until!) - Date.now()).toBeGreaterThan(110_000)
	})

	it('race: two concurrent claims of the same turn leave exactly one holder', async () => {
		const input = turnInput()
		await chat.bootstrapTurn(db, ALICE, input)
		const [first, second] = [id(), id()]
		const results = await Promise.all([
			chat.claimTurn(db, ALICE, input.turnId, first, false), chat.claimTurn(db, ALICE, input.turnId, second, false),
		])
		const holder = results[0].claim_id
		expect([first, second]).toContain(holder)
		expect(results.map((turn) => turn.claim_id)).toEqual([holder, holder])
		expect(results.every((turn) => turn.attempt_count === 1)).toBe(true)
	})

	it('interrupts an expired claim unless retried, and a retry takes a new claim', async () => {
		const { input, claimId } = await claimed()
		await db.prepare('UPDATE chat_turns SET claimed_until = ? WHERE id = ?').bind(new Date(Date.now() - 1000).toISOString(), input.turnId).run()
		expect(await chat.claimTurn(db, ALICE, input.turnId, id(), false)).toMatchObject({ status: 'interrupted', claim_id: claimId })
		expect(await chat.claimTurn(db, ALICE, input.turnId, id(), false)).toMatchObject({ status: 'interrupted' })
		const retry = id()
		expect(await chat.claimTurn(db, ALICE, input.turnId, retry, true)).toMatchObject({ status: 'running', claim_id: retry, attempt_count: 2 })
	})

	it('returns a completed turn unchanged, and another user’s turn is not found', async () => {
		const { input, claimId } = await claimed()
		await complete(ALICE, input, claimId)
		expect(await chat.claimTurn(db, ALICE, input.turnId, id(), true)).toMatchObject({ status: 'completed', claim_id: claimId })
		await expect(chat.claimTurn(db, BOB, input.turnId, id(), true)).rejects.toThrow('Turn not found')
	})
})

describe('complete_chat_turn and fail_chat_turn', () => {
	it('refuses every turn that is not running under a live claim, and writes no reply', async () => {
		const { input, claimId } = await claimed()
		for (const [status, until] of [['pending', 60_000], ['failed', 60_000], ['interrupted', 60_000], ['running', -1000], ['running', null]] as const) {
			await db.prepare('UPDATE chat_turns SET status = ?, claimed_until = ? WHERE id = ?')
				.bind(status, until === null ? null : new Date(Date.now() + until).toISOString(), input.turnId).run()
			await expect(complete(ALICE, input, claimId)).rejects.toThrow('Turn claim lost')
			await expect(chat.failTurn(db, ALICE, input.turnId, claimId, 'execution_failed')).rejects.toThrow('Turn update failed')
		}
		expect(await count("messages WHERE role = 'assistant'")).toBe(0)
	})

	it('refuses a missing claim and a substituted assistant id', async () => {
		const { input, claimId } = await claimed()
		await expect(complete(ALICE, input, '')).rejects.toThrow('Turn claim lost')
		await expect(complete(ALICE, { ...input, assistantClientMessageId: id() }, claimId)).rejects.toThrow('Turn claim lost')
	})

	it('rolls back the reply when the batch fails', async () => {
		const { input, claimId } = await claimed()
		// A storage failure inside the batch: the assistant id already belongs to a message in another turn's slot.
		await db.prepare("CREATE TRIGGER fail_reply BEFORE INSERT ON messages WHEN NEW.content = 'storage failure' BEGIN SELECT RAISE(ABORT, 'simulated'); END").run()
		try {
			await expect(complete(ALICE, input, claimId, 'storage failure')).rejects.toThrow()
		} finally {
			await db.prepare('DROP TRIGGER fail_reply').run()
		}
		expect(await db.prepare('SELECT status FROM chat_turns WHERE id = ?').bind(input.turnId).first('status')).toBe('running')
		expect(await count("messages WHERE role = 'assistant'")).toBe(0)
	})

	it('stores one reply parented to the user message, and a replay changes nothing', async () => {
		const { input, claimId, turn } = await claimed()
		const done = await complete(ALICE, input, claimId, 'first reply')
		expect(done).toMatchObject({ status: 'completed', claimed_until: null })
		const reply = await chat.getTurnAssistantMessage(db, ALICE, done)
		expect(reply).toMatchObject({ content: 'first reply', parent_id: turn.user_message_id, turn_index: 0, sequence_number: 1 })
		expect(await complete(ALICE, input, claimId, 'overwrite')).toMatchObject({ status: 'completed', assistant_message_id: done.assistant_message_id })
		expect(await count("messages WHERE role = 'assistant'")).toBe(1)
		await expect(complete(ALICE, input, id(), 'stale overwrite')).rejects.toThrow('Turn claim lost')
	})

	it('race: a completion after a failure is refused, and a reclaimed turn rejects the stale claim', async () => {
		const { input, claimId } = await claimed()
		const failed = await chat.failTurn(db, ALICE, input.turnId, claimId, 'execution_failed')
		expect(failed).toMatchObject({ status: 'failed', last_error: 'execution_failed' })
		await expect(complete(ALICE, input, claimId)).rejects.toThrow('Turn claim lost')
		const retry = id()
		await chat.claimTurn(db, ALICE, input.turnId, retry, true)
		await expect(complete(ALICE, input, claimId, 'stale reply')).rejects.toThrow('Turn claim lost')
		expect(await complete(ALICE, input, retry)).toMatchObject({ status: 'completed', claim_id: retry })
		expect(await count("messages WHERE role = 'assistant'")).toBe(1)
	})

	it('race: concurrent completion and failure of one claim end in exactly one state', async () => {
		const { input, claimId } = await claimed()
		const [completed, failed] = await Promise.allSettled([
			complete(ALICE, input, claimId), chat.failTurn(db, ALICE, input.turnId, claimId, 'execution_failed'),
		])
		const status = await db.prepare('SELECT status FROM chat_turns WHERE id = ?').bind(input.turnId).first('status')
		const replies = await count("messages WHERE role = 'assistant'")
		if (status === 'completed') {
			expect(completed.status).toBe('fulfilled'); expect(failed.status).toBe('rejected'); expect(replies).toBe(1)
		} else {
			expect(status).toBe('failed'); expect(completed.status).toBe('rejected'); expect(replies).toBe(0)
		}
	})

	it('race: two concurrent completions of one claim store one reply', async () => {
		const { input, claimId } = await claimed()
		const results = await Promise.all([complete(ALICE, input, claimId, 'a'), complete(ALICE, input, claimId, 'b')])
		expect(results[0].assistant_message_id).toBe(results[1].assistant_message_id)
		expect(await count("messages WHERE role = 'assistant'")).toBe(1)
	})

	it('maps an unknown error code to execution_failed', async () => {
		const { input, claimId } = await claimed()
		expect(await chat.failTurn(db, ALICE, input.turnId, claimId, 'oops')).toMatchObject({ last_error: 'execution_failed' })
	})
})

describe('insert_message_with_turn', () => {
	it('numbers turns and sequences, parents assistants to the latest user message, and is idempotent by client id', async () => {
		const conversation = await chat.createConversation(db, ALICE, {})
		const write = (role: 'user' | 'assistant' | 'system', clientMessageId: string | null, parentId?: string) =>
			chat.insertMessage(db, { userId: ALICE }, { conversationId: conversation.id, role, content: role, responseContractVersion: 5, clientMessageId, parentId })
		const user0 = await write('user', 'u0')
		const reply0 = await write('assistant', 'a0')
		const user1 = await write('user', 'u1')
		const system = await write('system', null)
		const reply0Late = await write('assistant', 'a0-late', user0.id)
		expect([user0, reply0, user1, system, reply0Late].map((m) => [m.turn_index, m.sequence_number])).toEqual([[0, 0], [0, 1], [1, 2], [1, 3], [0, 4]])
		expect(reply0.parent_id).toBe(user0.id)
		expect(reply0Late.parent_id).toBe(user0.id)
		expect((await write('user', 'u0')).id).toBe(user0.id)
		await expect(write('assistant', 'bad', reply0.id)).rejects.toThrow('Assistant parent message must reference a user message')
	})

	it('race: concurrent inserts with one client id store one message', async () => {
		const conversation = await chat.createConversation(db, ALICE, {})
		const write = () => chat.insertMessage(db, { userId: ALICE }, { conversationId: conversation.id, role: 'user', content: 'hi', responseContractVersion: 5, clientMessageId: 'same' })
		const [a, b] = await Promise.all([write(), write()])
		expect(a.id).toBe(b.id)
		expect(await count('messages')).toBe(1)
	})

	it('race: concurrent user messages take distinct turn and sequence numbers', async () => {
		const conversation = await chat.createConversation(db, ALICE, {})
		const rows = await Promise.all([1, 2, 3, 4].map((n) => chat.insertMessage(db, { userId: ALICE },
			{ conversationId: conversation.id, role: 'user', content: String(n), responseContractVersion: 5, clientMessageId: `c${n}` })))
		expect(new Set(rows.map((row) => row.turn_index)).size).toBe(4)
		expect(new Set(rows.map((row) => row.sequence_number)).size).toBe(4)
	})

	it('writes only into the owner’s live conversation', async () => {
		const conversation = await chat.createConversation(db, ALICE, {})
		const message = { conversationId: conversation.id, role: 'user' as const, content: 'hi', responseContractVersion: 5 }
		await expect(chat.insertMessage(db, { userId: BOB }, message)).rejects.toThrow('Conversation not found')
		await expect(chat.insertMessage(db, { channel: EXTERNAL_CHANNEL.telegram }, message)).rejects.toThrow('Conversation not found')
		await chat.softDeleteConversation(db, ALICE, conversation.id)
		await expect(chat.insertMessage(db, { userId: ALICE }, message)).rejects.toThrow('Conversation not found')
		expect(await count('messages')).toBe(0)
	})
})

describe('cross-user isolation', () => {
	it('conversations: user B cannot list, read, search, rename, or delete user A’s conversation', async () => {
		const input = turnInput({ content: 'secret plans in Palermo' })
		await chat.bootstrapTurn(db, ALICE, input)
		expect((await chat.listConversations(db, BOB, 50, 0)).total).toBe(0)
		expect(await chat.getConversation(db, BOB, input.conversationId)).toBeNull()
		expect(await chat.searchConversations(db, BOB, 'palermo', 20)).toEqual([])
		await expect(chat.updateConversation(db, BOB, input.conversationId, { title: 'mine' })).rejects.toThrow('Conversation not found')
		await chat.softDeleteConversation(db, BOB, input.conversationId)
		await expect(chat.createConversation(db, BOB, { id: input.conversationId })).rejects.toThrow('Conversation not found')
		const own = await chat.getConversation(db, ALICE, input.conversationId)
		expect(own).toMatchObject({ title: 'New conversation', deleted_at: null, user_id: ALICE })
		expect((await chat.searchConversations(db, ALICE, 'PALERMO secret', 20))).toHaveLength(1)
	})

	it('messages: user B cannot read, add to, or change user A’s messages', async () => {
		const input = turnInput()
		const turn = await chat.bootstrapTurn(db, ALICE, input)
		expect(await chat.getMessages(db, BOB, input.conversationId)).toEqual([])
		expect(await chat.findOwnMessageId(db, BOB, input.conversationId, input.userClientMessageId)).toBeNull()
		await expect(chat.updateMessageAttachedData(db, BOB, turn.user_message_id, { canonical: 'x' })).rejects.toThrow('Message not found')
		expect(await chat.getMessages(db, ALICE, input.conversationId)).toHaveLength(1)
	})

	it('chat turns: user B cannot list, claim, complete, fail, or read the reply of user A’s turn', async () => {
		const { input, claimId } = await claimed(ALICE)
		expect(await chat.listTurns(db, BOB, input.conversationId)).toEqual([])
		await expect(chat.claimTurn(db, BOB, input.turnId, id(), true)).rejects.toThrow('Turn not found')
		await expect(complete(BOB, input, claimId)).rejects.toThrow('Turn claim lost')
		await expect(chat.failTurn(db, BOB, input.turnId, claimId, 'execution_failed')).rejects.toThrow('Turn update failed')
		const done = await complete(ALICE, input, claimId)
		expect(await chat.getTurnAssistantMessage(db, BOB, done)).toBeNull()
		expect(await chat.listTurns(db, ALICE, input.conversationId)).toHaveLength(1)
	})
})

describe('conversation search', () => {
	it('matches accented capitals in Spanish text, for the owner only', async () => {
		const input = turnInput({ content: 'Ópera en el Colón ÉSTE sábado' })
		await chat.bootstrapTurn(db, ALICE, input)
		for (const query of ['Ópera en el Colón ÉSTE sábado', 'Ópera', 'ópera colón', 'éste SÁBADO']) {
			expect((await chat.searchConversations(db, ALICE, query, 20)).map((row) => row.conversation_id)).toEqual([input.conversationId])
		}
		expect(await chat.searchConversations(db, ALICE, 'ópera tango', 20)).toEqual([])
		expect(await chat.searchConversations(db, BOB, 'Ópera', 20)).toEqual([])
	})
})

describe('external conversations', () => {
	const channel = EXTERNAL_CHANNEL.telegram
	const hash = 'a'.repeat(64)

	it('creates one owner-less conversation per identity, even concurrently', async () => {
		const [a, b] = await Promise.all([
			chat.getOrCreateExternalConversation(db, channel, hash, 'New conversation', {}),
			chat.getOrCreateExternalConversation(db, channel, hash, 'New conversation', {}),
		])
		expect(a.id).toBe(b.id)
		expect(await db.prepare('SELECT count(*) AS n FROM conversations WHERE channel = ? AND user_id IS NULL').bind(channel).first('n')).toBe(1)
	})

	it('keeps signed-in users and Telegram apart in both directions', async () => {
		const external = await chat.getOrCreateExternalConversation(db, channel, hash, 'New conversation', {})
		const web = await chat.createConversation(db, ALICE, {})
		expect(await chat.getExternalConversation(db, channel, web.id)).toBeNull()
		expect(await chat.getConversation(db, ALICE, external.id)).toBeNull()
		await expect(chat.insertMessage(db, { userId: ALICE }, { conversationId: external.id, role: 'user', content: 'x', responseContractVersion: 5 }))
			.rejects.toThrow('Conversation not found')
		await chat.clearExternalMessages(db, channel, web.id)
		await chat.deleteExternalConversation(db, channel, web.id)
		expect(await chat.getConversation(db, ALICE, web.id)).not.toBeNull()
	})

	it('reads the newest 120 messages and replaces metadata', async () => {
		const external = await chat.getOrCreateExternalConversation(db, channel, hash, 'New conversation', {})
		await chat.insertMessage(db, { channel }, { conversationId: external.id, role: 'user', content: 'hola', responseContractVersion: 5, clientMessageId: 'external:1:user' })
		expect(await chat.loadExternalMessages(db, channel, external.id)).toHaveLength(1)
		expect((await chat.setExternalMetadata(db, channel, external.id, { locale: 'es' })).metadata).toEqual({ locale: 'es' })
		await chat.clearExternalMessages(db, channel, external.id)
		expect(await chat.loadExternalMessages(db, channel, external.id)).toHaveLength(0)
	})
})
