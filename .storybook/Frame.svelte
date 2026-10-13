<script lang="ts">
	import type { Snippet } from 'svelte';
	let { locale, children }: { locale: string; children: Snippet } = $props();
</script>

<!-- Paraglide consumers sometimes capture locale at mount; remount on a toolbar change. -->
{#key locale}
	<main lang={locale} class="mx-auto max-w-4xl p-4 sm:p-8">
		{@render children()}
	</main>
{/key}
