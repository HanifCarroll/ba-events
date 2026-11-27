<script lang="ts">
	import { ArrowUpRight, MessageCircle } from 'lucide-svelte'
	import { on } from 'svelte/events'
	import * as m from '#paraglide/messages.js'
	import { formatDoorsTime, formatShortDate, formatTime } from '#shared/lib/utils/formatting.ts'
	import { formatPrice } from '../lib/format-price.ts'
	import { homeDay, type HomeAgendaCardEvent, type HomeAgendaEvent } from '../lib/home-feed.ts'
	import { HOME_ARTWORK_SIZES } from '../lib/artwork-delivery.ts'
	import EventArtwork from './EventArtwork.svelte'

	let { event, index, displayDay, onAsk }: {
		event: HomeAgendaCardEvent
		index: number
		displayDay: string
		onAsk?: (event: HomeAgendaEvent) => void
	} = $props()
	let expanded = $state<string | null>(null)
	let hovered = $state<string | null>(null)
	const visibleTooltip = $derived(hovered ?? expanded)

	function dismissTooltip(event: KeyboardEvent) {
		if (event.key !== 'Escape') return
		expanded = null
		hovered = null
	}

	$effect(() => {
		if (visibleTooltip) return on(window, 'keydown', dismissTooltip)
	})

	const sourceIsPost = $derived(/^https:\/\/(?:www\.)?instagram\.com\/(?:p|reel)\/[\w-]+\/?(?:[?#].*)?$/i.test(event.sourceUrl ?? ''))
	const hasTime = $derived(event.time_tba || !event.is_all_day)
	const showStartDateOnMobile = $derived(homeDay(event.starts_at) < displayDay)
	const price = $derived(event.payWhatYouCan ? m.home_price_pay_what_you_can() : formatPrice(event.price, event.is_free))
	const venue = $derived(event.location_hidden ? m.event_location_hidden() :
		[event.venue_name, event.venue_neighborhood].filter(Boolean).join(' · ') || m.concierge_location_tba())
	const terms = [
		{ term: 'a la gorra', explain: m.home_glossary_gorra },
		{ term: 'peña', explain: m.home_glossary_pena },
		{ term: 'variet[eé]', explain: m.home_glossary_variete },
		{ term: 'jam', explain: m.home_glossary_jam },
		{ term: 'micr[oó]fono abierto|open[ -]mic', explain: m.home_glossary_mic },
	].map(({ term, explain }) => ({ pattern: new RegExp(`(?<![\\p{L}\\p{N}])(?:${term})(?![\\p{L}\\p{N}])`, 'giu'), explain }))

	function glossaryParts(text: string) {
		const line = text.normalize()
		const matches = terms.flatMap(({ pattern, explain }) =>
			Array.from(line.matchAll(pattern), (match) => ({ index: match.index, word: match[0], explain }))
		).sort((a, b) => a.index - b.index)
		let end = 0
		const parts = matches.map((match) => {
			const before = line.slice(end, match.index)
			end = match.index + match.word.length
			return { ...match, before }
		})
		return { parts, rest: line.slice(end) }
	}
</script>

{#snippet glossaryText(text: string, field: 'title' | 'meta' | 'price')}
	{@const { parts, rest } = glossaryParts(text)}
	{#each parts as { before, word, index, explain } (index)}
		{@const id = `gloss-${event.id}-${field}-${index}`}
		{before}<span
			role="group"
			onpointerenter={(event) => { if (event.pointerType === 'mouse') hovered = id }}
			onpointerleave={() => { if (hovered === id) hovered = null }}
		><button
			type="button"
			class={['relative z-10 inline cursor-help text-left decoration-dotted underline-offset-4', field === 'title' ? 'hover:underline focus-visible:underline' : 'underline']}
			aria-expanded={visibleTooltip === id}
			aria-controls={id}
			aria-describedby={id}
			onclick={() => { expanded = expanded === id ? null : id }}
		>{word}</button><span {id} role="tooltip" hidden={visibleTooltip !== id} class="absolute inset-x-0 top-full z-20 border-l-2 border-[#d0ff36] bg-[#28282f] px-3 py-2 text-sm font-normal text-[#eeeeef]">{explain()}</span></span>
	{/each}{rest}
{/snippet}

{#snippet startDate()}
	<time datetime={event.starts_at}>{formatShortDate(event.starts_at)}</time>{#if hasTime}{' · '}{/if}
{/snippet}

<article data-section="event-card" class="agenda-card flex min-w-0 flex-col border-b border-[#3b3b42] pb-3">
	<div class="card-content group relative">
		<a href={`/events/${encodeURIComponent(event.id)}`} class="card-art block after:absolute after:inset-0 after:z-1">
			<EventArtwork
				eventId={event.id}
				imageUrl={event.image_url}
				imageWidth={event.image_width}
				imageHeight={event.image_height}
				sizes={HOME_ARTWORK_SIZES}
				aspectRatio="4 / 5"
				blurFill
				alt={event.name}
				loading={index < 4 ? 'eager' : 'lazy'}
				fetchpriority={index === 0 ? 'high' : 'auto'}
				class="w-full rounded-none! bg-[#1d1d23]!"
			/>
		</a>
		<div class="card-copy space-y-1 pt-2 wrap-anywhere">
			<div class={['text-xs font-medium text-[#d0ff36] tabular-nums sm:text-sm', !hasTime && !showStartDateOnMobile && 'hidden md:block']}>
				{#if showStartDateOnMobile}
					{@render startDate()}
				{:else}
					<span class="hidden md:inline">{@render startDate()}</span>
				{/if}
				{#if event.slotStarts}
					{#each event.slotStarts as slot, i (slot)}{#if i}{' · '}{/if}<time datetime={slot}>{formatTime(slot)}</time>{/each}
				{:else if event.time_tba}
					{#if event.doors_at}<time datetime={event.doors_at}>{formatDoorsTime(event.doors_at, event.starts_at)}</time>{:else}{m.concierge_time_tba()}{/if}
				{:else if hasTime}<time datetime={event.starts_at}>{formatTime(event.starts_at)}</time>{/if}
			</div>
			<div class="relative">
				<h2 class="line-clamp-2 text-base leading-tight font-semibold has-[:focus-visible]:line-clamp-none has-[[aria-expanded=true]]:line-clamp-none group-has-[a:hover]:underline group-has-[a:focus-visible]:underline">{@render glossaryText(event.name, 'title')}</h2>
			</div>
			<p class="relative text-xs leading-snug text-[#ccccd4]">
				{@render glossaryText(venue, 'meta')}<span class="hidden md:inline">{' · '}</span><span class="block text-[#f6f6f7] md:inline md:text-inherit">{@render glossaryText(price, 'price')}</span>
			</p>
		</div>
	</div>
	<div class="card-actions mt-auto flex flex-wrap items-center gap-x-1 pt-1 text-xs md:gap-x-2.5">
		{#if event.sourceUrl}
			<a
				href={event.sourceUrl}
				aria-label={sourceIsPost ? m.home_view_post_for_event({ name: event.name }) : m.home_view_event_named({ name: event.name })}
				class="inline-flex min-h-11 min-w-11 items-center justify-center gap-1 px-1 whitespace-nowrap text-[#ccccd4] underline-offset-4 hover:text-white hover:underline focus-visible:underline md:px-0"
			>
				<ArrowUpRight class="size-3.5 shrink-0" aria-hidden="true" /> <span>{sourceIsPost ? m.home_view_post() : m.home_view_event()}</span>
			</a>
		{/if}
		{#if onAsk}
			<button
				type="button"
				aria-label={m.home_ask_event({ name: event.name })}
				onclick={() => onAsk?.(event)}
				class="inline-flex min-h-11 min-w-11 items-center justify-center gap-1 px-1 whitespace-nowrap text-[#d0ff36] underline-offset-4 hover:underline focus-visible:underline md:px-0"
			>
				<MessageCircle class="size-3.5 shrink-0" aria-hidden="true" /> <span>{m.home_ask()}</span>
			</button>
		{/if}
	</div>
</article>

<style>
	@media (width < 48rem) {
		.agenda-card {
			position: relative;
			display: grid;
			grid-template-columns: 96px minmax(0, 1fr);
			grid-template-rows: auto 1fr;
			column-gap: 0.75rem;
		}

		.card-content { display: contents; }
		.card-art { grid-row: span 2; }
		.card-copy { padding-top: 0; }
		.card-actions {
			position: relative;
			z-index: 2;
			align-self: start;
			justify-self: start;
			margin: 0;
		}
		.card-actions > :is(a, button) {
			border: 1px solid #3b3b42;
			border-radius: 0.5rem;
		}
	}
</style>
