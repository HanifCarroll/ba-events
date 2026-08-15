<script lang="ts">
	import { browser } from '$app/env';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import {
		ArrowLeft,
		Calendar,
		MapPin,
		ExternalLink,
		Share2,
		Check,
		Ticket
	} from 'lucide-svelte';
	import SaveEventButton from '#features/events/components/SaveEventButton.svelte';
	import { renderMarkdown } from '#features/events/lib/render-markdown.ts';
	import { Button } from '#shared/ui/button/index.ts';
	import { Badge } from '#shared/ui/badge/index.ts';
	import { formatEventTime, formatShortDate, formatTime } from '#shared/lib/utils/formatting.ts';
	import { getEventUrl, resolveSiteUrl } from '#shared/lib/utils/url.ts';
	import { openMapsUrl } from '#shared/lib/utils/maps.ts';
	import { track } from '#shared/lib/analytics.ts';
	import { getLocale } from '#paraglide/runtime.js';
	import { pickDisplayDescription } from '#features/events/lib/description-presentation.ts';
	import {
		getExternalActionKind,
		getExternalActionLabel,
		getExternalEventUrl,
		getExternalLinkType,
		getSourceLabel
	} from '#features/events/lib/source-presentation.ts';
	import { getDistinctVenueAddress } from '#features/events/lib/location-presentation.ts';
	import { buildEventSummary, formatCategoryLabel } from '#features/events/lib/event-summary.ts';
	import * as m from '#paraglide/messages.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const event = $derived(data.event);
	const locale = getLocale() as 'en' | 'es';
	const fromChat = $derived(page.url.searchParams.get('from') === 'chat');

	const startDate = $derived(new Date(event.starts_at));
	const dateStr = $derived(formatShortDate(startDate));
	const timeStr = $derived(event.time_tba ? m.concierge_time_tba() : formatTime(startDate));

	const externalEventUrl = $derived(getExternalEventUrl(event));

	const mapUrl = $derived.by(() => {
		if (event.location_hidden) return null;
		const address = event.venue_address || event.venue_name;
		if (!address) return null;
		return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${address}, Buenos Aires, Argentina`)}`;
	});

	const shareUrl = $derived(getEventUrl(event.id));
	const displayDescription = $derived(pickDisplayDescription(event, locale));
	const hasDescription = $derived(Boolean(displayDescription?.trim()));
	const sourceLabel = $derived(getSourceLabel(event.source));
	const externalActionKind = $derived(getExternalActionKind(event.source));
	const sourceCtaLabel = $derived(
		getExternalActionLabel(externalActionKind, sourceLabel)
	);
	const distinctVenueAddress = $derived(
		getDistinctVenueAddress(event.venue_name, event.venue_address)
	);
	const priceDisplay = $derived(
		event.is_free
			? m.event_free()
			: event.price === null
				? null
				: `$${event.price.toLocaleString('es-AR')} ARS`
	);
	const hasKnownPrice = $derived(event.is_free || event.price !== null);

	let copied = $state(false);

	const handleShare = async () => {
		if (navigator.share) {
			try {
				await navigator.share({
					title: event.name,
					text: buildEventSummary(event, locale),
					url: shareUrl
				});
				track('event:shared', {
					event_id: event.id,
					event_name: event.name,
					share_method: 'native'
				});
				return;
			} catch {
				// fall back to clipboard
			}
		}

		await navigator.clipboard.writeText(shareUrl);
		copied = true;
		track('event:shared', {
			event_id: event.id,
			event_name: event.name,
			share_method: 'clipboard'
		});
		setTimeout(() => {
			copied = false;
		}, 2000);
	};

	const handleExternalLink = () => {
		if (!externalEventUrl) return;
		track('event:link_clicked', {
			event_id: event.id,
			event_name: event.name,
			link_type: getExternalLinkType(externalActionKind)
		});
		window.open(externalEventUrl, '_blank', 'noopener,noreferrer');
	};

	const handleBackToChat = () => {
		if (browser && history.length > 1) {
			history.back();
			return;
		}

		void goto('/');
	};
</script>

<svelte:head>
	<title>{data.meta.title}</title>
	<meta name="description" content={data.meta.description} />
	<meta property="og:type" content="event" />
	<meta property="og:title" content={data.event.name} />
	<meta property="og:description" content={data.meta.description} />
	<meta property="og:image" content={data.meta.imageUrl} />
	<meta property="og:url" content={data.meta.eventUrl} />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={data.event.name} />
	<meta name="twitter:description" content={data.meta.description} />
	<meta name="twitter:image" content={data.meta.imageUrl} />
	<link rel="canonical" href={data.meta.eventUrl} />
	<script type="application/ld+json">
		{JSON.stringify(data.meta.jsonLd)}
	</script>
</svelte:head>

<div class="h-full overflow-y-auto">
	<div class="fixed inset-0 overflow-hidden pointer-events-none">
		<div class="absolute top-24 -left-32 w-64 h-64 bg-primary/5 rounded-full blur-3xl"></div>
		<div class="absolute bottom-24 -right-32 w-96 h-96 bg-accent/5 rounded-full blur-3xl"></div>
	</div>

	<div class="relative px-5 py-5 sm:px-6 sm:py-6">
		<div class="mx-auto max-w-4xl">
			{#if fromChat}
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onclick={handleBackToChat}
					class="-ml-3 mb-5 min-h-11 text-muted-foreground hover:bg-primary/10 hover:text-primary"
				>
					<ArrowLeft class="h-4 w-4" aria-hidden="true" />
					{m.event_back_to_chat()}
				</Button>
			{/if}

			<div
				class={event.image_url
					? 'grid gap-6 md:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)] md:items-start md:gap-8'
					: 'max-w-2xl'}
			>
				{#if event.image_url}
					<div class="flex items-start justify-center">
						<img
							src={resolveSiteUrl(event.image_url)}
							alt={event.name}
							class="block h-auto max-h-[60vh] max-w-full rounded-2xl w-auto"
							loading="lazy"
						/>
					</div>
				{/if}

				<section class="min-w-0 space-y-5" aria-labelledby="event-title">
					<div class="space-y-3">
						<div class="flex flex-wrap items-center gap-2 text-xs">
							{#if sourceLabel}
								<Badge class="bg-muted text-muted-foreground border-border/60">
									{sourceLabel}
								</Badge>
							{/if}
							{#if !hasDescription}
								<Badge class="bg-amber-500/10 text-amber-600 border-amber-500/20">
									{m.event_limited_info()}
								</Badge>
							{/if}
							{#each event.categories as category (category)}
								<Badge class="bg-primary/10 text-primary/90 border-primary/20">
									{formatCategoryLabel(category)}
								</Badge>
							{/each}
						</div>

						<h1
							id="event-title"
							class="text-balance text-2xl font-semibold leading-[1.08] tracking-[-0.035em] text-foreground"
						>
							{event.name}
						</h1>
					</div>

					<dl class="space-y-3 text-sm text-muted-foreground">
						<div class="flex items-start gap-3">
							<Calendar class="mt-0.5 h-4 w-4 shrink-0 text-primary/70" aria-hidden="true" />
							<dd>
								{event.time_tba
									? `${dateStr} · ${timeStr}`
									: formatEventTime(event.starts_at, event.ends_at)}
							</dd>
						</div>

						{#if event.location_hidden || event.venue_name || event.venue_neighborhood}
							<div class="flex items-start gap-3">
								<MapPin class="mt-0.5 h-4 w-4 shrink-0 text-primary/70" aria-hidden="true" />
								<dd class="min-w-0">
									{#if event.location_hidden}
										{m.event_location_hidden()}
									{:else}
										<span class="block text-foreground/90">
											{event.venue_name || event.venue_neighborhood}
										</span>
										{#if distinctVenueAddress}
											<span class="mt-0.5 block">{distinctVenueAddress}</span>
										{/if}
									{/if}
								</dd>
							</div>
						{/if}

						{#if hasKnownPrice}
							<div class="flex items-start gap-3">
								<Ticket class="mt-0.5 h-4 w-4 shrink-0 text-primary/70" aria-hidden="true" />
								<dd>{priceDisplay}</dd>
							</div>
						{/if}
					</dl>

					<div class="space-y-2.5">
						<Button
							type="button"
							size="lg"
							disabled={!externalEventUrl}
							onclick={handleExternalLink}
							class="min-h-11 w-full"
						>
							<ExternalLink class="h-4 w-4" />
							{sourceCtaLabel}
						</Button>

						<div class="grid grid-cols-3 gap-2">
							<SaveEventButton
								eventId={event.id}
								eventName={event.name}
								source="event_detail"
								showLabel
								className="border border-border/60 bg-background/50 text-muted-foreground hover:border-primary/30"
							/>
							<Button
								type="button"
								variant="ghost"
								onclick={handleShare}
								aria-label={copied ? m.event_copied() : m.event_share()}
								class="h-9 min-w-0 border border-border/60 bg-background/50 px-2 text-muted-foreground hover:border-primary/30 hover:text-primary"
							>
								{#if copied}
									<Check class="h-4 w-4" />
								{:else}
									<Share2 class="h-4 w-4" />
								{/if}
								<span class="truncate">{copied ? m.event_copied() : m.event_share()}</span>
							</Button>
							<Button
								type="button"
								variant="ghost"
								disabled={!mapUrl}
								onclick={() => mapUrl && openMapsUrl(mapUrl)}
								aria-label={m.event_open_maps()}
								class="h-9 min-w-0 border border-border/60 bg-background/50 px-2 text-muted-foreground hover:border-primary/30 hover:text-primary"
							>
								<MapPin class="h-4 w-4" />
								<span class="truncate">{m.event_maps()}</span>
							</Button>
						</div>
					</div>
				</section>
			</div>

			{#if hasDescription}
				<div class="mt-6 rounded-2xl border border-border/30 bg-card p-5 sm:p-6 space-y-4">
					<div
						use:renderMarkdown={displayDescription}
						class="mx-auto max-w-[70ch] text-sm prose prose-sm prose-warm leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:my-3 [&_ul]:my-3 [&_ol]:my-3 [&_strong]:text-foreground [&_strong]:font-semibold"
					></div>
				</div>
			{/if}
		</div>
	</div>
</div>
