<script lang="ts">
	import { onMount } from 'svelte'
	import { page } from '$app/state'
	import { goto } from '$app/navigation'
	import ChatContainer from './ChatContainer.svelte'
	import { getChatConversationId } from '#features/chat/lib/chat-navigation.ts'
	import type { ChatEventPayload, ConversationWithMessages } from '#shared/lib/types.ts'

	const isMarketingLanding = $derived(page.url.pathname === '/')

	/**
	 * Shared page for the chat routes. Reads the active conversation id from the
	 * `/chat/:conversationId` URL (absent on `/`) and drives the URL when a new
	 * conversation is created, so every chat has a stable address.
	 */
	const conversationId = $derived(
		getChatConversationId(page.url.pathname, page.params.conversationId as string | undefined)
	)

	// The home route loads happening-soon events after first paint; the
	// /chat/:id route preloads the signed-in conversation. Guests get
	// `conversation: null` from the server (their chats live in IndexedDB).
	const data = $derived(page.data as {
		conversation?: ConversationWithMessages | null
		turns?: Array<{ id: string; status: string; content: string; user_client_message_id: string; assistant_client_message_id: string }>
	})
	let happeningSoonEvents = $state.raw<ChatEventPayload[]>([])
	const happeningSoon = $derived(happeningSoonEvents)
	const preloadedConversation = $derived(data.conversation ?? null)
	const turns = $derived(data.turns ?? [])

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

	async function handleConversationChange(id: string, options?: { replace?: boolean }) {
		await goto(`/chat/${encodeURIComponent(id)}`, { replaceState: options?.replace ?? false })
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
