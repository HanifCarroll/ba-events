<script lang="ts">
	import { onMount } from 'svelte';
	import { Bookmark, Calendar, Clock, ArrowLeft, Sparkles } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import { useAuthContext } from '#features/auth/hooks/auth-context.svelte.ts';
	import { getSavedEvents } from '#features/chat/lib/saved.ts';
	import EventCard from '#features/events/components/EventCard.svelte';
	import { Button } from '#shared/ui/button/index.ts';
	import type { SavedEventWithDetails } from '#shared/lib/types.ts';
	import * as m from '#paraglide/messages.js';

	const auth = useAuthContext();

	let events = $state<SavedEventWithDetails[]>([]);
	let loading = $state(true);
	let filter = $state<'upcoming' | 'past'>('upcoming');

	// Fetch saved events
	onMount(() => {
		if (auth.user) {
			loading = true;
			getSavedEvents()
				.then((result) => {
					events = result;
				})
				.catch((error) => {
					console.error('Failed to fetch saved events:', error);
					toast.error('Failed to load saved events');
				})
				.finally(() => {
					loading = false;
				});
		}
	});

	// Listen for save/unsave events to refresh the list
	onMount(() => {
		const handleSaveChange = () => {
			if (auth.user) {
				getSavedEvents().then((result) => {
					events = result;
				});
			}
		};
		window.addEventListener('event-save-changed', handleSaveChange);
		return () => window.removeEventListener('event-save-changed', handleSaveChange);
	});

	const upcomingEvents = $derived.by(() => {
		const now = new Date();
		return events.filter((event) => new Date(event.starts_at) >= now);
	});
	const pastEvents = $derived.by(() => {
		const now = new Date();
		return events.filter((event) => new Date(event.starts_at) < now);
	});

	const filteredCount = $derived(
		filter === 'upcoming' ? upcomingEvents.length : pastEvents.length
	);
	const upcomingCount = $derived(upcomingEvents.length);
	const pastCount = $derived(pastEvents.length);
</script>

{#if !auth.user}
	<!-- Guard against edge case where context hasn't synced yet -->
	<div class="h-full flex items-center justify-center">
		<div class="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
	</div>
{:else}
	<div class="h-full flex flex-col overflow-hidden">
		<!-- Decorative background elements -->
		<div class="fixed inset-0 overflow-hidden pointer-events-none">
			<div class="absolute top-1/4 -left-32 w-64 h-64 bg-primary/5 rounded-full blur-3xl"></div>
			<div class="absolute bottom-1/4 -right-32 w-96 h-96 bg-accent/5 rounded-full blur-3xl"></div>
			<!-- Art deco inspired pattern -->
			<div class="absolute top-20 right-10 w-32 h-32 opacity-[0.03]">
				<svg viewBox="0 0 100 100" class="w-full h-full">
					<path
						d="M50 0 L100 50 L50 100 L0 50 Z"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						class="text-primary"
					/>
					<path
						d="M50 20 L80 50 L50 80 L20 50 Z"
						fill="none"
						stroke="currentColor"
						stroke-width="1.5"
						class="text-primary"
					/>
					<path
						d="M50 40 L60 50 L50 60 L40 50 Z"
						fill="currentColor"
						class="text-primary"
					/>
				</svg>
			</div>
		</div>

		<!-- Header -->
		<div class="relative px-6 py-6 border-b border-border/30">
			<div class="max-w-4xl mx-auto">
				<a
					href="/"
					class="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
				>
					<ArrowLeft class="h-4 w-4" />
					{m.saved_back()}
				</a>

				<div class="flex items-start justify-between">
					<div>
						<div class="flex items-center gap-3 mb-2">
							<div class="p-2 rounded-lg bg-primary/10 border border-primary/20">
								<Bookmark class="h-5 w-5 text-primary" />
							</div>
							<h1 class="font-display text-2xl font-semibold tracking-tight">
								{m.saved_title()}
							</h1>
						</div>
						<p class="text-muted-foreground text-sm">
							{events.length === 0
								? m.saved_none()
								: events.length === 1
									? m.saved_count({ count: events.length })
									: m.saved_count_plural({ count: events.length })}
						</p>
					</div>
				</div>

				<!-- Filter tabs -->
				{#if events.length > 0}
					<div
						class="flex gap-1 mt-6 p-1 bg-card/30 rounded-lg border border-border/30 w-fit"
					>
						<button
							onclick={() => {
								filter = 'upcoming';
							}}
							class={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 ${filter === 'upcoming' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
						>
							<Calendar class="h-4 w-4" />
							{m.saved_upcoming()}
							{#if upcomingCount > 0}
								<span
									class="ml-1 px-1.5 py-0.5 rounded text-xs bg-primary/20 text-primary"
								>
									{upcomingCount}
								</span>
							{/if}
						</button>
						<button
							onclick={() => {
								filter = 'past';
							}}
							class={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 ${filter === 'past' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
						>
							<Clock class="h-4 w-4" />
							{m.saved_past()}
							{#if pastCount > 0}
								<span
									class="ml-1 px-1.5 py-0.5 rounded text-xs bg-muted-foreground/20 text-muted-foreground"
								>
									{pastCount}
								</span>
							{/if}
						</button>
					</div>
				{/if}
			</div>
		</div>

		<!-- Content -->
		<div class="relative flex-1 overflow-auto px-6 py-6">
			<div class="max-w-4xl mx-auto">
				{#if loading}
					<div class="flex flex-col items-center justify-center py-20">
						<div
							class="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mb-4"
						></div>
						<p class="text-sm text-muted-foreground">{m.saved_loading()}</p>
					</div>
				{:else if events.length === 0}
					<!-- Empty state -->
					<div class="relative text-center py-20">
						<!-- Decorative elements -->
						<div
							class="absolute inset-0 flex items-center justify-center opacity-[0.02] pointer-events-none"
						>
							<svg viewBox="0 0 200 200" class="w-80 h-80">
								<circle
									cx="100"
									cy="100"
									r="90"
									fill="none"
									stroke="currentColor"
									stroke-width="0.5"
									class="text-primary"
								/>
								<circle
									cx="100"
									cy="100"
									r="70"
									fill="none"
									stroke="currentColor"
									stroke-width="0.3"
									class="text-primary"
								/>
								<circle
									cx="100"
									cy="100"
									r="50"
									fill="none"
									stroke="currentColor"
									stroke-width="0.2"
									class="text-primary"
								/>
								<circle
									cx="100"
									cy="100"
									r="30"
									fill="none"
									stroke="currentColor"
									stroke-width="0.1"
									class="text-primary"
								/>
							</svg>
						</div>

						<div class="relative">
							<div
								class="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-primary/20 to-accent/20 border border-primary/20 mb-6"
							>
								<Bookmark class="h-10 w-10 text-primary/80" />
							</div>

							<h2 class="font-display text-2xl font-semibold mb-3">
								{m.saved_empty_title()}
							</h2>
							<p class="text-muted-foreground text-sm max-w-sm mx-auto mb-6">
								{m.saved_empty_desc()}
							</p>

							<Button
								href="/"
								class="bg-primary hover:bg-primary/90 text-primary-foreground"
							>
								<Sparkles class="mr-2 h-4 w-4" />
								{m.saved_discover()}
							</Button>

							<!-- Decorative bottom element -->
							<div class="flex items-center justify-center gap-2 mt-10">
								<div
									class="w-8 h-px bg-gradient-to-r from-transparent via-border to-transparent"
								></div>
								<div class="w-1.5 h-1.5 rounded-full bg-primary/30"></div>
								<div
									class="w-8 h-px bg-gradient-to-r from-transparent via-border to-transparent"
								></div>
							</div>
						</div>
					</div>
				{:else if filteredCount === 0}
					<div class="text-center py-16">
						<div
							class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-muted/30 mb-4"
						>
							{#if filter === 'upcoming'}
								<Calendar class="h-8 w-8 text-muted-foreground" />
							{:else}
								<Clock class="h-8 w-8 text-muted-foreground" />
							{/if}
						</div>
						<h3 class="font-display text-lg font-medium mb-2">
							{filter === 'upcoming' ? m.saved_no_upcoming() : m.saved_no_past()}
						</h3>
						<p class="text-muted-foreground text-sm max-w-sm mx-auto">
							{filter === 'upcoming'
								? m.saved_no_upcoming_desc()
								: m.saved_no_past_desc()}
						</p>
						{#if filter === 'upcoming'}
							<Button href="/" variant="outline" class="mt-4">
								{m.saved_discover()}
							</Button>
						{/if}
					</div>
				{:else}
					<div class="space-y-8 animate-fade-in-up">
						<section class="space-y-3">
							{#each (filter === 'upcoming' ? upcomingEvents : pastEvents) as event, index (event.id)}
								<EventCard
									event={event}
									position={index}
									source="saved_page"
								/>
							{/each}
						</section>
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}
