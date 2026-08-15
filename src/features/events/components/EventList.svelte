<script lang="ts">
	import EventCard from './EventCard.svelte';
	import type { EventWithVenue } from '#shared/lib/types.ts';

	let {
		events,
		commentary,
		tips
	}: {
		events: EventWithVenue[];
		/** Commentary for hero card (single recommendation mode) */
		commentary?: string;
		/** Tips for hero card (single recommendation mode) */
		tips?: string[];
	} = $props();
</script>

{#if events.length === 1}
	<!-- Single recommendation → confident hero card. -->
	<EventCard
		event={events[0]}
		position={0}
		source="chat"
		variant="hero"
		commentary={commentary}
		tips={tips}
	/>
{:else}
	<!-- Multiple events → plain equal list (no "main" pick, no "you might also like"). -->
	<div class="space-y-3 sm:space-y-0">
		{#each events as event, index (event.id)}
			<EventCard event={event} position={index} source="chat" variant="default" />
		{/each}
	</div>
{/if}
