<script lang="ts">
	import type { Snippet } from 'svelte'
	import { resolveSiteUrl } from '#shared/lib/utils/url.ts'
	import DiscoveryFooter from './DiscoveryFooter.svelte'
	import { dateLinks } from '../lib/discovery-links.ts'

	let { data, children, agenda = false }: {
		data: { title: string; description: string; heading: string; path: string; canonical: string; lang: 'es' | 'en'; updated: string }
		children: Snippet
		agenda?: boolean
	} = $props()
</script>

<svelte:head>
	<title>{data.title}</title>
	<meta name="description" content={data.description} />
	<link rel="canonical" href={data.canonical} />
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="BA Eventos" />
	<meta property="og:title" content={data.title} />
	<meta property="og:description" content={data.description} />
	<meta property="og:url" content={data.canonical} />
	<meta property="og:locale" content={data.lang === 'es' ? 'es_AR' : 'en_US'} />
	<meta property="og:image" content={resolveSiteUrl('/og-image-2026.jpg')} />
</svelte:head>

<div lang={data.lang} data-section="discovery-page" class="h-full overflow-y-auto bg-[#101012] text-[#eeeeef]">
	<header class="mx-auto max-w-[90rem] space-y-3 px-4 pt-10 pb-6 sm:px-8 lg:px-12">
		<h1 class="font-display text-3xl font-bold sm:text-4xl">{data.heading}</h1>
		{#if data.updated}<p class="text-sm text-[#ccccd4]">{data.updated}</p>{/if}
		{#if agenda}
			<nav aria-label="Agenda" class="flex flex-wrap items-center gap-x-2 text-sm">
				{#each dateLinks as link, index (link.href)}
					{#if index}<span aria-hidden="true">·</span>{/if}
					{#if link.href === data.path}
						<span aria-current="page">{link.label}</span>
					{:else}
						<a class="inline-flex min-h-11 items-center text-[#d0ff36] underline-offset-4 hover:underline" href={link.href}>{link.label}</a>
					{/if}
				{/each}
			</nav>
		{/if}
	</header>
	{@render children()}
	<footer class="mx-auto max-w-[90rem] border-t border-[#3b3b42] px-4 py-6 sm:px-8 lg:px-12">
		<DiscoveryFooter />
	</footer>
</div>
