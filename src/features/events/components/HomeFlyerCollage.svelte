<script lang="ts">
	import type { HomeAgendaEvent } from '../lib/home-feed.ts'
	import EventArtwork from './EventArtwork.svelte'

	let { flyers }: { flyers: HomeAgendaEvent[] } = $props()
</script>

<div class="collage relative hidden md:block">
	{#each flyers as flyer (flyer.id)}
		<a class="flyer" href={`/events/${encodeURIComponent(flyer.id)}`} aria-label={flyer.name}>
			<EventArtwork
				eventId={flyer.id}
				imageUrl={flyer.image_url}
				imageWidth={flyer.image_width}
				imageHeight={flyer.image_height}
				sizes="auto, 132px"
				crop
				class="rounded-[1px]! bg-[#1d1d23]!"
			/>
		</a>
	{/each}
</div>

<style>
	.collage {
		container-type: size;
	}

	.flyer {
		--width: min(72cqh, 57cqw);
		--position: 0;
		--offset: 14px;
		--tilt: -6deg;
		position: absolute;
		top: calc(50% + var(--offset) - 9px);
		left: calc((100% - var(--width)) * var(--position));
		width: var(--width);
		translate: 0 -50%;
		rotate: var(--tilt);
		border: 2px solid #fbf3e6;
		border-radius: 3px;
		box-shadow: 0 8px 20px rgb(0 0 0 / 50%);
	}

	.flyer:nth-child(2) {
		--position: 0.3333;
		--offset: 2px;
		--tilt: 4deg;
	}

	.flyer:nth-child(3) {
		--position: 0.6667;
		--offset: 18px;
		--tilt: -3deg;
	}

	.flyer:nth-child(4) {
		--offset: 6px;
		--tilt: 6deg;
	}

	.flyer:nth-child(2):nth-last-child(2) {
		--position: 0.5;
	}

	.flyer:last-child {
		--position: 1;
	}

	.flyer:hover {
		z-index: 1;
		rotate: 0deg;
	}

	.flyer:focus-visible {
		z-index: 2;
		rotate: 0deg;
		outline: 2px solid #d0ff36;
		outline-offset: 3px;
	}

	@media (prefers-reduced-motion: no-preference) {
		.flyer {
			transition: rotate 160ms ease-out;
		}
	}
</style>
