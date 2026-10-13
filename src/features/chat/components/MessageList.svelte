<script lang="ts">
	import { untrack } from 'svelte'
	import { Sparkles } from 'lucide-svelte'
	import ChatMessage from './ChatMessage.svelte'
	import type { ChatMessage as ChatMessageType } from '#shared/lib/types.ts'
	import * as m from '#paraglide/messages.js'
	import {
		scrollAssistantToTop,
		updateAssistantTopScroll,
		type AssistantTopScrollState
	} from './message-scroll.ts'

	type LoadingPhase =
		| 'idle'
		| 'preparing'
		| 'thinking'
		| 'persisting'
		| 'error'

	let {
		messages,
		isLoading = false,
		loadingPhase = 'idle' as LoadingPhase,
		loadingLabel = undefined as string | undefined,
		onSuggestionSelect = undefined as ((prompt: string) => void) | undefined
	}: {
		messages: ChatMessageType[]
		isLoading?: boolean
		loadingPhase?: LoadingPhase
		loadingLabel?: string
		onSuggestionSelect?: (prompt: string) => void
	} = $props()

	let bottomRef = $state<HTMLDivElement | null>(null)
	let containerRef = $state<HTMLDivElement | null>(null)

	// Refs (never rendered): plain state that persists across effect runs.
	let isUserScrolling = false
	let prevMessageCount = untrack(() => messages.length)
	let prevIsLoading = false
	let assistantTopScrollState: AssistantTopScrollState = {
		pendingScrollAssistantId: null,
		prevLastAssistantId: null
	}

	function scrollToBottom(force = false) {
		if (!bottomRef) return
		if (!force && isUserScrolling) return

		// Use 'instant' on mobile to avoid smooth scroll fighting with touch gestures
		const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0
		bottomRef.scrollIntoView({
			behavior: isTouchDevice ? 'instant' : 'smooth',
			block: 'end'
		})
	}

	// Track when user is manually scrolling to avoid fighting with auto-scroll.
	$effect(() => {
		const container = containerRef?.parentElement
		if (!container) return

		let scrollTimeout: ReturnType<typeof setTimeout>

		const handleScroll = () => {
			isUserScrolling = true
			clearTimeout(scrollTimeout)
			// Reset after scroll settles (500ms matches smooth scroll duration)
			scrollTimeout = setTimeout(() => {
				isUserScrolling = false
			}, 500)
		}

		container.addEventListener('scroll', handleScroll, { passive: true })
		return () => {
			container.removeEventListener('scroll', handleScroll)
			clearTimeout(scrollTimeout)
		}
	})

	// Auto-scroll only when a NEW message is added (not during streaming updates).
	$effect(() => {
		const messageCount = messages.length

		if (messageCount > prevMessageCount) {
			scrollToBottom()
		}

		prevMessageCount = messageCount
	})

	// Auto-scroll when loading indicator first appears so "Thinking..." stays visible.
	$effect(() => {
		if (isLoading && !prevIsLoading) {
			scrollToBottom(true)
		}

		prevIsLoading = isLoading
	})

	// When the in-flight request completes, align the top of the finished
	// assistant response with the top of the viewport (plus a little padding).
	$effect(() => {
		const lastAssistant =
			[...messages].reverse().find((message) => message.role === 'assistant') ?? null
		const { state, scrollToAssistantId } = updateAssistantTopScroll(
			assistantTopScrollState,
			isLoading,
			lastAssistant?.id ?? null
		)
		assistantTopScrollState = state

		if (!scrollToAssistantId || isUserScrolling) return

		const container = containerRef?.parentElement
		const messageEl = containerRef?.querySelector(`[data-message-id="${scrollToAssistantId}"]`)
		if (!container || !(messageEl instanceof HTMLElement)) return

		scrollAssistantToTop(container, messageEl)
	})
</script>

<div bind:this={containerRef} class="px-4 pt-8 pb-4 sm:px-8 sm:py-12 lg:py-16">
	<div
		class="max-w-[860px] mx-auto"
		role="log"
		aria-live="polite"
		aria-label={m.chat_messages_label()}
	>
		{#each messages as message, index (message.id)}
			<ChatMessage
				{message}
				onSuggestionSelect={onSuggestionSelect}
				suggestionsDisabled={isLoading}
				isLast={!isLoading && index === messages.length - 1}
			/>
		{/each}

		<!-- Loading indicator -->
		{#if isLoading}
			<div class="flex justify-start mb-6 animate-fade-in-up pl-0 sm:pl-10">
				<div class="px-3 py-2">
					<div class="flex items-center gap-3 text-muted-foreground">
						<Sparkles class="h-4 w-4 text-accent animate-pulse-warm" />
						<span class="text-sm tracking-wide" data-phase={loadingPhase}>
							{loadingLabel ?? m.chat_thinking()}
						</span>
						<span class="flex gap-1">
							<span
								class="w-1 h-1 bg-primary/60 rounded-full animate-pulse"
								style="animation-delay: 0ms"
							></span>
							<span
								class="w-1 h-1 bg-primary/60 rounded-full animate-pulse"
								style="animation-delay: 150ms"
							></span>
							<span
								class="w-1 h-1 bg-primary/60 rounded-full animate-pulse"
								style="animation-delay: 300ms"
							></span>
						</span>
					</div>
				</div>
			</div>
		{/if}

		<!-- Scroll anchor -->
		<div bind:this={bottomRef}></div>
	</div>
</div>
