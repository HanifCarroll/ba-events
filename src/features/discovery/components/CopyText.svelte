<script lang="ts">
	let { text }: { text: string } = $props()

	// Only the copy handoff's inline formatting is supported. Svelte escapes interpolated catalog text.
	const parts = $derived(text.split(/(\[[^\]\n]+\]\((?:\/(?!\/)|https:\/\/)[^\s)]+\)|\*\*[^*\n]+\*\*)/g))
</script>

{#each parts as part, index (index)}{#if index % 2 === 0}{part}{:else if part.startsWith('**')}<strong>{part.slice(2, -2)}</strong>{:else}
	{@const separator = part.indexOf('](')}
	<a href={part.slice(separator + 2, -1)} class="text-[#d0ff36] underline underline-offset-4">{part.slice(1, separator)}</a>
{/if}{/each}
