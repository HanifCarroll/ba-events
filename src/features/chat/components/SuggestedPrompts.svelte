<script module lang="ts">
	export type HomeTimeContext = 'tonight' | 'weekend' | null
</script>

<script lang="ts">
	import { Sparkles, Moon, CalendarDays } from 'lucide-svelte'
	import type { IconProps } from 'lucide-svelte'
	import type { SvelteComponentTyped } from 'svelte'
	import * as m from '#paraglide/messages.js'
	import type { ChatEventPayload } from '#shared/lib/types.ts'
	import { track } from '#shared/lib/analytics.ts'
	import TrendingEvents from './TrendingEvents.svelte'

	let {
		onSelectPrompt,
		trendingEvents,
		timeContext = null,
		onTimeContextChange
	}: {
		/** @param options.eventId exact event tapped (from trending cards) — hidden from chat text */
		onSelectPrompt: (prompt: string, options?: { eventId?: string }) => void
		trendingEvents?: ChatEventPayload[]
		timeContext: HomeTimeContext
		onTimeContextChange: (context: HomeTimeContext) => void
	} = $props()

	type IconComponent = typeof SvelteComponentTyped<IconProps>

	const timeOptions: Array<{
		id: 'tonight' | 'weekend'
		label: string
		icon: IconComponent
	}> = [
		{ id: 'tonight', label: m.context_tonight(), icon: Moon },
		{ id: 'weekend', label: m.context_weekend(), icon: CalendarDays }
	]

	function handleSurpriseMe() {
		const timePart =
			timeContext === 'tonight'
				? m.context_prompt_time_tonight()
				: timeContext === 'weekend'
					? m.context_prompt_time_weekend()
					: ''

		const prompt = timePart
			? m.context_prompt_time_only({ time: timePart })
			: m.context_prompt_surprise()

		track('concierge:surprise_me', { time: timeContext })
		onSelectPrompt(prompt)
	}
</script>

<div class="flex min-h-full flex-col items-center px-4 py-5 sm:px-8 sm:py-10">
	<div class="flex w-full max-w-[620px] flex-1 flex-col animate-fade-in-up">
		<div class="mb-4 flex flex-col items-center text-center sm:mb-6">
			<h1 class="text-2xl font-semibold tracking-[-0.025em] text-foreground sm:text-3xl">
				{m.home_title()}
			</h1>
		</div>

		<TrendingEvents onSelectPrompt={onSelectPrompt} initialEvents={trendingEvents} />

		<div class="mt-auto pt-4">
			<div class="rounded-xl bg-muted/45 px-3 py-3 sm:px-4">
				<div class="mb-2.5">
					<p class="text-sm font-medium text-foreground">{m.home_surprise_label()}</p>
					<p class="mt-0.5 text-xs text-muted-foreground">{m.home_surprise_hint()}</p>
				</div>
				<div class="flex flex-wrap items-center gap-2">
					{#each timeOptions as option (option.id)}
						{@const Icon = option.icon}
						{@const isSelected = timeContext === option.id}
						<button
							type="button"
							onclick={() => onTimeContextChange(isSelected ? null : option.id)}
							aria-pressed={isSelected}
							class="flex min-h-11 items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring {isSelected
								? 'border-primary/30 bg-primary/[0.07] text-primary'
								: 'border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground'}"
						>
							<Icon class="h-4 w-4" aria-hidden="true" />
							{option.label}
						</button>
					{/each}
					<button
						type="button"
						onclick={handleSurpriseMe}
						class="flex min-h-11 items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						<Sparkles class="h-4 w-4" aria-hidden="true" />
						{m.context_surprise_submit()}
					</button>
				</div>
			</div>
		</div>
	</div>
</div>
