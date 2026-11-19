<script lang="ts">
	import * as m from '#paraglide/messages.js'
	import { HOME_FILTERS, parseHomeFilter, selectHomeView, type HomeAgenda, type HomeAgendaEvent } from '../lib/home-feed.ts'
	import HomeAgendaCard from './HomeAgendaCard.svelte'

	let { agenda, url, onFilter, onAsk }: {
		agenda: HomeAgenda | null
		url: URL
		onFilter: (href: string) => void
		onAsk: (event: HomeAgendaEvent) => void
	} = $props()

	const filter = $derived(parseHomeFilter(url.searchParams.get('f')))
	const view = $derived(agenda ? selectHomeView(agenda, filter) : { events: [], empty: 'feed' } as const)
	const labels = { hoy: m.landing_today, finde: m.home_filter_weekend, gratis: m.event_free, musica: m.home_filter_music }
	const emptyCopy = { feed: m.home_empty_feed, hoy: m.home_empty_today, finde: m.home_empty_weekend, gratis: m.home_empty_free, musica: m.home_empty_category }

	function filterLink(key: (typeof HOME_FILTERS)[number]) {
		const target = new URL(url)
		if (filter === key) target.searchParams.delete('f')
		else target.searchParams.set('f', key)
		return target.pathname + target.search
	}

	function selectFilter(event: MouseEvent, href: string) {
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
		event.preventDefault()
		onFilter(href)
	}
</script>

<section class="mx-auto w-full max-w-[90rem] px-4 pb-12 sm:px-8 lg:px-12">
	<nav aria-label={m.home_filter_nav()} data-sveltekit-preload-data="false" class="flex flex-wrap gap-2.5 pb-5 font-mono sm:pb-7">
		{#each HOME_FILTERS as key (key)}
			{@const href = filterLink(key)}
			<a
				{href}
				onclick={(event) => selectFilter(event, href)}
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
		<div class="grid grid-cols-2 gap-x-3 gap-y-6 sm:gap-x-5 sm:gap-y-7 lg:grid-cols-3 lg:gap-x-8 lg:gap-y-10">
			{#each view.events as event, index (event.id)}
				<HomeAgendaCard {event} {index} {onAsk} />
			{/each}
		</div>
	{/if}
</section>
