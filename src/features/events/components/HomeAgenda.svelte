<script lang="ts">
	import * as m from '#paraglide/messages.js'
	import { HOME_FILTERS, HOME_PAGE_SIZE, type HomeAgendaEvent, type HomeFilter, type HomeViewPage } from '../lib/home-feed.ts'
	import HomeAgendaCard from './HomeAgendaCard.svelte'

	let { view, filter, url, onAsk, onMore }: {
		view: HomeViewPage
		filter: HomeFilter | null
		url: URL
		onAsk: (event: HomeAgendaEvent) => void
		onMore: (href: string) => Promise<void>
	} = $props()
	let loadingMore = false
	let grid = $state<HTMLDivElement>()
	const nextHref = $derived.by(() => {
		const target = new URL(url)
		target.searchParams.set('n', String(view.events.length + HOME_PAGE_SIZE))
		return target.pathname + target.search
	})

	const labels = { hoy: m.landing_today, finde: m.home_filter_weekend, gratis: m.event_free, musica: m.home_filter_music }
	const emptyCopy = { feed: m.home_empty_feed, hoy: m.home_empty_today, finde: m.home_empty_weekend, gratis: m.home_empty_free, musica: m.home_empty_category }

	function filterLink(key: (typeof HOME_FILTERS)[number]) {
		const target = new URL(url)
		target.searchParams.delete('n')
		if (filter === key) target.searchParams.delete('f')
		else target.searchParams.set('f', key)
		return target.pathname + target.search
	}

	async function showMore(event: MouseEvent) {
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
		event.preventDefault()
		if (loadingMore) return
		loadingMore = true
		const index = view.events.length
		try {
			await onMore(nextHref)
			if (event.detail === 0) grid?.children[index]?.querySelector('a')?.focus({ preventScroll: true })
		} finally {
			loadingMore = false
		}
	}
</script>

<section class="mx-auto w-full max-w-[90rem] px-4 pb-12 sm:px-8 lg:px-12">
	<nav aria-label={m.home_filter_nav()} data-sveltekit-reset="false" data-sveltekit-preload-data="false" class="flex flex-wrap gap-2.5 pb-5 font-mono sm:pb-7">
		{#each HOME_FILTERS as key (key)}
			{@const href = filterLink(key)}
			<a
				{href}
				aria-current={filter === key ? 'true' : undefined}
				class={['inline-flex min-h-10 items-center rounded-full border border-[#d0ff36] px-4 text-sm sm:min-h-11',
					filter === key ? 'bg-[#d0ff36] font-bold text-[#171a0c]' : 'text-[#d0ff36] hover:bg-[#29320c]']}
			>{labels[key]()}</a>
		{/each}
	</nav>
	<p aria-live="polite" class={view.empty ? 'mb-6 border-l-2 border-[#d0ff36] py-2 pl-4 text-[#eeeeef]' : 'sr-only'}>
		{view.empty ? emptyCopy[view.empty]() : ''}
	</p>
	{#if view.events.length}
		<div bind:this={grid} class="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 sm:gap-x-5 sm:gap-y-7 lg:grid-cols-4 lg:gap-x-8 lg:gap-y-10 min-[90rem]:grid-cols-5">
			{#each view.events as event, index (event.id)}
				<HomeAgendaCard {event} {index} {onAsk} />
			{/each}
		</div>
	{/if}
	{#if !view.empty}
		<div class="mt-8 flex flex-col items-center gap-2 text-center">
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
