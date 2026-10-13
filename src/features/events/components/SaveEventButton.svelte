<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { Heart } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import { useAuthContext } from '#features/auth/hooks/auth-context.svelte.ts';
	import { isEventSaved, saveEvent, unsaveEvent } from '#features/chat/lib/saved.ts';
	import { track } from '#shared/lib/analytics.ts';
	import { Button } from '#shared/ui/button/index.ts';
	import {
		Tooltip,
		TooltipContent,
		TooltipTrigger
	} from '#shared/ui/tooltip/index.ts';
	import * as m from '#paraglide/messages.js';

	let {
		eventId,
		responseId,
		eventName,
		initialSaved = false,
		onSaveChange,
		size = 'md',
		className = '',
		showLabel = false,
		source = 'chat'
	}: {
		eventId: string;
		responseId?: string;
		/** Event name for analytics tracking */
		eventName?: string;
		initialSaved?: boolean;
		onSaveChange?: (saved: boolean) => void;
		size?: 'sm' | 'md';
		className?: string;
		/** Show a text label beside the icon. */
		showLabel?: boolean;
		/** Source context for analytics */
		source?: 'chat' | 'saved_page' | 'event_detail';
	} = $props();

	const auth = useAuthContext();

	let isSaved = $state(untrack(() => initialSaved));
	let isUpdating = $state(false);

	onMount(() => {
		let cancelled = false;

		if (!auth.user) {
			isSaved = false;
			return;
		}

		void isEventSaved(eventId)
			.then((saved) => {
				if (!cancelled) {
					isSaved = saved;
				}
			})
			.catch((error) => {
				console.error('Failed to load saved state:', error);
			});

		return () => {
			cancelled = true;
		};
	});

	const handleToggle = async () => {
		if (!auth.user) return;
		if (isUpdating) return;

		isUpdating = true;
		const newSavedState = !isSaved;

		// Optimistic update
		isSaved = newSavedState;

		try {
			if (newSavedState) {
				await saveEvent(eventId);
				track('event:saved', { event_id: eventId, source, ...(responseId ? { response_id: responseId } : {}) });
			} else {
				await unsaveEvent(eventId);
				track('event:unsaved', { event_id: eventId, source, ...(responseId ? { response_id: responseId } : {}) });
			}
			onSaveChange?.(newSavedState);
		} catch (error) {
			// Revert on error
			isSaved = !newSavedState;
			console.error('Failed to update saved state:', error);
			toast.error('Failed to update saved status');
		} finally {
			isUpdating = false;
		}
	};

	const iconSize = $derived(size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4');
	const buttonSize = $derived(
		showLabel
			? size === 'sm'
				? 'h-7 px-2 text-xs'
				: 'h-9 w-full px-3'
			: size === 'sm'
				? 'h-7 w-7'
				: 'h-9 w-9'
	);
</script>

{#snippet signInButton(props: Record<string, unknown>)}
	<Button
		{...props}
		href="/login"
		variant="ghost"
		size={showLabel ? 'default' : 'icon'}
		aria-label={m.event_sign_in_to_save()}
		class={`${buttonSize} text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors ${className}`}
	>
		<Heart class={iconSize} />
		{#if showLabel}<span>{m.event_save()}</span>{/if}
	</Button>
{/snippet}

{#snippet toggleButton(props: Record<string, unknown>)}
	<Button
		{...props}
		variant="ghost"
		size={showLabel ? 'default' : 'icon'}
		onclick={handleToggle}
		disabled={isUpdating}
		aria-label={isSaved
			? showLabel ? `${m.event_saved()}: ${m.event_remove_from_saved()}` : m.event_remove_from_saved()
			: m.event_save()}
		aria-pressed={isSaved}
		class={`${buttonSize} transition-all duration-200 ${isSaved ? 'text-primary hover:text-primary/80 hover:bg-primary/10' : 'text-muted-foreground hover:text-primary hover:bg-primary/10'} ${isUpdating ? 'opacity-50' : ''} ${className}`}
	>
		<Heart
			class={`${iconSize} transition-all duration-200 ${isSaved ? 'fill-current scale-110' : ''}`}
		/>
		{#if showLabel}<span>{isSaved ? m.event_saved() : m.event_save()}</span>{/if}
	</Button>
{/snippet}

{#if auth.loading}
	<Button
		variant="ghost"
		size={showLabel ? 'default' : 'icon'}
		disabled
		aria-label={m.event_loading_saved()}
		class={`${buttonSize} text-muted-foreground/50 ${className}`}
	>
		<Heart class={iconSize} />
		{#if showLabel}<span>{m.event_save()}</span>{/if}
	</Button>
{:else if !auth.user}
	{#if showLabel}
		{@render signInButton({})}
	{:else}
		<Tooltip>
			<TooltipTrigger>
				{#snippet child({ props })}
					{@render signInButton(props)}
				{/snippet}
			</TooltipTrigger>
			<TooltipContent side="top">
				<p class="text-xs">{m.event_sign_in_to_save()}</p>
			</TooltipContent>
		</Tooltip>
	{/if}
{:else if showLabel}
	{@render toggleButton({})}
{:else}
	<Tooltip>
		<TooltipTrigger>
			{#snippet child({ props })}
				{@render toggleButton(props)}
			{/snippet}
		</TooltipTrigger>
		<TooltipContent side="top">
			<p class="text-xs">{isSaved ? m.event_remove_from_saved() : m.event_save()}</p>
		</TooltipContent>
	</Tooltip>
{/if}
