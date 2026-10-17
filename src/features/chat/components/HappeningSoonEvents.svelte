<script lang="ts">
	import { Calendar, MapPin, Clock } from 'lucide-svelte'
	import * as m from '#paraglide/messages.js'
	import { formatPrice } from '#features/chat/lib/messages.ts'
	import { formatShortDate, formatTime } from '#shared/lib/utils/formatting.ts'
	import type { HomeEventFeed } from '#features/events/lib/home-feed.ts'
	import { HOME_ARTWORK_SIZES } from '#features/events/lib/artwork-delivery.ts'
	import EventArtwork from '#features/events/components/EventArtwork.svelte'

	let {
		onSelectPrompt,
		initialEvents = []
	}: {
		/** @param options.eventId exact event tapped — sent server-side, hidden from chat text */
		onSelectPrompt: (prompt: string, options?: { eventId?: string }) => void
		/** Prefetched events from the route loader. */
		initialEvents?: HomeEventFeed
	} = $props()
</script>

{#await initialEvents}
	<section aria-busy="true" aria-label={m.home_happening_soon_title()}>
		<div class="mb-4 h-6 w-36 rounded bg-muted" aria-hidden="true"></div>
		<div class="flex gap-3 overflow-hidden sm:grid sm:grid-cols-4 sm:gap-4" aria-hidden="true">
			{#each [0, 1, 2, 3] as slot (slot)}
				<div class="w-[58%] max-w-[220px] shrink-0 overflow-hidden rounded-xl border border-border/50 sm:w-auto sm:max-w-none">
					<div class="aspect-[4/3] bg-muted"></div>
					<div class="h-28 bg-card"></div>
				</div>
			{/each}
		</div>
	</section>
{:then events}
	{@const displayedEvents = events.slice(0, 4)}
	{#if displayedEvents.length === 0}
		<!-- Hidden entirely when there are no events to show (legacy behavior). -->
	{:else}
		<section aria-label={m.home_happening_soon_title()}>
			<div class="mb-4 flex items-baseline justify-between gap-3">
				<h2 class="text-base font-medium text-foreground">{m.home_happening_soon_title()}</h2>
				<p class="text-right text-xs text-muted-foreground">{m.home_happening_soon_hint()}</p>
			</div>

			<div
				data-horizontal-scroll
				class="flex touch-pan-x gap-3 overflow-x-auto overscroll-contain pb-1 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:grid sm:touch-auto sm:grid-cols-4 sm:gap-4 sm:overflow-visible sm:overscroll-auto sm:pb-0"
			>
				{#each displayedEvents as event, index (event.id)}
					{@const startDate = new Date(event.starts_at)}
					{@const dateStr = formatShortDate(startDate)}
					{@const timeStr = event.time_tba ? m.concierge_time_tba() : formatTime(startDate)}
					{@const showPrice = event.is_free || event.price !== null}
					<button
						type="button"
						onclick={() => onSelectPrompt(m.home_happening_soon_prompt({ name: event.name }), { eventId: event.id })}
						aria-label={m.home_happening_soon_prompt({ name: event.name })}
						class="group flex w-[58%] max-w-[220px] shrink-0 flex-col overflow-hidden rounded-xl border border-border/50 bg-card text-left transition-colors hover:border-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-auto sm:max-w-none"
					>
						{#if event.image_url}
							<EventArtwork
								eventId={event.id}
								imageUrl={event.image_url}
								sizes={HOME_ARTWORK_SIZES}
								imageWidth={event.image_width}
								imageHeight={event.image_height}
								aspectRatio="4 / 3"
								loading={index < 2 ? 'eager' : 'lazy'}
								fetchpriority={index === 0 ? 'high' : 'auto'}
								class="w-full"
							/>
						{:else}
							<div
								class="flex h-24 items-center justify-center bg-muted text-muted-foreground/60 sm:h-36"
							>
								<Calendar class="h-6 w-6" aria-hidden="true" />
							</div>
						{/if}
						<div class="p-3">
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

{/await}
