<script lang="ts">
	import { page } from '$app/state'
	import { MessageCircle } from 'lucide-svelte'
	import * as m from '#paraglide/messages.js'
	import { useAuthContext } from '#features/auth/hooks/auth-context.svelte.ts'
	import { chatState } from '#features/chat/state/chat.svelte.ts'
	import type { ConversationListItem } from '#shared/lib/types.ts'

	let { collapsed }: { collapsed: boolean } = $props()

	const auth = useAuthContext()
	const conversationId = $derived((page.params.conversationId as string | undefined) ?? null)

	let conversations = $state<ConversationListItem[]>([])

	$effect(() => {
		if (!auth.user) {
			conversations = []
			return
		}

		// Re-run after any conversation mutation (create/rename/delete/message/
		// title) so the signed-in history list stays fresh — replaces the legacy
		// React Query `invalidateQueries({ queryKey: conversations.all })`.
		chatState.conversationsVersion

		let cancelled = false
		chatState.listConversations({ limit: 50 }).then((result) => {
			if (!cancelled) conversations = result.conversations
		})

		return () => {
			cancelled = true
		}
	})
</script>

{#if conversations.length > 0}
	<div class="flex flex-col gap-1 mt-3 pt-3 border-t border-border/50">
		<div
			class="px-3 py-1 transition-all duration-300 {collapsed
				? 'opacity-0 h-0 overflow-hidden'
				: 'opacity-100'}"
		>
			<span class="text-xs text-muted-foreground uppercase tracking-wider font-medium">
				{m.chat_history()}
			</span>
		</div>
		{#each conversations as conversation (conversation.id)}
			{@const active = conversation.id === conversationId}
			<a
				href="/chat/{conversation.id}"
				title={conversation.title || undefined}
				class="group flex items-center gap-2.5 rounded-lg px-3.5 py-2 min-h-9 transition-colors duration-200 {active
					? 'bg-primary/[0.07] text-primary'
					: 'text-foreground/60 hover:text-foreground hover:bg-muted'} {collapsed
					? 'lg:px-3 lg:justify-center'
					: ''}"
			>
				<MessageCircle class="h-4 w-4 shrink-0" />
				{#if !collapsed}
					<span class="font-medium truncate text-sm">
						{conversation.title || m.chat_untitled()}
					</span>
				{/if}
			</a>
		{/each}
	</div>
{/if}
