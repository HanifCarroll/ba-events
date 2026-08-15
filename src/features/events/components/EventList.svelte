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
	<div class="animate-fade-in-up">
		<EventCard
			event={events[0]}
			position={0}
			source="chat"
			variant="hero"
			commentary={commentary}
			tips={tips}
		/>
	</div>
{:else}
	<div class="stagger-children space-y-3 sm:space-y-0">
		{#each events as event, index (event.id)}
			<div>
				<EventCard event={event} position={index} source="chat" variant="default" />
			</div>
		{/each}
	</div>
{/if}
