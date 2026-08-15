<script lang="ts">
	import { Sparkles } from 'lucide-svelte'
	import { marked } from 'marked'
	import DOMPurify from 'dompurify'
	import { browser } from '$app/env'
	import { cn } from '#shared/lib/utils/index.ts'
	import { getLocale } from '#paraglide/runtime.js'
	import type { ChatMessage as ChatMessageType } from '#shared/lib/types.ts'
	import EventList from '#features/events/components/EventList.svelte'
	import RefinementSuggestions from './RefinementSuggestions.svelte'
	import DirectionsCard from './DirectionsCard.svelte'

	let {
		message,
		onSuggestionSelect,
		suggestionsDisabled = false,
		isLast = false
	}: {
		message: ChatMessageType
		onSuggestionSelect?: (prompt: string) => void
		suggestionsDisabled?: boolean
		isLast?: boolean
	} = $props()

	const isUser = $derived(message.role === 'user')
	const hasContent = $derived(message.content.trim().length > 0)
	const hasReasoning = $derived((message.reasoning ?? '').trim().length > 0)
	const events = $derived(message.events ?? [])
	const suggestions = $derived(message.suggestions ?? [])
	const directions = $derived(message.directions ?? null)
	// react-markdown → marked + DOMPurify (client-side only). The legacy
	// react-markdown escaped raw HTML; DOMPurify sanitizes it the same way.
	const renderedContent = $derived(
		browser ? DOMPurify.sanitize(marked.parse(message.content) as string) : ''
	)

	const timestamp = $derived(
		message.timestamp.toLocaleTimeString(getLocale(), {
			hour: '2-digit',
			minute: '2-digit'
		})
	)
</script>

<!--
	Don't render empty assistant messages that are still streaming (waiting for
	tool results). The loading indicator in MessageList handles this state.
-->
{#if isUser || hasContent || hasReasoning || events.length > 0 || directions || !message.isStreaming}
	<div
		data-message-id={message.id}
		class={cn(
			'flex w-full animate-fade-in-up',
			isLast ? 'mb-3 sm:mb-8' : 'mb-8',
			isUser ? 'justify-end' : 'justify-start'
		)}
	>
		{#if !isUser}
			<div
				class="mr-3 mt-1 hidden sm:flex h-7 w-7 shrink-0 items-center justify-center text-accent"
			>
				<Sparkles class="h-5 w-5" aria-hidden="true" />
			</div>
		{/if}
		<div
			class={cn(
				isUser ? 'max-w-[88%] sm:max-w-[52%]' : 'min-w-0 max-w-full flex-1',
				'order-1'
			)}
		>
			<!-- Only render the text bubble if there's content -->
			{#if !isUser && hasReasoning}
				<p class="mb-3 max-w-[68ch] text-[13px] leading-relaxed text-muted-foreground whitespace-pre-wrap">
					{message.reasoning}
				</p>
			{/if}
			{#if hasContent}
				<div
					class={cn(
						'text-[15px] leading-relaxed',
						isUser
							? 'rounded-xl bg-muted px-4 py-3 text-foreground'
							: 'px-0 py-0 text-foreground'
					)}
				>
					{#if isUser}
						<p class="text-sm whitespace-pre-wrap leading-relaxed">{message.content}</p>
					{:else if browser}
						<div
							class="prose prose-sm prose-warm max-w-[68ch] leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:my-1.5 [&_ul]:my-2 [&_ol]:my-2 [&_strong]:text-foreground [&_strong]:font-semibold"
						>
							<!-- eslint-disable-next-line svelte/no-at-html-tags -- marked output sanitized with DOMPurify (legacy react-markdown escaped raw HTML the same way) -->
							{@html renderedContent}
						</div>
					{:else}
						<div class="prose prose-sm prose-warm max-w-[68ch] leading-relaxed">
							{message.content}
						</div>
					{/if}
				</div>
			{/if}

			<!-- Event results for assistant messages -->
			{#if !isUser && events.length > 0}
				<div class={hasContent ? 'mt-4' : ''}>
					<EventList events={events} />
				</div>
			{/if}

			<!-- Directions card for assistant messages -->
			{#if !isUser && directions}
				<div class={hasContent || events.length > 0 ? 'mt-4' : ''}>
					<DirectionsCard directions={directions} />
				</div>
			{/if}

			<!-- Refinement suggestions - show after events when not streaming -->
			{#if !isUser && suggestions.length > 0 && !message.isStreaming && onSuggestionSelect}
				<RefinementSuggestions
					suggestions={suggestions}
					onSelect={onSuggestionSelect}
					disabled={suggestionsDisabled}
				/>
			{/if}

			<!-- Timestamp - only show when there's content or message is complete -->
			{#if hasContent || events.length > 0 || directions || !message.isStreaming}
				<p
					class={cn(
						'text-[11px] text-muted-foreground mt-2',
						isUser ? 'text-right pr-1' : 'text-left pl-1'
					)}
				>
					{timestamp}
				</p>
			{/if}
		</div>
	</div>
{/if}
