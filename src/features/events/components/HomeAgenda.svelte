<script lang="ts">
	import type { Snippet } from 'svelte'
	import * as m from '#paraglide/messages.js'
	import { getLocale } from '#paraglide/runtime.js'
	import { HOME_FILTERS, HOME_PAGE_SIZE, agendaDisplayDay, type HomeAgendaCardEvent, type HomeAgendaEvent, type HomeFilter, type HomeViewPage } from '../lib/home-feed.ts'
	import HomeAgendaCard from './HomeAgendaCard.svelte'
	import InstallApp from '#shared/ui/InstallApp.svelte'

	let { view, filter, url, onAsk, onMore, day, composer, listingOnly = false }:  {
		view: HomeViewPage
		filter: HomeFilter | null
		url: Pick<URL, 'href'>
		onAsk?: (event: HomeAgendaEvent) => void
		onMore?: (href: string) => Promise<void>
		listingOnly?: boolean
		day: string | undefined
		composer?: Snippet
	} = $props()
	let loadingMore = false
	let grid = $state<HTMLDivElement>()
	// Source order stays usable when the browser does not support CSS reading-flow.
	const chatAfter = 6
	const beforeChat = $derived(view.events.slice(0, chatAfter))
	const afterChat = $derived(view.events.slice(chatAfter))
	const dayKeys = $derived(view.events.map((event) => agendaDisplayDay(event, day)))
	const tomorrow = $derived(day && new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10))
	const weekday = new Intl.DateTimeFormat(getLocale() === 'es' ? 'es-AR' : 'en-US', { timeZone: 'UTC', weekday: 'long' })

	function dayHeading(key: string) {
		if (key === day) return m.landing_today()
		if (key === tomorrow) return m.home_tomorrow()
		return `${weekday.format(new Date(`${key}T00:00:00Z`))} ${Number(key.slice(-2))}`
	}
	const nextHref = $derived.by(() => {
		const target = new URL(url.href)
		target.searchParams.set('n', String(view.events.length + HOME_PAGE_SIZE))
		return target.pathname + target.search
	})

	const labels = { hoy: m.landing_today, finde: m.home_filter_weekend, gratis: m.event_free, musica: m.home_filter_music }
	const emptyCopy = { feed: m.home_empty_feed, hoy: m.home_empty_today, finde: m.home_empty_weekend, gratis: m.home_empty_free, musica: m.home_empty_category }

	function filterLink(key: (typeof HOME_FILTERS)[number]) {
		const target = new URL(url.href)
		target.searchParams.delete('n')
		if (filter === key) target.searchParams.delete('f')
		else target.searchParams.set('f', key)
		return target.pathname + target.search
	}

	async function showMore(event: MouseEvent) {
		if (!onMore || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
		event.preventDefault()
		if (loadingMore) return
		loadingMore = true
		const index = view.events.length
		try {
			await onMore(nextHref)
			if (event.detail === 0) grid?.querySelectorAll('[data-section="event-card"]')[index]?.querySelector('a')?.focus({ preventScroll: true })
		} finally {
			loadingMore = false
		}
	}
</script>

{#snippet card(event: HomeAgendaCardEvent, index: number)}
	{@const key = dayKeys[index]}
	{#if key !== dayKeys[index - 1]}
		<h2 data-section="day" class="col-span-full border-b border-[#3b3b42] pb-1.5 text-sm font-semibold text-[#d5d5db] first-letter:uppercase md:hidden">{dayHeading(key)}</h2>
	{/if}
	<HomeAgendaCard {event} {index} {onAsk} />
{/snippet}

<section data-section="agenda" class="mx-auto w-full max-w-[90rem] px-4 pb-12 sm:px-8 lg:px-12">
	{#if !listingOnly}
	<nav data-section="filters" aria-label={m.home_filter_nav()} data-sveltekit-reset="false" data-sveltekit-preload-data="false" class="mb-2 flex gap-2 overflow-x-auto pt-1 pb-2 max-[360px]:gap-1.5 sm:mb-0 sm:pb-7">
		{#each HOME_FILTERS as key (key)}
			{@const href = filterLink(key)}
			<a
				{href}
				aria-current={filter === key ? 'true' : undefined}
				class={['inline-flex min-h-10 shrink-0 items-center rounded-full border border-[#d0ff36] px-3.5 text-sm whitespace-nowrap max-[360px]:px-[7px] sm:min-h-11',
					filter === key ? 'bg-[#d0ff36] font-bold text-[#171a0c]' : 'font-medium text-[#d0ff36] hover:bg-[#29320c]']}
			>{labels[key]()}</a>
		{/each}
	</nav>
	<p aria-live="polite" class={view.empty ? 'mb-6 border-l-2 border-[#d0ff36] py-2 pl-4 text-[#eeeeef]' : 'sr-only'}>
		{view.empty ? emptyCopy[view.empty]() : ''}
	</p>
	{/if}
	<div bind:this={grid} class="grid grid-cols-1 gap-y-3 [reading-flow:grid-rows] sm:gap-x-5 md:grid-cols-3 md:gap-y-7 lg:grid-cols-4 lg:gap-x-8 lg:gap-y-10 min-[90rem]:grid-cols-5">
		{#each beforeChat as event, index (event.id)}
			{@render card(event, index)}
		{/each}
		{#if composer}
			<div data-section="agenda-composer" class="agenda-composer col-span-full min-w-0 py-2">
				{@render composer()}
				<InstallApp hint />
			</div>
		{/if}
		{#each afterChat as event, index (event.id)}
			{@render card(event, chatAfter + index)}
		{/each}
	</div>
	{#if !listingOnly && !view.empty}
		<div data-section="paging" class="mt-8 flex flex-col items-center gap-2 text-center">
			<p aria-live="polite" class="text-sm text-[#d5d5db]">{m.home_showing_count({ shown: view.events.length, total: view.total })}</p>
			{#if view.events.length < view.total}
				<a
					href={nextHref}
					onclick={showMore}
					data-sveltekit-preload-data="false"
					class="inline-flex min-h-11 items-center rounded-full border border-[#d0ff36] px-5 text-sm font-medium text-[#d0ff36] hover:bg-[#29320c]"
				>{m.home_show_more()}</a>
			{/if}
		</div>
	{/if}
</section>

<style>
	.agenda-composer { order: 1; }
	.agenda-composer ~ h2, .agenda-composer ~ :global(article) { order: 2; }

	@media (width >= 64rem) {
		.agenda-composer ~ :global(article:nth-child(-n + 8 of article)) { order: 0; }
	}

	@media (width >= 90rem) {
		.agenda-composer ~ :global(article:nth-child(-n + 10 of article)) { order: 0; }
	}
</style>
