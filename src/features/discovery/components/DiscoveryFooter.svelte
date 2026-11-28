<script lang="ts">
	import { footerGroups } from '../lib/discovery-links.ts'
</script>

<nav aria-label="Agenda" class="mb-4 flex flex-wrap gap-x-10 gap-y-5">
	{#each footerGroups as group (group.heading)}
		<section>
			<h2 class="text-sm font-semibold">{group.heading}</h2>
			<ul class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-[#ccccd4]">
				{#each group.links as link (link.href)}
					<li><a data-sveltekit-reload class="inline-flex min-h-11 items-center underline-offset-4 hover:underline focus-visible:underline" href={link.href}>{link.label}</a></li>
				{/each}
			</ul>
		</section>
	{/each}
</nav>
