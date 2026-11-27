<script lang="ts">
	import type { AboutPageData } from '../api/about-page.server.ts'
	import CopyText from './CopyText.svelte'
	import DiscoveryShell from './DiscoveryShell.svelte'

	let { data }: { data: AboutPageData } = $props()
</script>

<DiscoveryShell {data}>
	<article class="mx-auto max-w-[90rem] space-y-4 px-4 pb-10 leading-relaxed sm:px-8 lg:px-12">
		{#each data.blocks as block, index (index)}
			{#if block.startsWith('### ')}
				<h2 class="mt-6 text-xl font-semibold">{block.slice(4)}</h2>
			{:else if block.startsWith('- ')}
				<ul class="max-w-prose list-disc space-y-2 pl-6">
					{#each block.split('\n') as line (line)}<li><CopyText text={line.slice(2)} /></li>{/each}
				</ul>
			{:else}
				<p class="max-w-prose"><CopyText text={block} /></p>
			{/if}
		{/each}
	</article>
</DiscoveryShell>
