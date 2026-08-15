<script lang="ts">
	import { Calendar, MapPin, Clock } from 'lucide-svelte'
	import * as m from '#paraglide/messages.js'
	import { formatPrice } from '#features/chat/lib/messages.ts'
	import { formatShortDate, formatTime } from '#shared/lib/utils/formatting.ts'
	import { track } from '#shared/lib/analytics.ts'
	import type { ChatEventPayload } from '#shared/lib/types.ts'

	let {
		onSelectPrompt,
		initialEvents = []
	}: {
		/** @param options.eventId exact event tapped — sent server-side, hidden from chat text */
		onSelectPrompt: (prompt: string, options?: { eventId?: string }) => void
		/** Prefetched events from the route loader. */
		initialEvents?: ChatEventPayload[]
	} = $props()

	// The legacy TanStack Query refetch (staleTime 5m) had no user-visible
	// trigger on the home screen, so the prefetched route-loader data is the
	// only source (see U4 evidence). Slice to the compact sample of four.
	const displayedEvents = $derived(initialEvents.slice(0, 4))
</script>

{#if displayedEvents.length === 0}
	<!-- Hidden entirely when there are no events to show (legacy behavior). -->
{:else}
	<section class="border-t border-border/60 pt-3" aria-label={m.home_happening_soon_title()}>
		<div class="mb-2.5 flex items-baseline justify-between gap-3">
			<h2 class="text-sm font-medium text-foreground">{m.home_happening_soon_title()}</h2>
			<p class="text-right text-xs text-muted-foreground">{m.home_happening_soon_hint()}</p>
		</div>

		<div
			data-horizontal-scroll
			class="flex touch-pan-x gap-2.5 overflow-x-auto overscroll-contain pb-1 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:grid sm:touch-auto sm:grid-cols-4 sm:gap-3 sm:overflow-visible sm:overscroll-auto sm:pb-0 stagger-children"
		>
			{#each displayedEvents as event (event.id)}
				{@const startDate = new Date(event.starts_at)}
				{@const dateStr = formatShortDate(startDate)}
				{@const timeStr = event.time_tba ? m.concierge_time_tba() : formatTime(startDate)}
				{@const showPrice = event.is_free || event.price !== null}
				<button
					type="button"
					onclick={() => {
						track('home:happening_soon_clicked', {
							event_id: event.id,
							event_name: event.name
						})
						onSelectPrompt(m.home_happening_soon_prompt({ name: event.name }), { eventId: event.id })
					}}
					aria-label={m.home_happening_soon_prompt({ name: event.name })}
					class="group flex w-[58%] max-w-[220px] shrink-0 flex-col overflow-hidden rounded-xl border border-border/50 bg-card text-left transition-colors hover:border-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-auto sm:max-w-none"
				>
					{#if event.image_url}
						<img
							src={event.image_url}
							alt=""
							loading="lazy"
							class="h-16 w-full object-cover sm:h-20"
						/>
					{:else}
						<div
							class="flex h-16 items-center justify-center bg-muted text-muted-foreground/60 sm:h-20"
						>
							<Calendar class="h-6 w-6" aria-hidden="true" />
						</div>
					{/if}
					<div class="p-2.5">
						<p
							class="line-clamp-1 text-sm font-medium text-foreground transition-colors group-hover:text-primary"
						>
							{event.name}
						</p>
						<p class="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
							<MapPin class="h-3 w-3 shrink-0 text-primary/60" aria-hidden="true" />
							<span class="truncate">{event.venue_neighborhood || event.venue_name}</span>
						</p>
						<p class="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
							<Clock class="h-3 w-3 shrink-0 text-primary/60" aria-hidden="true" />
							<span>{dateStr} · {timeStr}</span>
						</p>
						{#if showPrice}
							<p class="mt-1 text-xs font-medium text-primary">
								{formatPrice(event.price, event.is_free)}
							</p>
						{/if}
					</div>
				</button>
			{/each}
		</div>
	</section>
{/if}
