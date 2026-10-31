<script lang="ts">
	import { page } from '$app/state'
	import { useMachine } from '@xstate/svelte'
	import { createConversationHistoryMachine } from '../lib/conversation-history.machine.ts'
	import { MessageCircle } from 'lucide-svelte'
	import * as m from '#paraglide/messages.js'
	import { useAuthContext } from '#features/auth/hooks/auth-context.svelte.ts'
	import { chatState } from '#features/chat/state/chat.svelte.ts'

	let { collapsed }: { collapsed: boolean } = $props()

	const auth = useAuthContext()
	const conversationId = $derived((page.params.conversationId as string | undefined) ?? null)

	const { snapshot, send } = useMachine(createConversationHistoryMachine(() => chatState.listConversations({ limit: 50 })))
	const conversations = $derived($snapshot.context.userId === auth.user?.id ? $snapshot.context.conversations : [])
	$effect(() => { send({ type: 'SYNC', userId: auth.user?.id ?? null, version: chatState.conversationsVersion }) })
</script>

{#if auth.user && (conversations.length > 0 || $snapshot.matches('loading') || $snapshot.matches('failed'))}
	<div class="flex flex-col gap-1 mt-3 pt-3 border-t border-border/50" aria-busy={$snapshot.matches('loading')}>
		<div
			class="px-3 py-1 transition-all duration-300 {collapsed
				? 'opacity-0 h-0 overflow-hidden'
				: 'opacity-100'}"
		>
			<span class="text-xs text-muted-foreground uppercase tracking-wider font-medium">
				{m.chat_history()}
			</span>
		</div>
		{#if $snapshot.matches('failed')}
			<button class="px-3 py-2 text-sm text-muted-foreground" onclick={() => send({ type: 'RETRY' })} title={m.chat_history_error()}>
				{#if !collapsed}{m.chat_history_error()} — {/if}{m.chat_retry()}
			</button>
		{:else if $snapshot.matches('loading') && conversations.length === 0 && !collapsed}
			<p class="px-3 py-2 text-xs text-muted-foreground" role="status">{m.chat_history_loading()}</p>
		{/if}

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
