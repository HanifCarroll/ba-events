import { command, query, getRequestEvent } from '$app/server'
import { Effect, Schema } from 'effect'
import * as conversations from '#features/chat/api/conversations.server.ts'
import type { ConversationInsert, ConversationUpdate } from '#shared/lib/types.ts'

// Remote wrappers for the chat conversation server functions (CONTRACTS.md §5).
// The legacy React Query `useConversations` hooks are replaced by these
// type-safe server calls, consumed from `#features/chat/state/chat.svelte.ts`.

const conversationInsertInput = Schema.toStandardSchemaV1(Schema.Struct({
	id: Schema.optional(Schema.String),
	user_id: Schema.optional(Schema.NullOr(Schema.String)),
	channel: Schema.optional(Schema.Literals(['web', 'telegram'])),
	external_identity_hash: Schema.optional(Schema.NullOr(Schema.String)),
	title: Schema.optional(Schema.String),
	metadata: Schema.optional(Schema.Any),
}))
const conversationUpdateInput = Schema.toStandardSchemaV1(Schema.Struct({
	id: Schema.String,
	updates: Schema.Struct({
		id: Schema.optional(Schema.String),
		title: Schema.optional(Schema.String),
		metadata: Schema.optional(Schema.Any),
		deleted_at: Schema.optional(Schema.NullOr(Schema.String)),
	}),
}))
const listInput = Schema.toStandardSchemaV1(Schema.Struct({
	limit: Schema.optional(Schema.Int),
	offset: Schema.optional(Schema.Int),
}))
const searchInput = Schema.toStandardSchemaV1(Schema.Struct({
	query: Schema.String,
	limit: Schema.optional(Schema.Int),
}))
const idInput = Schema.toStandardSchemaV1(Schema.Struct({ id: Schema.String }))

export const listConversations = query(
	listInput,
	async (params: { limit?: number; offset?: number } = {}) =>
		Effect.runPromise(conversations.listConversationsEffect(getRequestEvent(), params))
)

export const searchConversations = query(
	searchInput,
	async (params: { query: string; limit?: number }) =>
		Effect.runPromise(conversations.searchConversationsEffect(getRequestEvent(), params))
)

export const getConversation = query(idInput, async (params: { id: string }) =>
	Effect.runPromise(conversations.getConversationEffect(getRequestEvent(), params))
)

export const createConversation = command(
	conversationInsertInput,
	async (data) => Effect.runPromise(conversations.createConversationEffect(getRequestEvent(), data as ConversationInsert))
)

export const updateConversation = command(
	conversationUpdateInput,
	async (data) => Effect.runPromise(conversations.updateConversationEffect(getRequestEvent(), data as { id: string; updates: ConversationUpdate }))
)

export const deleteConversation = command(idInput, async (data: { id: string }) =>
	Effect.runPromise(conversations.deleteConversationEffect(getRequestEvent(), data))
)
