<script lang="ts">
	import { onMount } from 'svelte'
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

	// The home route loads happening-soon events after first paint; the
	// /chat/:id route preloads the signed-in conversation. Guests get
	// `conversation: null` from the server (their chats live in IndexedDB).
	const data = $derived(page.data as {
		conversation?: ConversationWithMessages | null
	})
	let happeningSoonEvents = $state.raw<ChatEventPayload[]>([])
	const happeningSoon = $derived(happeningSoonEvents)
	const preloadedConversation = $derived(data.conversation ?? null)

	onMount(() => {
		if (!isMarketingLanding) return

		const frame = requestAnimationFrame(() => {
			void fetch('/api/events/happening-soon')
				.then((response) => (response.ok ? response.json() : null))
				.then((payload: { success?: boolean; data?: ChatEventPayload[] } | null) => {
					if (payload?.success && Array.isArray(payload.data)) happeningSoonEvents = payload.data
				})
				.catch(() => {})
		})

		return () => cancelAnimationFrame(frame)
	})

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
