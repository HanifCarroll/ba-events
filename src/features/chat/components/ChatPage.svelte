<script lang="ts">
	import { page } from '$app/state'
	import { goto } from '$app/navigation'
	import ChatContainer from './ChatContainer.svelte'
	import { getChatConversationId } from '#features/chat/lib/chat-navigation.ts'
	import type { ConversationWithMessages } from '#shared/lib/types.ts'
	import type { HomeEventFeed } from '#features/events/lib/home-feed.ts'

	const isMarketingLanding = $derived(page.url.pathname === '/')

	/**
	 * Shared page for the chat routes. Reads the active conversation id from the
	 * `/chat/:conversationId` URL (absent on `/`) and drives the URL when a new
	 * conversation is created, so every chat has a stable address.
	 */
	const conversationId = $derived(
		getChatConversationId(page.url.pathname, page.params.conversationId as string | undefined)
	)

	// The home route provides cached cards immediately or streams a cache miss; the
	// /chat/:id route preloads the signed-in conversation. Guests get
	// `conversation: null` from the server (their chats live in IndexedDB).
	const data = $derived(page.data as {
		happeningSoonEvents?: HomeEventFeed
		conversation?: ConversationWithMessages | null
		turns?: Array<{ id: string; status: string; content: string; user_client_message_id: string; assistant_client_message_id: string }>
	})
	const happeningSoon = $derived(data.happeningSoonEvents ?? [])
	const preloadedConversation = $derived(data.conversation ?? null)
	const turns = $derived(data.turns ?? [])

	async function handleConversationChange(id: string): Promise<void> {
		await goto(`/chat/${encodeURIComponent(id)}`)
	}
</script>

<div class="h-full flex flex-col">
	<ChatContainer
		conversationId={conversationId}
		happeningSoonEvents={happeningSoon}
		preloadedConversation={preloadedConversation}
		pendingTurns={turns}
		showLanding={isMarketingLanding}
		onConversationChange={handleConversationChange}
	/>
</div>
