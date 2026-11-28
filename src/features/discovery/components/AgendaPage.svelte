<script lang="ts">
	import { page } from '$app/state'
	import HomeAgenda from '#features/events/components/HomeAgenda.svelte'
	import type { AgendaPageData } from '../api/agenda-page.server.ts'
	import CopyText from './CopyText.svelte'
	import DiscoveryShell from './DiscoveryShell.svelte'

	let { data }: { data: AgendaPageData } = $props()
	const jsonLd = $derived(JSON.stringify(data.jsonLd).replaceAll('<', '\\u003c'))
</script>

<svelte:head>
	{@html '<script type="application/ld+json">' + jsonLd + '</' + 'script>'}
</svelte:head>

<DiscoveryShell {data} agenda={data.path.startsWith('/agenda/')}>
	<p class="mx-auto mb-6 max-w-[90rem] px-4 leading-relaxed sm:px-8 lg:px-12"><CopyText text={data.intro} /></p>
	{#if data.info.length}
		<dl class="mx-auto mb-6 grid max-w-[90rem] gap-2 px-4 sm:px-8 lg:px-12">
			{#each data.info as item (item.label)}
				<div class="flex flex-wrap gap-x-2">
					<dt class="font-semibold">{item.label}:</dt>
					<dd>{#if item.href}<a class="text-[#d0ff36] underline" href={item.href}>{item.value}</a>{:else}{item.value}{/if}</dd>
				</div>
			{/each}
		</dl>
	{/if}
	{#each data.sections as section, index (index)}
		{#if section.heading}<h2 class="mx-auto max-w-[90rem] px-4 pb-4 text-xl font-semibold sm:px-8 lg:px-12">{section.heading}</h2>{/if}
		<HomeAgenda listingOnly view={{ events: section.cards, empty: null, total: section.cards.length }}
			filter={null} url={page.url} day={data.day} />
	{/each}
	<section class="mx-auto max-w-[90rem] space-y-5 px-4 pb-10 sm:px-8 lg:px-12">
		{#each data.faq as item (item.question)}
			<div class="max-w-prose space-y-1">
				<h2 class="text-lg font-semibold">{item.question}</h2>
				<p><CopyText text={item.answer} /></p>
			</div>
		{/each}
	</section>
</DiscoveryShell>
