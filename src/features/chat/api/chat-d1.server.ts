/**
 * Chat persistence on D1: conversations, messages, and chat turns (delivery PR 05).
 *
 * The Postgres RPCs `bootstrap_chat_turn`, `claim_chat_turn`, `complete_chat_turn`, `fail_chat_turn`, and
 * `insert_message_with_turn` become single `db.batch()` calls. A batch is one transaction and D1 runs one at a time, so
 * the row locks become preconditions (`batchAssert`, which aborts the whole batch) and guarded updates. A turn's guard is
 * its claim: every terminal write names the claim id it holds and the claim must still be live.
 *
 * Row-level security does not exist on D1. Every function here takes the owner (a signed-in user's id, or the external
 * channel for owner-less conversations) and filters every read and write by it.
 */
import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types'
import { Schema } from 'effect'
import { batchAssert } from '#shared/lib/db/d1.server.ts'
import type { Conversation, ConversationListItem, Json, Message, MessageRole } from '#shared/lib/types.ts'
import { CONVERSATION_CHANNELS, type ExternalChannel } from './channels.ts'
import type { ChatTurn } from './turns.server.ts'

export const CLAIM_MS = 2 * 60 * 1000

/** The errors callers can tell apart, with the messages the Postgres RPCs raised. */
export const CHAT_STORE_ERRORS = [
	'Not authenticated', 'Invalid message', 'Invalid message id', 'Invalid locale', 'Turn conflict', 'Turn not found',
	'Turn claim lost', 'Turn update failed', 'Conversation not found',
	'Assistant parent message must reference a user message in the same conversation',
] as const

export class ChatStoreError extends Error {
	override name = 'ChatStoreError'
}

/** D1 reports a failed `batchAssert` as an error whose message contains its reason; keep only the reason. */
function storeError(error: unknown): ChatStoreError {
	const message = error instanceof Error ? error.message : String(error)
	return new ChatStoreError(CHAT_STORE_ERRORS.find((reason) => message.includes(reason)) ?? 'Chat storage failed')
}

async function run<T>(work: () => Promise<T>): Promise<T> {
	try { return await work() } catch (error) { throw error instanceof ChatStoreError ? error : storeError(error) }
}

const UNIQUE = /UNIQUE constraint failed|PRIMARY KEY/i

// ---------------------------------------------------------------------------------------------------------------------
// Decoding at the edge: D1 returns JSON columns as text.

const Text = Schema.NullOr(Schema.String)
const JsonText = Schema.fromJsonString(Schema.Unknown)

const messageRow = Schema.Struct({
	id: Schema.String, conversation_id: Schema.String, parent_id: Text, client_message_id: Text,
	role: Schema.Literals(['user', 'assistant', 'system']), content: Schema.String, visible_content: Schema.String,
	execution_trace: JsonText, response_contract_version: Schema.Int, attached_data: Schema.NullOr(JsonText),
	created_at: Schema.String, sequence_number: Schema.Int, turn_index: Schema.Int,
})
const conversationRow = Schema.Struct({
	id: Schema.String, user_id: Text, channel: Schema.Literals(CONVERSATION_CHANNELS), external_identity_hash: Text,
	title: Schema.String, created_at: Schema.String, updated_at: Schema.String, deleted_at: Text,
	metadata: Schema.NullOr(JsonText),
})
const turnRow = Schema.Struct({
	id: Schema.String, conversation_id: Schema.String, user_message_id: Schema.String, assistant_message_id: Text,
	user_client_message_id: Schema.String, assistant_client_message_id: Schema.String, content: Schema.String,
	locale: Schema.Literals(['en', 'es']), status: Schema.Literals(['pending', 'running', 'completed', 'failed', 'interrupted']),
	claim_id: Text, claimed_until: Text, attempt_count: Schema.Int, last_error: Text,
})

const decodeMessageRow = Schema.decodeUnknownSync(messageRow)
const decodeConversationRow = Schema.decodeUnknownSync(conversationRow)
const decodeTurnRow = Schema.decodeUnknownSync(turnRow)

export function decodeMessage(row: unknown): Message {
	const message = decodeMessageRow(row)
	return { ...message, attached_data: message.attached_data ?? {} } as Message
}

export function decodeConversation(row: unknown): Conversation {
	const conversation = decodeConversationRow(row)
	return { ...conversation, metadata: (conversation.metadata ?? {}) as Record<string, Json> }
}

export function decodeTurn(row: unknown): ChatTurn {
	return decodeTurnRow(row) as ChatTurn
}

function firstRow(result: { results?: unknown[] } | undefined): unknown {
	return result?.results?.[0] ?? null
}

// ---------------------------------------------------------------------------------------------------------------------
// insert_message_with_turn

/** A signed-in user's own conversation, or an owner-less conversation of an external channel. */
export type ConversationOwner = { userId: string } | { channel: ExternalChannel }

function ownerCondition(owner: ConversationOwner): [string, unknown] {
	return 'userId' in owner
		? ['user_id = ?', owner.userId]
		: ['user_id IS NULL AND channel = ?', owner.channel]
}

export type MessageWrite = {
	conversationId: string
	role: MessageRole
	content: string
	visibleContent?: string
	executionTrace?: unknown[]
	responseContractVersion: number
	attachedData?: unknown
	clientMessageId?: string | null
	parentId?: string | null
}

/**
 * The statements of `insert_message_with_turn` for a batch, and a statement that reads the stored message back. A message
 * whose client id already exists in the conversation is not written again. Sequence and turn numbers are computed
 * inside the batch, so two concurrent writers cannot take the same number.
 */
export function insertMessageStatements(
	db: D1Database, owner: ConversationOwner, input: MessageWrite, now: string, extraCondition?: [string, ...unknown[]],
): { statements: D1PreparedStatement[]; read: D1PreparedStatement } {
	const id = crypto.randomUUID()
	const conversation = input.conversationId
	const clientId = input.clientMessageId ?? null
	const [ownerSql, ownerValue] = ownerCondition(owner)
	const existing = 'EXISTS (SELECT 1 FROM messages WHERE conversation_id = ? AND client_message_id = ?)'
	const statements = [batchAssert(db, 'Conversation not found',
		`EXISTS (SELECT 1 FROM conversations WHERE id = ? AND deleted_at IS NULL AND ${ownerSql})`, conversation, ownerValue)]

	let parent: [string, ...unknown[]]
	let turn: [string, ...unknown[]]
	const nextTurn = '(SELECT coalesce(max(turn_index), -1) + 1 FROM messages WHERE conversation_id = ?)'
	const latestUser = (column: string) =>
		`(SELECT ${column} FROM messages WHERE conversation_id = ? AND role = 'user' ORDER BY turn_index DESC, id DESC LIMIT 1)`
	if (input.role === 'user') {
		parent = ['NULL']
		turn = [nextTurn, conversation]
	} else if (input.role === 'assistant' && input.parentId) {
		statements.push(batchAssert(db, 'Assistant parent message must reference a user message in the same conversation',
			`${existing} OR EXISTS (SELECT 1 FROM messages WHERE id = ? AND conversation_id = ? AND role = 'user')`,
			conversation, clientId, input.parentId, conversation))
		parent = ['?', input.parentId]
		turn = [`(SELECT turn_index FROM messages WHERE id = ? AND conversation_id = ? AND role = 'user')`, input.parentId, conversation]
	} else if (input.role === 'assistant') {
		parent = [latestUser('id'), conversation]
		turn = [`coalesce(${latestUser('turn_index')}, ${nextTurn})`, conversation, conversation]
	} else {
		parent = ['NULL']
		turn = ['(SELECT coalesce(max(turn_index), 0) FROM messages WHERE conversation_id = ?)', conversation]
	}

	const [gateSql, ...gateValues] = extraCondition ?? ['1']
	statements.push(db.prepare(
		`INSERT INTO messages (id, conversation_id, parent_id, client_message_id, role, content, visible_content, execution_trace,
			response_contract_version, attached_data, created_at, sequence_number, turn_index)
		SELECT ?, ?, ${parent[0]}, ?, ?, ?, ?, ?, ?, ?, ?,
			(SELECT coalesce(max(sequence_number), -1) + 1 FROM messages WHERE conversation_id = ?), ${turn[0]}
		WHERE NOT ${existing} AND (${gateSql})`,
	).bind(
		id, conversation, ...parent.slice(1), clientId, input.role, input.content, input.visibleContent ?? input.content,
		JSON.stringify(input.executionTrace ?? []), input.responseContractVersion, JSON.stringify(input.attachedData ?? {}), now,
		conversation, ...turn.slice(1), conversation, clientId, ...gateValues,
	))
	statements.push(db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ? AND EXISTS (SELECT 1 FROM messages WHERE id = ?)')
		.bind(now, conversation, id))
	const read = db.prepare(`SELECT * FROM messages WHERE id = ? OR (conversation_id = ? AND client_message_id = ?) LIMIT 1`)
		.bind(id, conversation, clientId)
	return { statements, read }
}

/** `insert_message_with_turn`: stores a message in an owned conversation, or returns the one with the same client id. */
export function insertMessage(db: D1Database, owner: ConversationOwner, input: MessageWrite): Promise<Message> {
	return run(async () => {
		const { statements, read } = insertMessageStatements(db, owner, input, new Date().toISOString())
		const results = await db.batch([...statements, read])
		const row = firstRow(results.at(-1))
		if (!row) throw new ChatStoreError('Conversation not found')
		return decodeMessage(row)
	})
}

// ---------------------------------------------------------------------------------------------------------------------
// Chat turns

export type BootstrapTurnInput = {
	conversationId: string; turnId: string; userClientMessageId: string
	assistantClientMessageId: string; content: string; locale: 'en' | 'es'
}

function sameTurn(turn: ChatTurn & { user_id?: string }, userId: string, input: BootstrapTurnInput): boolean {
	return turn.user_id === userId && turn.conversation_id === input.conversationId &&
		turn.user_client_message_id === input.userClientMessageId &&
		turn.assistant_client_message_id === input.assistantClientMessageId &&
		turn.content === input.content && turn.locale === input.locale
}

function readTurnRow(db: D1Database, sql: string, ...values: unknown[]) {
	return db.prepare(`SELECT * FROM chat_turns WHERE ${sql} LIMIT 1`).bind(...values).first<ChatTurn & { user_id: string }>()
}

/** `bootstrap_chat_turn`: creates the conversation if needed, the user message, and the pending turn, all at once. */
export function bootstrapTurn(db: D1Database, userId: string, input: BootstrapTurnInput): Promise<ChatTurn> {
	return run(async () => {
		if (!input.content.trim() || input.content.length > 2000) throw new ChatStoreError('Invalid message')
		for (const id of [input.userClientMessageId, input.assistantClientMessageId]) {
			if (id.length < 1 || id.length > 128) throw new ChatStoreError('Invalid message id')
		}
		if (input.locale !== 'en' && input.locale !== 'es') throw new ChatStoreError('Invalid locale')

		// As in Postgres: a turn with this id must be the same turn, and after a unique violation the turn holding this id
		// or this user message is returned when it matches.
		const replay = async (sql: string, ...values: unknown[]) => {
			const existing = await readTurnRow(db, sql, ...values)
			if (existing && sameTurn(existing, userId, input)) return decodeTurn(existing)
			if (existing) throw new ChatStoreError('Turn conflict')
			return null
		}
		const known = await replay('id = ?', input.turnId)
		if (known) return known

		const now = new Date().toISOString()
		const message = insertMessageStatements(db, { userId }, {
			conversationId: input.conversationId, role: 'user', content: input.content, responseContractVersion: 5,
			clientMessageId: input.userClientMessageId,
		}, now)
		try {
			const results = await db.batch([
				db.prepare('INSERT INTO conversations (id, user_id) VALUES (?, ?) ON CONFLICT (id) DO NOTHING').bind(input.conversationId, userId),
				batchAssert(db, 'Turn conflict', 'EXISTS (SELECT 1 FROM conversations WHERE id = ? AND user_id = ? AND deleted_at IS NULL)',
					input.conversationId, userId),
				...message.statements,
				db.prepare(`INSERT INTO chat_turns (id, conversation_id, user_id, user_message_id, user_client_message_id,
						assistant_client_message_id, content, locale, created_at, updated_at)
					VALUES (?, ?, ?, (SELECT id FROM messages WHERE conversation_id = ? AND client_message_id = ?), ?, ?, ?, ?, ?, ?)`)
					.bind(input.turnId, input.conversationId, userId, input.conversationId, input.userClientMessageId,
						input.userClientMessageId, input.assistantClientMessageId, input.content, input.locale, now, now),
				db.prepare('SELECT * FROM chat_turns WHERE id = ?').bind(input.turnId),
			])
			return decodeTurn(firstRow(results.at(-1)))
		} catch (error) {
			// Another request created the turn first: the same turn is a replay, anything else conflicts.
			if (error instanceof Error && UNIQUE.test(error.message)) {
				const raced = await replay('id = ? OR (conversation_id = ? AND user_client_message_id = ?)',
					input.turnId, input.conversationId, input.userClientMessageId)
				if (raced) return raced
			}
			throw error
		}
	})
}

/**
 * `claim_chat_turn`. A completed turn, a turn whose claim is still live, and (without `retry`) a failed or interrupted
 * turn come back unchanged. A running turn whose claim expired becomes interrupted unless this is a retry. Anything
 * else takes the claim for two minutes. The caller may run the model only when the returned claim is its own.
 */
export function claimTurn(db: D1Database, userId: string, turnId: string, claimId: string, retry: boolean): Promise<ChatTurn> {
	return run(async () => {
		const now = new Date()
		const iso = now.toISOString()
		const retryFlag = retry ? 1 : 0
		const [, read] = await db.batch([
			db.prepare(`UPDATE chat_turns SET
					status = CASE WHEN status = 'running' AND ?1 = 0 THEN 'interrupted' ELSE 'running' END,
					claim_id = CASE WHEN status = 'running' AND ?1 = 0 THEN claim_id ELSE ?2 END,
					claimed_until = CASE WHEN status = 'running' AND ?1 = 0 THEN claimed_until ELSE ?3 END,
					attempt_count = CASE WHEN status = 'running' AND ?1 = 0 THEN attempt_count ELSE attempt_count + 1 END,
					last_error = CASE WHEN status = 'running' AND ?1 = 0 THEN last_error ELSE NULL END,
					updated_at = ?4
				WHERE id = ?5 AND user_id = ?6 AND status <> 'completed'
					AND NOT (status = 'running' AND coalesce(claimed_until > ?4, 0))
					AND NOT (status IN ('failed', 'interrupted') AND ?1 = 0)`)
				.bind(retryFlag, claimId, new Date(now.getTime() + CLAIM_MS).toISOString(), iso, turnId, userId),
			db.prepare('SELECT * FROM chat_turns WHERE id = ? AND user_id = ?').bind(turnId, userId),
		])
		const row = firstRow(read)
		if (!row) throw new ChatStoreError('Turn not found')
		return decodeTurn(row)
	})
}

export type CompleteTurnInput = {
	turnId: string; claimId: string; assistantClientMessageId: string; content: string
	attachedData: Record<string, unknown>; executionTrace: unknown[]
}

/**
 * `complete_chat_turn`. Only the live claim's holder completes a turn, and only with the turn's own assistant id. A
 * completed turn replays unchanged for that claim. The assistant message and the turn's completion commit together.
 */
export function completeTurn(db: D1Database, userId: string, input: CompleteTurnInput): Promise<ChatTurn> {
	return run(async () => {
		if (!input.claimId) throw new ChatStoreError('Turn claim lost')
		// conversation_id and user_message_id never change after bootstrap; the mutable fields are checked in the batch.
		const turn = await db.prepare('SELECT conversation_id, user_message_id FROM chat_turns WHERE id = ? AND user_id = ?')
			.bind(input.turnId, userId).first<{ conversation_id: string; user_message_id: string }>()
		if (!turn) throw new ChatStoreError('Turn claim lost')
		const now = new Date().toISOString()
		const running = `EXISTS (SELECT 1 FROM chat_turns WHERE id = ? AND status = 'running')`
		const message = insertMessageStatements(db, { userId }, {
			conversationId: turn.conversation_id, role: 'assistant', content: input.content, responseContractVersion: 5,
			executionTrace: input.executionTrace ?? [], attachedData: input.attachedData ?? {},
			clientMessageId: input.assistantClientMessageId, parentId: turn.user_message_id,
		}, now, [running, input.turnId])
		const results = await db.batch([
			batchAssert(db, 'Turn claim lost',
				'EXISTS (SELECT 1 FROM chat_turns WHERE id = ? AND user_id = ? AND claim_id = ? AND assistant_client_message_id = ?)',
				input.turnId, userId, input.claimId, input.assistantClientMessageId),
			batchAssert(db, 'Turn claim lost',
				`EXISTS (SELECT 1 FROM chat_turns WHERE id = ? AND (status = 'completed' OR (status = 'running' AND claimed_until > ?)))`,
				input.turnId, now),
			...message.statements,
			db.prepare(`UPDATE chat_turns SET status = 'completed', claimed_until = NULL, updated_at = ?,
					assistant_message_id = (SELECT id FROM messages WHERE conversation_id = ? AND client_message_id = ?)
				WHERE id = ? AND status = 'running'`)
				.bind(now, turn.conversation_id, input.assistantClientMessageId, input.turnId),
			db.prepare('SELECT * FROM chat_turns WHERE id = ?').bind(input.turnId),
		])
		return decodeTurn(firstRow(results.at(-1)))
	})
}

/** `fail_chat_turn`: only the live claim's holder marks a running turn failed. */
export function failTurn(db: D1Database, userId: string, turnId: string, claimId: string, errorCode: string): Promise<ChatTurn> {
	return run(async () => {
		const now = new Date().toISOString()
		const row = await db.prepare(`UPDATE chat_turns SET status = 'failed', claimed_until = NULL, last_error = ?, updated_at = ?
				WHERE id = ? AND user_id = ? AND claim_id = ? AND status = 'running' AND claimed_until > ? RETURNING *`)
			.bind(['execution_failed', 'persistence_failed'].includes(errorCode) ? errorCode : 'execution_failed', now,
				turnId, userId, claimId, now)
			.first()
		if (!row) throw new ChatStoreError('Turn update failed')
		return decodeTurn(row)
	})
}

export function listTurns(db: D1Database, userId: string, conversationId: string): Promise<ChatTurn[]> {
	return run(async () => {
		const { results } = await db.prepare('SELECT * FROM chat_turns WHERE conversation_id = ? AND user_id = ? ORDER BY created_at, id')
			.bind(conversationId, userId).all()
		return results.map(decodeTurn)
	})
}

/** The assistant message of a turn, read through the user's own conversation. */
export function getTurnAssistantMessage(db: D1Database, userId: string, turn: ChatTurn): Promise<Message | null> {
	return run(async () => {
		if (!turn.assistant_message_id) return null
		const row = await db.prepare(`SELECT m.* FROM messages m JOIN conversations c ON c.id = m.conversation_id
				WHERE m.id = ? AND m.conversation_id = ? AND c.user_id = ?`)
			.bind(turn.assistant_message_id, turn.conversation_id, userId).first()
		return row ? decodeMessage(row) : null
	})
}

// ---------------------------------------------------------------------------------------------------------------------
// A signed-in user's conversations and messages

export function listConversations(db: D1Database, userId: string, limit: number, offset: number) {
	return run(async () => {
		const [page, total] = await db.batch([
			db.prepare(`SELECT id, title, updated_at FROM conversations WHERE user_id = ? AND deleted_at IS NULL
				ORDER BY updated_at DESC LIMIT ? OFFSET ?`).bind(userId, limit, offset),
			db.prepare('SELECT count(*) AS total FROM conversations WHERE user_id = ? AND deleted_at IS NULL').bind(userId),
		])
		const conversations = (page.results ?? []) as ConversationListItem[]
		const ids = conversations.map((conversation) => conversation.id)
		const { results: previews } = ids.length
			? await db.prepare(`SELECT conversation_id, visible_content, content, turn_index, sequence_number, role, id FROM messages
					WHERE conversation_id IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(ids)).all()
			: { results: [] }
		return { conversations, previews: previews as PreviewRow[], total: Number((firstRow(total) as { total: number }).total) }
	})
}

export type PreviewRow = {
	conversation_id: string; visible_content: string | null; content: string | null
	turn_index: number | null; sequence_number: number | null; role: MessageRole; id: string
}

/**
 * Conversations whose messages contain every word of the query, case-insensitively. Postgres used `websearch_to_tsquery`.
 * The match runs in JavaScript because SQLite's lower() folds only ASCII ("Ópera" would never match "ópera"); one user's
 * messages are a few hundred rows at most.
 */
export function searchConversations(db: D1Database, userId: string, query: string, limit: number) {
	return run(async () => {
		const words = query.toLocaleLowerCase('es').split(/\s+/).filter(Boolean).slice(0, 10)
		if (!words.length) return []
		const { results } = await db.prepare(`SELECT m.conversation_id, m.visible_content, m.content, c.title, c.updated_at
				FROM messages m JOIN conversations c ON c.id = m.conversation_id
				WHERE c.user_id = ? AND c.deleted_at IS NULL ORDER BY c.updated_at DESC, m.turn_index, m.id`)
			.bind(userId).all<{
				conversation_id: string; visible_content: string; content: string; title: string; updated_at: string
			}>()
		return results.filter((row) => {
			const text = row.visible_content.toLocaleLowerCase('es')
			return words.every((word) => text.includes(word))
		}).slice(0, limit * 2)
	})
}

export function getConversation(db: D1Database, userId: string, id: string) {
	return run(async () => {
		const [conversation, messages] = await db.batch([
			db.prepare('SELECT * FROM conversations WHERE id = ? AND user_id = ? AND deleted_at IS NULL').bind(id, userId),
			db.prepare(`SELECT m.* FROM messages m JOIN conversations c ON c.id = m.conversation_id
				WHERE m.conversation_id = ? AND c.user_id = ? AND c.deleted_at IS NULL ORDER BY m.turn_index, m.id`).bind(id, userId),
		])
		const row = firstRow(conversation)
		if (!row) return null
		return { ...decodeConversation(row), messages: (messages.results ?? []).map(decodeMessage) }
	})
}

/** Creates a conversation; a repeated id the same user already owns returns that conversation. */
export function createConversation(db: D1Database, userId: string, input: { id?: string; title?: string; metadata?: unknown }) {
	return run(async () => {
		const id = input.id ?? crypto.randomUUID()
		const row = await db.prepare(`INSERT INTO conversations (id, user_id, title, metadata) VALUES (?, ?, ?, ?)
				ON CONFLICT (id) DO NOTHING RETURNING *`)
			.bind(id, userId, input.title ?? 'New conversation', JSON.stringify(input.metadata ?? {})).first()
			?? await db.prepare('SELECT * FROM conversations WHERE id = ? AND user_id = ?').bind(id, userId).first()
		if (!row) throw new ChatStoreError('Conversation not found')
		return decodeConversation(row)
	})
}

export function updateConversation(
	db: D1Database, userId: string, id: string, updates: { title?: string; metadata?: unknown; deleted_at?: string | null },
) {
	return run(async () => {
		const row = await db.prepare(`UPDATE conversations SET
					title = coalesce(?, title),
					metadata = CASE WHEN ? THEN ? ELSE metadata END,
					deleted_at = CASE WHEN ? THEN ? ELSE deleted_at END
				WHERE id = ? AND user_id = ? RETURNING *`)
			.bind(updates.title ?? null,
				updates.metadata !== undefined ? 1 : 0, JSON.stringify(updates.metadata ?? {}),
				updates.deleted_at !== undefined ? 1 : 0, updates.deleted_at === undefined || updates.deleted_at === null
					? null : new Date(updates.deleted_at).toISOString(),
				id, userId)
			.first()
		if (!row) throw new ChatStoreError('Conversation not found')
		return decodeConversation(row)
	})
}

export function softDeleteConversation(db: D1Database, userId: string, id: string) {
	return run(async () => {
		await db.prepare('UPDATE conversations SET deleted_at = ? WHERE id = ? AND user_id = ?')
			.bind(new Date().toISOString(), id, userId).run()
	})
}

export function getMessages(db: D1Database, userId: string, conversationId: string) {
	return run(async () => {
		const { results } = await db.prepare(`SELECT m.* FROM messages m JOIN conversations c ON c.id = m.conversation_id
				WHERE m.conversation_id = ? AND c.user_id = ? ORDER BY m.turn_index, m.id`).bind(conversationId, userId).all()
		return results.map(decodeMessage)
	})
}

export function findOwnMessageId(db: D1Database, userId: string, conversationId: string, clientMessageId: string) {
	return run(() => db.prepare(`SELECT m.id FROM messages m JOIN conversations c ON c.id = m.conversation_id
			WHERE m.conversation_id = ? AND m.client_message_id = ? AND c.user_id = ?`)
		.bind(conversationId, clientMessageId, userId).first<string>('id'))
}

export function updateMessageAttachedData(db: D1Database, userId: string, messageId: string, attachedData: unknown) {
	return run(async () => {
		const row = await db.prepare(`UPDATE messages SET attached_data = ?
				WHERE id = ? AND conversation_id IN (SELECT id FROM conversations WHERE user_id = ?) RETURNING *`)
			.bind(JSON.stringify(attachedData ?? {}), messageId, userId).first()
		if (!row) throw new ChatStoreError('Message not found')
		return decodeMessage(row)
	})
}

// ---------------------------------------------------------------------------------------------------------------------
// Owner-less conversations of external channels

const EXTERNAL = 'channel = ? AND user_id IS NULL AND deleted_at IS NULL'

export function findExternalConversation(db: D1Database, channel: ExternalChannel, hash: string) {
	return run(async () => {
		const row = await db.prepare(`SELECT * FROM conversations WHERE external_identity_hash = ? AND ${EXTERNAL}`).bind(hash, channel).first()
		return row ? decodeConversation(row) : null
	})
}

export function getOrCreateExternalConversation(
	db: D1Database, channel: ExternalChannel, hash: string, title: string, metadata: Record<string, Json>,
) {
	return run(async () => {
		const existing = await findExternalConversation(db, channel, hash)
		if (existing) return existing
		await db.prepare(`INSERT INTO conversations (id, user_id, channel, external_identity_hash, title, metadata)
				VALUES (?, NULL, ?, ?, ?, ?) ON CONFLICT (channel, external_identity_hash) DO NOTHING`)
			.bind(crypto.randomUUID(), channel, hash, title, JSON.stringify(metadata)).run()
		const created = await findExternalConversation(db, channel, hash)
		if (!created) throw new ChatStoreError('Conversation not found')
		return created
	})
}

export function getExternalConversation(db: D1Database, channel: ExternalChannel, conversationId: string) {
	return run(async () => {
		const row = await db.prepare(`SELECT * FROM conversations WHERE id = ? AND ${EXTERNAL}`).bind(conversationId, channel).first()
		return row ? decodeConversation(row) : null
	})
}

/** The newest 120 messages of an external conversation. */
export function loadExternalMessages(db: D1Database, channel: ExternalChannel, conversationId: string) {
	return run(async () => {
		const { results } = await db.prepare(`SELECT m.* FROM messages m JOIN conversations c ON c.id = m.conversation_id
				WHERE m.conversation_id = ? AND c.channel = ? AND c.user_id IS NULL AND c.deleted_at IS NULL
				ORDER BY m.sequence_number DESC LIMIT 120`).bind(conversationId, channel).all()
		return results.map(decodeMessage)
	})
}

export function setExternalMetadata(db: D1Database, channel: ExternalChannel, conversationId: string, metadata: Record<string, Json>) {
	return run(async () => {
		const row = await db.prepare(`UPDATE conversations SET metadata = ? WHERE id = ? AND channel = ? AND user_id IS NULL RETURNING *`)
			.bind(JSON.stringify(metadata), conversationId, channel).first()
		if (!row) throw new ChatStoreError('Conversation not found')
		return decodeConversation(row)
	})
}

export function clearExternalMessages(db: D1Database, channel: ExternalChannel, conversationId: string) {
	return run(async () => {
		await db.prepare(`DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE id = ? AND ${EXTERNAL})`)
			.bind(conversationId, channel).run()
	})
}

export function deleteExternalConversation(db: D1Database, channel: ExternalChannel, conversationId: string) {
	return run(async () => {
		await db.prepare('DELETE FROM conversations WHERE id = ? AND channel = ? AND user_id IS NULL').bind(conversationId, channel).run()
	})
}

export function preparePurgeExternalConversations(db: D1Database, channel: ExternalChannel, cutoff: string) {
	return db.prepare('DELETE FROM conversations WHERE channel = ? AND created_at < ? RETURNING id').bind(channel, cutoff)
}
