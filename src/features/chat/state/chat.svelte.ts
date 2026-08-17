/**
 * Shared chat state — the Svelte port of `ChatProvider.tsx` plus the
 * conversation persistence branching that lived in `useConversations.ts`.
 *
 * The provider semantics are unchanged: the first-message handoff (`peek` is
 * idempotent, `take` is one-shot) and per-conversation scroll memory survive
 * the `/chat/:id` remount because they live here, in a module singleton,
 * instead of in a component that unmounts on navigation.
 */

import { getAuthState } from '#features/auth/hooks/auth-context.svelte.ts'
import { getFallbackConversationTitle } from '#features/chat/lib/title.ts'
import { getGuestConversationWithMessages } from '#shared/lib/db/guest-conversations.ts'
import type { GuestConversationWithMessages } from '#shared/lib/db/guest-conversations.ts'
import * as conversationsRemote from '#features/chat/api/conversations.remote.ts'
import * as messagesRemote from '#features/chat/api/messages.remote.ts'
import type { AddMessageInput } from '#features/chat/api/messages.remote.ts'
import * as generateTitleRemote from '#features/chat/api/generate-title.remote.ts'
import type {
	ConversationListItem,
	ConversationWithMessages,
	Message,
	MessageAttachedData
} from '#shared/lib/types.ts'
import { HandoffState } from './handoff-state.ts'
export type { PendingFirstMessage } from './handoff-state.ts'

export class ChatState extends HandoffState {
	/**
	 * ID of the currently active conversation (null = new conversation not yet
	 * created). Kept in sync with the `/chat/:conversationId` URL by
	 * ChatContainer; reactive so the sidebar highlight follows the URL.
	 */
	activeConversationId = $state<string | null>(null)

	/**
	 * Bumped after any conversation mutation (create/rename/delete/message/
	 * title) so the signed-in history list re-fetches. Replaces the legacy
	 * React Query `invalidateQueries({ queryKey: conversations.all })`.
	 */
	conversationsVersion = $state(0)

	#startNewChatHandler: (() => void) | null = null
	// Synchronous bootstrap for a freshly-created guest conversation. Replaces
	// the legacy React Query `setQueryData(guestDetail(id), …)` seed: the
	// remounted /chat/:id instance resolves the conversation instantly, with no
	// IndexedDB read on the critical path and no full-pane loading spinner.
	#seededGuestConversations = new Map<string, GuestConversationWithMessages>()

	/** Register the handler called when `startNewChat` is invoked. */
	registerStartNewChatHandler(handler: () => void): void {
		this.#startNewChatHandler = handler
	}

	/** Start a new chat session — clears messages and resets state. */
	startNewChat(): void {
		this.activeConversationId = null
		this.#startNewChatHandler?.()
	}

	setActiveConversationId(id: string | null): void {
		this.activeConversationId = id
	}

	// ==========================================================================
	// Conversation persistence (absorbed from the legacy `useConversations`).
	// Guest vs authenticated branching matches the legacy hooks exactly.
	// ==========================================================================

	private get isAuthenticated(): boolean {
		return !!getAuthState().user
	}

	/**
	 * List conversations for the current user. Guests return an empty list.
	 */
	async listConversations(options?: {
		limit?: number
		offset?: number
	}): Promise<{ conversations: ConversationListItem[]; total: number }> {
		if (!this.isAuthenticated) return { conversations: [], total: 0 }
		return conversationsRemote.listConversations(options ?? {})
	}

	/** Search conversations by content (authenticated only). */
	async searchConversations(query: string): Promise<ConversationListItem[]> {
		if (!query.trim()) return []
		if (!this.isAuthenticated) return []
		return conversationsRemote.searchConversations({ query })
	}

	/** Get a single conversation with all its messages (authenticated only). */
	async getConversation(id: string | null): Promise<ConversationWithMessages | null> {
		if (!id || !this.isAuthenticated) return null
		const result = await conversationsRemote.getConversation({ id })
		return result as ConversationWithMessages | null
	}

	/**
	 * Seed a freshly-created guest conversation synchronously (before the
	 * fire-and-forget IndexedDB write resolves) so the remounted instance
	 * renders it immediately.
	 */
	seedGuestConversation(id: string, conversation: GuestConversationWithMessages): void {
		this.#seededGuestConversations.set(id, conversation)
	}

	/** Drop the seed so a later read hits IndexedDB (which now has messages). */
	invalidateGuestConversation(id: string): void {
		this.#seededGuestConversations.delete(id)
	}

	/**
	 * Read a guest conversation (with messages) from the seed or IndexedDB.
	 * Fails safe: a read error (private mode, storage disabled) returns null
	 * instead of throwing, so the chat UI never blocks on a persistence layer
	 * the conversation can still run without.
	 */
	async getGuestConversation(id: string | null): Promise<GuestConversationWithMessages | null> {
		if (!id) return null
		const seeded = this.#seededGuestConversations.get(id)
		if (seeded) return seeded
		try {
			return await getGuestConversationWithMessages(id)
		} catch (readError) {
			console.error('[chat] Failed to read guest conversation from IndexedDB:', readError)
			return null
		}
	}

	/** Create a new (authenticated) conversation. */
	async createConversation(): Promise<{ id: string }> {
		if (!this.isAuthenticated) throw new Error('Not authenticated')
		const conversation = await conversationsRemote.createConversation({})
		this.#bumpConversations()
		return conversation
	}

	/** Rename a conversation. */
	async updateConversation(data: { id: string; title: string }): Promise<void> {
		if (!this.isAuthenticated) throw new Error('Not authenticated')
		await conversationsRemote.updateConversation({ id: data.id, updates: { title: data.title } })
		this.#bumpConversations()
	}

	/** Delete a conversation. */
	async deleteConversation(id: string): Promise<void> {
		if (!this.isAuthenticated) throw new Error('Not authenticated')
		await conversationsRemote.deleteConversation({ id })
		this.#bumpConversations()
	}

	/** Add a message to a conversation (authenticated only). */
	async addMessage(data: AddMessageInput): Promise<Message> {
		if (!this.isAuthenticated) throw new Error('Not authenticated')
		const saved = await messagesRemote.addMessage(data)
		this.#bumpConversations()
		return saved
	}

	/** Update a message's attached data (authenticated only). */
	async updateMessageAttachedData(data: {
		messageId: string
		attachedData: MessageAttachedData
	}): Promise<void> {
		if (!this.isAuthenticated) throw new Error('Not authenticated')
		await messagesRemote.updateMessageAttachedData(data)
	}

	/**
	 * Generate a conversation title from the first message. Guests fall back to
	 * the local title (their conversations are ephemeral, so no server write).
	 */
	async generateTitle(data: {
		conversationId: string
		firstMessage: string
	}): Promise<{ title: string }> {
		if (!this.isAuthenticated) {
			return { title: getFallbackConversationTitle(data.firstMessage) }
		}
		const result = await generateTitleRemote.generateAndSaveTitle(data)
		this.#bumpConversations()
		return result
	}

	#bumpConversations(): void {
		this.conversationsVersion++
	}
}

/** Module singleton — survives navigation, like the legacy ChatProvider. */
export const chatState = new ChatState()

export function getChatState(): ChatState {
	return chatState
}
