<script lang="ts">
	import { MapPin, Navigation, ExternalLink } from 'lucide-svelte'
	import { track } from '#shared/lib/analytics.ts'
	import { openMapsUrl } from '#shared/lib/utils/maps.ts'
	import type { DirectionsData } from '#shared/lib/types.ts'

	let { directions }: { directions: DirectionsData } = $props()

	function handleOpenMaps() {
		track('chat:directions_opened', {
			venue_name: directions.venueName,
			has_event: !!directions.eventName
		})
	}

	function handleClick(event: MouseEvent) {
		event.preventDefault()
		handleOpenMaps()
		openMapsUrl(directions.mapsUrl)
	}
</script>

<div
	class="group relative overflow-hidden rounded-xl border border-primary/30 bg-gradient-to-br from-card via-card to-primary/5 shadow-md transition-all duration-300 hover:border-primary/50 hover:shadow-lg"
>
	<!-- Decorative glow -->
	<div
		class="absolute -top-12 -right-12 w-24 h-24 bg-primary/10 rounded-full blur-2xl opacity-60 group-hover:opacity-80 transition-opacity"
	></div>

	<!-- Top accent bar -->
	<div class="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary/40 via-primary to-primary/40"></div>

	<div class="relative p-4">
		<!-- Header with icon -->
		<div class="flex items-start gap-3">
			<div class="shrink-0 p-2.5 rounded-lg bg-primary/15 border border-primary/20">
				<Navigation class="h-5 w-5 text-primary" />
			</div>

			<div class="flex-1 min-w-0">
				{#if directions.eventName}
					<p class="text-xs text-primary font-medium mb-1 truncate">Directions to event</p>
				{/if}

				<h4 class="font-display font-semibold text-lg text-foreground leading-tight">
					{directions.venueName}
				</h4>

				<div class="flex items-start gap-2 mt-2 text-sm text-muted-foreground">
					<MapPin class="h-4 w-4 shrink-0 mt-0.5 text-primary/60" />
					<span class="leading-relaxed">{directions.address}</span>
				</div>
			</div>
		</div>

		<!-- CTA Button -->
		<a
			href={directions.mapsUrl}
			onclick={handleClick}
			class="group/btn flex items-center justify-center gap-2 w-full mt-4 px-4 py-2.5 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm shadow-primary/20 hover:shadow-md hover:shadow-primary/25 transition-all duration-200"
		>
			<Navigation class="h-4 w-4" />
			Open in Google Maps
			<ExternalLink
				class="h-3.5 w-3.5 opacity-70 group-hover/btn:translate-x-0.5 transition-transform"
			/>
		</a>
	</div>
</div>
