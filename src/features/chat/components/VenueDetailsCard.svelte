<script lang="ts">
	import { MapPin, Globe, AtSign } from 'lucide-svelte'
	import { track } from '#shared/lib/analytics.ts'
	import type { VenueDetailsData } from '#shared/lib/types.ts'

	let { venue }: { venue: VenueDetailsData } = $props()

	// External hrefs are untrusted data: only http/https protocols pass through.
	function safeHref(value: string | null | undefined): string | null {
		if (!value) return null
		const trimmed = value.trim()
		return /^https?:\/\//i.test(trimmed) ? trimmed : null
	}

	const websiteHref = $derived(safeHref(venue.website))
	const instagramHref = $derived(
		safeHref(venue.instagram) ??
			(venue.instagram
				? `https://instagram.com/${(venue.instagram as string).replace(/^@/, '').trim()}`
				: null)
	)

	function trackClick(kind: 'website' | 'instagram') {
		track('chat:venue_link_opened', { venue_name: venue.venueName, kind })
	}
</script>

<div
	class="group relative overflow-hidden rounded-xl border border-primary/30 bg-gradient-to-br from-card via-card to-primary/5 shadow-md transition-all duration-300 hover:border-primary/50 hover:shadow-lg"
>
	<div class="relative p-4">
		<div class="flex items-start gap-3">
			<div class="shrink-0 p-2.5 rounded-lg bg-primary/15 border border-primary/20">
				<MapPin class="h-5 w-5 text-primary" />
			</div>
			<div class="flex-1 min-w-0">
				<h4 class="font-display font-semibold text-lg text-foreground leading-tight">
					{venue.venueName}
				</h4>
				{#if venue.neighborhood || venue.address}
					<p class="mt-1 text-sm text-muted-foreground leading-relaxed">
						{[venue.address, venue.neighborhood].filter(Boolean).join(' · ')}
					</p>
				{/if}
			</div>
		</div>

		{#if websiteHref || instagramHref}
			<div class="mt-4 flex flex-wrap gap-2">
				{#if websiteHref}
					<a
						href={websiteHref}
						target="_blank"
						rel="noopener noreferrer"
						onclick={() => trackClick('website')}
						class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-border/60 bg-card/50 hover:border-primary/30 hover:text-primary transition-all"
					>
						<Globe class="h-3.5 w-3.5" />
						Website
					</a>
				{/if}
				{#if instagramHref}
					<a
						href={instagramHref}
						target="_blank"
						rel="noopener noreferrer"
						onclick={() => trackClick('instagram')}
						class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-border/60 bg-card/50 hover:border-primary/30 hover:text-primary transition-all"
					>
						<AtSign class="h-3.5 w-3.5" />
						Instagram
					</a>
				{/if}
			</div>
		{/if}
	</div>
</div>
