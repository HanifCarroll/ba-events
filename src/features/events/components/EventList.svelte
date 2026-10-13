<script lang="ts">
	import EventCard from './EventCard.svelte';
	import type { EventWithVenue } from '#shared/lib/types.ts';

	let {
		events,
		responseId,
		commentary,
		tips
	}: {
		events: EventWithVenue[];
		responseId?: string;
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
			{responseId}
			variant="hero"
			commentary={commentary}
			tips={tips}
		/>
	</div>
{:else}
	<div class="stagger-children space-y-3 sm:space-y-0">
		{#each events as event, index (event.id)}
			<div>
				<EventCard event={event} position={index} source="chat" variant="default" {responseId} />
			</div>
		{/each}
	</div>
{/if}
