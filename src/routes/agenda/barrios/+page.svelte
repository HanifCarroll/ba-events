<script lang="ts">
	import DiscoveryShell from '#features/discovery/components/DiscoveryShell.svelte'
	import type { PageProps } from './$types'
	let { data }: PageProps = $props()
</script>

<DiscoveryShell {data} agenda>
	<div class="mx-auto max-w-[90rem] px-4 pb-8 sm:px-8 lg:px-12">
		{#if data.links.length}
			<ul class="grid gap-x-4 sm:grid-cols-2 lg:grid-cols-3">
				{#each data.links as link (link.name)}
					<li><a class="inline-flex min-h-11 items-center text-[#d0ff36] underline" href={link.href}>{link.name}</a></li>
				{/each}
			</ul>
		{:else}
			<p>Todavía no encontramos próximos eventos por barrio. Mirá la <a class="underline" href="/agenda/esta-semana">agenda de esta semana</a>.</p>
		{/if}
	</div>
</DiscoveryShell>
