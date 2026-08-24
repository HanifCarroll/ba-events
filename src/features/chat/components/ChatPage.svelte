<script lang="ts">
	import { page } from '$app/state'
	import { pushState, replaceState } from '$app/navigation'
	import ChatContainer from './ChatContainer.svelte'
	import { getChatConversationId, getChatHandoffNavigation } from '#features/chat/lib/chat-navigation.ts'
	import type { ChatEventPayload, ConversationWithMessages } from '#shared/lib/types.ts'

	const isMarketingLanding = $derived(page.url.pathname === '/')

	/**
	 * Shared page for the chat routes. Reads the active conversation id from the
	 * `/chat/:conversationId` URL (absent on `/`) and drives the URL when a new
	 * conversation is created, so every chat has a stable address.
	 */
	const conversationId = $derived(
		getChatConversationId(
			page.url.pathname,
			page.params.conversationId as string | undefined,
			page.state.chatConversationId
		)
	)

	// The home route prefetches happening-soon events; the /chat/:id route
	// prefetches the signed-in conversation. Guests get `conversation: null`
	// from the server (their chats live in IndexedDB and are read client-side).
	const data = $derived(page.data as {
		happeningSoon?: ChatEventPayload[]
		conversation?: ConversationWithMessages | null
	})
	const happeningSoon = $derived(data.happeningSoon)
	const preloadedConversation = $derived(data.conversation ?? null)

	function handleConversationChange(id: string, options?: { replace?: boolean }) {
		const navigation = getChatHandoffNavigation(id, page.state)
		const navigate = options?.replace ? replaceState : pushState
		navigate(navigation.url, navigation.state)
	}
</script>

<div class="h-full flex flex-col">
	<ChatContainer
		conversationId={conversationId}
		happeningSoonEvents={happeningSoon}
		preloadedConversation={preloadedConversation}
		showLanding={isMarketingLanding}
		onConversationChange={handleConversationChange}
	/>
</div>
