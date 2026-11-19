<script lang="ts">
	import { ArrowUpRight, MessageCircle } from 'lucide-svelte'
	import { on } from 'svelte/events'
	import * as m from '#paraglide/messages.js'
	import { formatShortDate, formatTime } from '#shared/lib/utils/formatting.ts'
	import { formatPrice } from '#features/chat/lib/messages.ts'
	import type { HomeAgendaCardEvent, HomeAgendaEvent } from '../lib/home-feed.ts'
	import { HOME_ARTWORK_SIZES } from '../lib/artwork-delivery.ts'
	import EventArtwork from './EventArtwork.svelte'

	let { event, index, onAsk }: { event: HomeAgendaCardEvent; index: number; onAsk: (event: HomeAgendaEvent) => void } = $props()
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

{#snippet glossaryText(text: string, field: 'title' | 'meta')}
	{@const { parts, rest } = glossaryParts(text)}
	{#each parts as { before, word, index, explain } (index)}
		{@const id = `gloss-${event.id}-${field}-${index}`}
		{before}<span
			role="group"
			onpointerenter={(event) => { if (event.pointerType === 'mouse') hovered = id }}
			onpointerleave={() => { if (hovered === id) hovered = null }}
		><button
			type="button"
			class="relative z-10 inline cursor-help text-left underline decoration-dotted underline-offset-4"
			aria-expanded={visibleTooltip === id}
			aria-controls={id}
			aria-describedby={id}
			onclick={() => { expanded = expanded === id ? null : id }}
		>{word}</button><span {id} role="tooltip" hidden={visibleTooltip !== id} class="absolute inset-x-0 top-full z-20 border-l-2 border-[#d0ff36] bg-[#28282f] px-3 py-2 text-sm font-normal text-[#eeeeef]">{explain()}</span></span>
	{/each}{rest}
{/snippet}

<article class="flex min-w-0 flex-col border-b border-[#3b3b42] pb-3">
	<div class="group relative">
		<a href={`/events/${encodeURIComponent(event.id)}`} class="block after:absolute after:inset-0 after:z-1">
			<EventArtwork
				eventId={event.id}
				imageUrl={event.image_url}
				imageWidth={event.image_width}
				imageHeight={event.image_height}
				sizes={HOME_ARTWORK_SIZES}
				aspectRatio="4 / 5"
				alt={event.name}
				loading={index < 4 ? 'eager' : 'lazy'}
				fetchpriority={index === 0 ? 'high' : 'auto'}
				class="w-full rounded-none! bg-[#1d1d23]!"
			/>
		</a>
		<div class="space-y-1 pt-2 wrap-anywhere">
			<div class="font-mono text-xs text-[#d0ff36] sm:text-sm">
				<time datetime={event.starts_at}>{formatShortDate(event.starts_at)}</time>{#if event.slotStarts}{#each event.slotStarts as slot (slot)}{' · '}<time datetime={slot}>{formatTime(slot)}</time>{/each}{:else if event.time_tba}{' · '}{m.concierge_time_tba()}{:else if !event.is_all_day}{' · '}<time datetime={event.starts_at}>{formatTime(event.starts_at)}</time>{/if}
			</div>
			<div class="relative">
				<h2 class="line-clamp-3 text-base leading-tight font-semibold has-[:focus-visible]:line-clamp-none sm:line-clamp-2 group-has-[a:hover]:underline">{@render glossaryText(event.name, 'title')}</h2>
			</div>
			<p class="relative text-xs leading-snug text-[#ccccd4]">{@render glossaryText(`${venue} · ${price}`, 'meta')}</p>
		</div>
	</div>
	<div class="mt-auto flex flex-wrap items-center gap-x-2.5 pt-1 text-xs sm:font-mono">
		{#if event.sourceUrl}
			<a href={event.sourceUrl} class="inline-flex min-h-8 max-w-full items-center gap-1 text-[#ccccd4] underline underline-offset-4 hover:text-white sm:min-h-10 sm:whitespace-nowrap">
				<ArrowUpRight class="size-3.5 shrink-0" aria-hidden="true" /> {m.home_original_post()}
			</a>
		{/if}
		<button type="button" onclick={() => onAsk(event)} class="inline-flex min-h-8 max-w-full items-center gap-1 text-left text-[#d0ff36] hover:underline sm:min-h-10 sm:whitespace-nowrap">
			<MessageCircle class="size-3.5 shrink-0" aria-hidden="true" /> {m.home_ask_event()}
		</button>
	</div>
</article>
