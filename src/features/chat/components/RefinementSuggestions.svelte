<script lang="ts">
	import { Moon, Calendar, Ticket, MapPin, Sparkles } from 'lucide-svelte'
	import type { IconProps } from 'lucide-svelte'
	import type { SvelteComponentTyped } from 'svelte'
	import { cn } from '#shared/lib/utils/index.ts'
	import type { RefinementSuggestion } from '#shared/lib/types.ts'

	// lucide-svelte v1 ships Svelte 4-style class components, so the map is
	// typed as the component constructor rather than Svelte 5's `Component`.
	type IconComponent = typeof SvelteComponentTyped<IconProps>

	const iconMap: Record<string, IconComponent> = {
		moon: Moon,
		calendar: Calendar,
		ticket: Ticket,
		'map-pin': MapPin,
		sparkles: Sparkles
	}

	let {
		suggestions,
		onSelect,
		disabled = false
	}: {
		suggestions: RefinementSuggestion[]
		onSelect: (prompt: string) => void
		disabled?: boolean
	} = $props()
</script>

{#if suggestions.length > 0}
	<div class="mt-4 flex flex-wrap gap-1.5 animate-fade-in-up">
		{#each suggestions as suggestion (suggestion.id)}
			{@const Icon = suggestion.icon ? iconMap[suggestion.icon] : null}
			<button
				type="button"
				onclick={() => onSelect(suggestion.prompt)}
				{disabled}
				class={cn(
					'inline-flex items-center gap-1.5 px-2 py-1.5',
					'text-xs font-medium rounded-full',
					'border border-border/50 bg-card/50',
					'hover:border-primary/30 hover:bg-card hover:text-primary',
					'transition-all duration-200',
					'disabled:opacity-50 disabled:cursor-not-allowed'
				)}
			>
				{#if Icon}
					<Icon class="h-3 w-3" />
				{/if}
				{suggestion.label}
			</button>
		{/each}
	</div>
{/if}
