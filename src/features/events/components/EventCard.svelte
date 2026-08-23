<script lang="ts">
	import {
		Calendar,
		MapPin,
		Clock,
		ExternalLink,
		Ticket,
		Info,
		Share2,
		Check
	} from 'lucide-svelte';
	import SaveEventButton from './SaveEventButton.svelte';
	import EventArtwork from './EventArtwork.svelte';
	import { Button } from '#shared/ui/button/index.ts';
	import { formatPrice } from '#features/chat/lib/messages.ts';
	import { formatShortDate, formatTime } from '#shared/lib/utils/formatting.ts';
	import { track } from '#shared/lib/analytics.ts';
	import { preloadData, pushState, goto } from '$app/navigation';
	import { page } from '$app/state';
	import { getEventUrl } from '#shared/lib/utils/url.ts';
	import { getLocale } from '#paraglide/runtime.js';
	import { pickDescriptionSummary } from '#features/events/lib/description-presentation.ts';
	import {
		getChatEventHref,
		shouldInterceptChatEventClick
	} from '#features/events/lib/event-detail-navigation.ts';
	import {
		getExternalActionKind,
		getExternalActionLabel,
		getExternalEventUrl,
		getExternalLinkType,
		getSourceLabel
	} from '#features/events/lib/source-presentation.ts';
	import type { EventWithVenue } from '#shared/lib/types.ts';
	import * as m from '#paraglide/messages.js';

	let {
		event,
		position,
		source = 'chat',
		variant = 'default',
		commentary,
		tips
	}: {
		event: EventWithVenue;
		/** Position in the list (0-indexed) for analytics */
		position?: number;
		/** Source context for analytics */
		source?: 'chat' | 'saved_page';
		/** Card variant - hero is larger, always expanded, for single recommendations */
		variant?: 'default' | 'hero';
		/** Claude's personalized commentary about why this event fits (hero variant) */
		commentary?: string;
		/** Practical tips like "get there around 10pm" (hero variant) */
		tips?: string[];
	} = $props();

	const locale = getLocale() as 'en' | 'es';
	const startDate = $derived(new Date(event.starts_at));
	const dateStr = $derived(formatShortDate(startDate));
	const timeStr = $derived(event.time_tba ? m.concierge_time_tba() : formatTime(startDate));
	const priceDisplay = $derived(formatPrice(event.price, event.is_free));
	const isFree = $derived(event.is_free || event.price === 0);
	const summaryDescription = $derived(pickDescriptionSummary(event, locale));
	const hasDescription = $derived(Boolean(summaryDescription));
	const sourceLabel = $derived(getSourceLabel(event.source));
	const placeLabel = $derived(
		event.location_hidden
			? m.event_location_hidden()
			: event.venue_name || event.venue_neighborhood || m.concierge_location_tba()
	);

	const externalUrl = $derived(getExternalEventUrl(event));
	const externalActionKind = $derived(getExternalActionKind(event.source));
	const externalActionLabel = $derived(getExternalActionLabel(externalActionKind, sourceLabel));
	const contextSegments = $derived([
		...(sourceLabel ? [sourceLabel] : []),
		...event.categories.slice(0, 2),
		...(!hasDescription ? [m.event_limited_info()] : [])
	]);

	const standaloneDetailsHref = $derived(`/events/${event.id}`);
	const detailsHref = $derived(
		source === 'chat'
			? getChatEventHref(page.url.pathname, event.id)
			: standaloneDetailsHref
	);

	let copied = $state(false);

	const handleShare = async () => {
		const shareUrl = getEventUrl(event.id);
		const shareText = event.venue_name
			? m.event_share_text_venue({ name: event.name, venue: event.venue_name })
			: m.event_share_text_no_venue({ name: event.name });

		if (navigator.share) {
			try {
				await navigator.share({ title: event.name, text: shareText, url: shareUrl });
				return;
			} catch {
				// User canceled or share failed — fall back to clipboard
			}
		}

		await navigator.clipboard.writeText(shareUrl);
		copied = true;
		setTimeout(() => {
			copied = false;
		}, 2000);
	};

	const handleExternalClick = () => {
		track('event:link_clicked', {
			event_id: event.id,
			link_type: getExternalLinkType(externalActionKind)
		});
	};

	const handleDetailsClick = async (click: MouseEvent) => {
		track('chat:event_clicked', {
			event_id: event.id,
			position,
			source
		});

		// Keep the live chat mounted for ordinary in-app chat clicks. Modified
		// clicks and saved/direct links retain normal browser/SSR navigation.
		if (!shouldInterceptChatEventClick(source, click)) return;

		click.preventDefault();
		const href = detailsHref;
		const result = await preloadData(standaloneDetailsHref);
		if (result.type === 'loaded' && result.status === 200) {
			pushState(href, {
				selectedEvent: result.data as App.PageState['selectedEvent']
			});
		} else {
			await goto(href);
		}
	};
</script>

{#if variant === 'hero'}
	<!-- ============================================================================= -->
	<!-- HERO VARIANT - The confident single recommendation -->
	<!-- ============================================================================= -->
	<div class="mt-6 pb-7">
		<div
			class={`grid gap-5 ${event.image_url ? 'sm:grid-cols-[148px_minmax(0,1fr)] sm:gap-6' : 'max-w-2xl'}`}
		>
			{#if event.image_url}
				<EventArtwork
					imageUrl={event.image_url}
					imageWidth={event.image_width}
					imageHeight={event.image_height}
					loading="eager"
					class="w-full sm:max-w-none"
				/>
			{/if}

			<div class="min-w-0">
				<div class={event.image_url ? undefined : 'flex items-start gap-3'}>
					{#if !event.image_url}
						<div
							class="mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
						>
							<Calendar class="h-5 w-5" aria-hidden="true" />
						</div>
					{/if}
					<div class="min-w-0">
						<h3
							class="text-xl font-semibold tracking-[-0.02em] text-foreground sm:text-2xl"
						>
							{event.name}
						</h3>
						{#if commentary || summaryDescription}
							<p class="mt-1.5 max-w-[58ch] text-sm leading-relaxed text-muted-foreground">
								{commentary || summaryDescription}
							</p>
						{/if}
					</div>
				</div>

				<dl class="mt-5 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
					<div class="flex items-center gap-2.5">
						<Calendar class="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
						<dd>{dateStr}</dd>
					</div>
					<div class="flex items-center gap-2.5">
						<MapPin class="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
						<dd>{event.venue_neighborhood || event.venue_name || m.concierge_location_tba()}</dd>
					</div>
					<div class="flex items-center gap-2.5">
						<Clock class="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
						<dd>{timeStr}</dd>
					</div>
					<div class="flex items-center gap-2.5">
						<Ticket class="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
						<dd>{priceDisplay}</dd>
					</div>
					{#if event.venue_name}
						<div class="flex items-center gap-2.5">
							<MapPin class="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
							<dd>{event.venue_name}</dd>
						</div>
					{/if}
				</dl>

				{#if tips && tips.length > 0}
					<p class="mt-4 text-sm text-muted-foreground">{tips[0]}</p>
				{/if}

				<div class="mt-6 flex flex-wrap items-center gap-1.5">
					<SaveEventButton
						eventId={event.id}
						eventName={event.name}
						size="sm"
						source={source}
					/>
					<a
						href={detailsHref}
						onclick={handleDetailsClick}
						class="inline-flex h-7 items-center rounded-md px-2.5 text-xs font-medium text-primary transition-colors hover:bg-primary/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						<Info class="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
						{m.concierge_event_details()}
					</a>
				</div>
			</div>
		</div>
	</div>
{:else}
	<!-- ============================================================================= -->
	<!-- DEFAULT VARIANT - The original collapsible card -->
	<!-- ============================================================================= -->
	<div class="sm:hidden">
		<!-- Mobile -->
		<article class="rounded-xl bg-card/60 px-3 py-3">
			<div class="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
				<h3 class="line-clamp-2 text-base font-medium leading-snug text-foreground">
					{event.name}
				</h3>
				<span
					class={`rounded-lg border px-2.5 py-1 text-xs font-medium tracking-wide ${isFree ? 'border-primary/20 bg-primary/15 text-primary' : 'border-border/50 bg-muted text-muted-foreground'}`}
				>
					{priceDisplay}
				</span>
			</div>

			<div class="mt-2 grid gap-1 text-xs text-muted-foreground">
				<p class="flex min-w-0 items-center gap-1.5">
					<MapPin class="h-3.5 w-3.5 shrink-0 text-primary/60" aria-hidden="true" />
					<span class="truncate">
						{event.location_hidden
							? m.event_location_hidden()
							: event.venue_name || m.concierge_location_tba()}
					</span>
				</p>
			</div>

			<div class="mt-2 flex items-center gap-2">
				<p
					class="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"
				>
					<span class="flex items-center gap-1.5">
						<Calendar class="h-3.5 w-3.5 text-primary/60" aria-hidden="true" />
						{dateStr}
					</span>
					<span class="flex items-center gap-1.5">
						<Clock class="h-3.5 w-3.5 text-primary/60" aria-hidden="true" />
						{timeStr}
					</span>
				</p>
				<div class="flex shrink-0 items-center gap-1">
					<SaveEventButton
						eventId={event.id}
						eventName={event.name}
						size="sm"
						source={source}
						className="size-9"
					/>
					<a
						href={detailsHref}
						onclick={handleDetailsClick}
						class="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-primary transition-colors hover:bg-primary/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						<Info class="h-3.5 w-3.5" aria-hidden="true" />
						<span>{m.event_details_short()}</span>
					</a>
				</div>
			</div>
		</article>
	</div>

	<div class="hidden sm:block">
		<!-- Desktop -->
		<article class="border-b border-border/40 py-4 last:border-b-0">
			<div class="flex items-baseline justify-between gap-4">
				<h3
					class="min-w-0 truncate text-[15px] font-medium tracking-[-0.01em] text-foreground"
				>
					{event.name}
				</h3>
				<span class="shrink-0 text-sm font-medium text-foreground/85">{priceDisplay}</span>
			</div>

			<p class="mt-1 flex flex-nowrap items-center gap-x-1.5 text-[13px] text-muted-foreground">
				<span class="shrink-0">{dateStr}</span>
				<span aria-hidden="true" class="text-muted-foreground/50">·</span>
				<span class="shrink-0">{timeStr}</span>
				<span aria-hidden="true" class="text-muted-foreground/50">·</span>
				<span class="min-w-0 truncate">{placeLabel}</span>
			</p>

			{#if summaryDescription}
				<p class="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
					{summaryDescription}
				</p>
			{/if}

			{#if contextSegments.length > 0}
				<p class="mt-1.5 text-xs text-muted-foreground/75">
					{#each contextSegments as segment, index (segment)}
						{#if index > 0}
							<span aria-hidden="true" class="mx-1.5 text-muted-foreground/40">·</span>
						{/if}
						{segment}
					{/each}
				</p>
			{/if}

			<div class="mt-3 flex flex-wrap items-center gap-1.5">
				<SaveEventButton
					eventId={event.id}
					eventName={event.name}
					size="sm"
					showLabel
					source={source}
				/>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onclick={handleShare}
					aria-label={copied ? m.event_copied() : m.event_share()}
					class="h-7 px-2 text-xs text-muted-foreground hover:text-primary hover:bg-primary/10"
				>
					{#if copied}
						<Check class="h-3.5 w-3.5" />
					{:else}
						<Share2 class="h-3.5 w-3.5" />
					{/if}
					<span>{copied ? m.event_copied() : m.event_share()}</span>
				</Button>
				<Button
					href={detailsHref}
					variant="ghost"
					size="sm"
					onclick={handleDetailsClick}
					class="h-7 px-2 text-xs text-muted-foreground hover:text-primary hover:bg-primary/10"
				>
					<Info class="h-3.5 w-3.5" aria-hidden="true" />
					<span>{m.event_details_short()}</span>
				</Button>
				<!-- Comparison-list external actions are quiet outlines, not filled
				primaries: transparent at rest, restrained indigo border/text,
				pale indigo hover, and the shared Button focus ring. -->
				{#if externalUrl}
					<Button
						href={externalUrl}
						target="_blank"
						rel="noopener noreferrer"
						variant="outline"
						size="sm"
						onclick={handleExternalClick}
						class="ml-auto h-7 px-2 text-xs border-primary/40 bg-transparent text-primary shadow-none hover:bg-primary/10 hover:text-primary"
					>
						<ExternalLink class="h-3.5 w-3.5" aria-hidden="true" />
						<span>{externalActionLabel}</span>
					</Button>
				{/if}
			</div>
		</article>
	</div>
{/if}
