<script lang="ts">
	import { ArrowUpRight, MessageCircle } from 'lucide-svelte'
	import * as m from '#paraglide/messages.js'
	import { formatShortDate, formatTime } from '#shared/lib/utils/formatting.ts'
	import { formatPrice } from '#features/chat/lib/messages.ts'
	import type { HomeAgendaEvent } from '../lib/home-feed.ts'
	import { HOME_ARTWORK_SIZES } from '../lib/artwork-delivery.ts'
	import EventArtwork from './EventArtwork.svelte'

	let { event, index, onAsk }: { event: HomeAgendaEvent; index: number; onAsk: (event: HomeAgendaEvent) => void } = $props()
	let expanded = $state<string | null>(null)
	const price = $derived(event.payWhatYouCan ? m.home_price_pay_what_you_can() : formatPrice(event.price, event.is_free))
	const venue = $derived(event.location_hidden ? m.event_location_hidden() :
		[event.venue_name, event.venue_neighborhood].filter(Boolean).join(' · ') || m.concierge_location_tba())
	const terms = [
		{ key: 'gorra', pattern: /\ba la gorra\b/i, explain: m.home_glossary_gorra },
		{ key: 'pena', pattern: /\bpeña\b/i, explain: m.home_glossary_pena },
		{ key: 'variete', pattern: /\bvariet[eé](?![\p{L}\p{N}])/iu, explain: m.home_glossary_variete },
		{ key: 'jam', pattern: /\bjam\b/i, explain: m.home_glossary_jam },
		{ key: 'mic', pattern: /\b(?:micr[oó]fono abierto|open[ -]mic)\b/i, explain: m.home_glossary_mic },
	]
	const explanations = $derived(terms.filter(({ pattern }) => pattern.test(`${event.name} ${venue} ${price}`.normalize())))
</script>

<article class="min-w-0 border-b border-[#3b3b42] pb-3">
	<a href={`/events/${encodeURIComponent(event.id)}`} class="group block">
		<EventArtwork
			eventId={event.id}
			imageUrl={event.image_url}
			imageWidth={event.image_width}
			imageHeight={event.image_height}
			sizes={HOME_ARTWORK_SIZES}
			aspectRatio="4 / 3"
			alt={event.name}
			loading={index < 2 ? 'eager' : 'lazy'}
			fetchpriority={index === 0 ? 'high' : 'auto'}
			class="w-full rounded-none! bg-[#1d1d23]!"
		/>
		<div class="space-y-1 pt-3 wrap-anywhere">
			<time datetime={event.starts_at} class="block font-mono text-xs text-[#d0ff36] sm:text-sm">
				{formatShortDate(event.starts_at)}{#if event.time_tba}{' · '}{m.concierge_time_tba()}{:else if !event.is_all_day}{' · '}{formatTime(event.starts_at)}{/if}
			</time>
			<h2 class="text-lg leading-tight font-semibold group-hover:underline">{event.name}</h2>
			<p class="text-sm text-[#ccccd4]">{venue} · {price}</p>
		</div>
	</a>
	{#each explanations as term (term.key)}
		{@const text = term.explain()}
		{@const id = `gloss-${event.id}-${term.key}`}
		<div class="glossary" data-expanded={expanded === term.key ? '' : undefined}>
			<button
				type="button"
				class="min-h-9 text-left text-sm text-[#d0ff36] underline decoration-dotted underline-offset-4"
				aria-expanded={expanded === term.key}
				aria-controls={id}
				onclick={() => { expanded = expanded === term.key ? null : term.key }}
			>{text.split(': ', 1)[0]}</button>
			<p {id} class="explanation mb-1 border-l-2 border-[#d0ff36] py-1 pl-3 text-sm text-[#eeeeef]">{text}</p>
		</div>
	{/each}
	<div class="mt-1 flex flex-wrap items-center gap-x-4 font-mono text-xs">
		{#if event.sourceUrl}
			<a href={event.sourceUrl} class="inline-flex min-h-10 items-center gap-1 text-[#ccccd4] underline underline-offset-4 hover:text-white">
				{m.home_original_post()} <ArrowUpRight class="size-3.5 shrink-0" aria-hidden="true" />
			</a>
		{/if}
		<button type="button" onclick={() => onAsk(event)} class="inline-flex min-h-10 items-center gap-1 text-left text-[#d0ff36] hover:underline">
			<MessageCircle class="size-3.5 shrink-0" aria-hidden="true" /> {m.home_ask_event()}
		</button>
	</div>
</article>

<style>
	.glossary:not([data-expanded]) .explanation { display: none; }
	@media (hover: hover) {
		.glossary:not([data-expanded]):hover .explanation { display: block; }
	}
</style>
