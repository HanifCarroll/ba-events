import { command, query, getRequestEvent } from '$app/server'
import * as conversations from '#features/chat/api/conversations.server.ts'
import type { ConversationInsert, ConversationUpdate } from '#shared/lib/types.ts'

// Remote wrappers for the chat conversation server functions (CONTRACTS.md §5).
// The legacy React Query `useConversations` hooks are replaced by these
// type-safe server calls, consumed from `#features/chat/state/chat.svelte.ts`.

export const listConversations = query(
	'unchecked',
	async (params: { limit?: number; offset?: number } = {}) =>
		conversations.listConversations(getRequestEvent(), params)
)

export const searchConversations = query(
	'unchecked',
	async (params: { query: string; limit?: number }) =>
		conversations.searchConversations(getRequestEvent(), params)
)

export const getConversation = query('unchecked', async (params: { id: string }) =>
	conversations.getConversation(getRequestEvent(), params)
)

export const createConversation = command(
	'unchecked',
	async (data: ConversationInsert) => conversations.createConversation(getRequestEvent(), data)
)

export const updateConversation = command(
	'unchecked',
	async (data: { id: string; updates: ConversationUpdate }) =>
		conversations.updateConversation(getRequestEvent(), data)
)

export const deleteConversation = command('unchecked', async (data: { id: string }) =>
	conversations.deleteConversation(getRequestEvent(), data)
)
