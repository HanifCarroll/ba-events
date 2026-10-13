<script lang="ts">
	import { Sparkles, CheckCircle2, XCircle } from 'lucide-svelte'
	import { marked } from 'marked'
	import DOMPurify from 'dompurify'
	import { browser } from '$app/env'
	import { cn } from '#shared/lib/utils/index.ts'
	import { getLocale } from '#paraglide/runtime.js'
	import type { ChatMessage as ChatMessageType } from '#shared/lib/types.ts'
	import EventList from '#features/events/components/EventList.svelte'
	import RefinementSuggestions from './RefinementSuggestions.svelte'
	import DirectionsCard from './DirectionsCard.svelte'
	import VenueDetailsCard from './VenueDetailsCard.svelte'
	import ResponseFeedback from './ResponseFeedback.svelte'

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
	const events = $derived(message.events ?? [])
	const suggestions = $derived(message.suggestions ?? [])
	const directions = $derived(message.directions ?? null)
	const venue = $derived(message.venue ?? null)
	const operations = $derived(message.operations ?? [])
	const recommendationNextStep = $derived(message.recommendationNextStep ?? null)
	// Render only the fixed-template clarification labels NOT already present in
	// content. New v4 clarification text includes the labels as its single text
	// block; older v4 generic-text records keep them in this separate list.
	const clarificationQuestions = $derived(
		(message.clarificationQuestions ?? []).filter((q) => !message.content.includes(q.label))
	)
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
{#if isUser || hasContent || events.length > 0 || directions || venue || operations.length > 0 || clarificationQuestions.length > 0 || !message.isStreaming}
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
					<EventList events={events} responseId={message.responseFeedback?.responseId} />
				</div>
			{/if}

			{#if !isUser && recommendationNextStep}
				<p class="mt-4 max-w-[68ch] text-[15px] leading-relaxed text-foreground">
					{recommendationNextStep}
				</p>
			{/if}

			<!-- Directions card for assistant messages -->
			{#if !isUser && directions}
				<div class={hasContent || events.length > 0 ? 'mt-4' : ''}>
					<DirectionsCard directions={directions} />
				</div>
			{/if}

			<!-- Venue details card for assistant messages -->
			{#if !isUser && venue}
				<div class={hasContent || events.length > 0 || directions ? 'mt-4' : ''}>
					<VenueDetailsCard {venue} />
				</div>
			{/if}

			<!-- Normalized mutation receipts — visible even when prose is generic -->
			{#if !isUser && operations.length > 0}
				<ul class={hasContent || events.length > 0 || directions || venue ? 'mt-3 space-y-1' : ''}>
					{#each operations as op (op.toolCallId)}
						<li class="flex items-start gap-2 text-sm text-muted-foreground">
							<span class="mt-0.5 shrink-0">
								{#if op.outcome === 'applied' || op.outcome === 'already_applied'}
									<CheckCircle2 class="h-4 w-4 text-accent" />
								{:else}
									<XCircle class="h-4 w-4 text-destructive" />
								{/if}
							</span>
							<span>{op.message}</span>
						</li>
					{/each}
				</ul>
			{/if}

			<!-- Fixed-template clarification questions (labels already localized server-side) -->
			{#if !isUser && clarificationQuestions.length > 0}
				<ul class={hasContent || events.length > 0 || directions || venue || operations.length > 0 ? 'mt-3 space-y-1' : ''}>
					{#each clarificationQuestions as question (question.key)}
						<li class="text-sm text-muted-foreground">{question.label}</li>
					{/each}
				</ul>
			{/if}

			<!-- Refinement suggestions - show after events when not streaming -->
			{#if !isUser && suggestions.length > 0 && !message.isStreaming && onSuggestionSelect}
				<RefinementSuggestions
					suggestions={suggestions}
					onSelect={onSuggestionSelect}
					disabled={suggestionsDisabled}
				/>
			{/if}

			{#if !isUser && !message.isStreaming && message.responseFeedback}
				{#key message.responseFeedback.responseId}
					<ResponseFeedback context={message.responseFeedback} />
				{/key}
			{/if}

			<!-- Timestamp - only show when there's content or message is complete -->
			{#if hasContent || events.length > 0 || directions || venue || operations.length > 0 || clarificationQuestions.length > 0 || !message.isStreaming}
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
