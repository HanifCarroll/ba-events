<script lang="ts">
	import {
		ArrowUp,
		ArrowUpRight,
		CalendarDays,
		MapPin,
		MessageCircle,
		Mic2,
		Search,
		Sparkles,
		Ticket
	} from 'lucide-svelte'
	import * as m from '#paraglide/messages.js'
	import type { ChatEventPayload } from '#shared/lib/types.ts'
	import LanguageSwitcher from '#shared/ui/LanguageSwitcher.svelte'
	import HappeningSoonEvents from './HappeningSoonEvents.svelte'

	let {
		onSelectPrompt,
		happeningSoonEvents = []
	}: {
		onSelectPrompt: (prompt: string, options?: { eventId?: string }) => void
		happeningSoonEvents?: ChatEventPayload[]
	} = $props()

	let landingQuery = $state('')
	let landingPage = $state<HTMLDivElement | null>(null)

	function submitQuery() {
		const prompt = landingQuery.trim()
		if (prompt) onSelectPrompt(prompt)
	}

	function startAsking() {
		landingPage?.scrollTo({ top: 0, behavior: 'smooth' })
	}
</script>

<div bind:this={landingPage} class="h-full overflow-y-auto bg-background text-foreground">
	<section class="relative isolate min-h-[760px] overflow-hidden text-white sm:min-h-[680px]">
		<img
			src="/hero-rooftop-buenos-aires.jpg"
			alt=""
			class="absolute inset-0 -z-20 h-full w-full object-cover"
		/>
		<div class="absolute inset-0 -z-10 bg-[#0b1235]/55" aria-hidden="true"></div>
		<div
			class="absolute inset-0 -z-10 bg-gradient-to-b from-[#0b1235]/25 via-[#111533]/20 to-[#080b1c]/85"
			aria-hidden="true"
		></div>

		<nav
			class="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-10"
			aria-label={m.landing_nav_label()}
		>
			<a href="/" class="flex items-center gap-2 text-base font-semibold tracking-tight sm:text-lg">
				BA Eventos
			</a>
			<div class="flex items-center gap-3 text-xs font-medium sm:gap-6 sm:text-sm">
				<a href="#how-it-works" class="hover:text-indigo-200">{m.landing_how_it_works()}</a>
				<a href="/saved" class="hidden hover:text-indigo-200 sm:inline">{m.nav_saved()}</a>
				<LanguageSwitcher compact />
				<a
					href="/login"
					class="rounded-lg border border-white/60 px-3 py-2 hover:bg-white/10 sm:px-4"
				>
					{m.auth_sign_in()}
				</a>
			</div>
		</nav>

		<div class="mx-auto flex max-w-4xl flex-col items-center px-5 pb-16 pt-16 text-center sm:pt-24">
			<h1 class="font-display max-w-[680px] text-5xl leading-[0.98] tracking-tight sm:text-7xl">
				{m.landing_title()}
			</h1>
			<p class="mt-6 max-w-2xl text-base text-white/90 sm:text-lg">
				{m.landing_subtitle()}<br />{m.landing_subtitle_second()}
			</p>
			<form
				onsubmit={(event) => {
					event.preventDefault()
					submitQuery()
				}}
				class="mt-8 flex w-full max-w-3xl items-center gap-2 rounded-2xl bg-white p-1.5 pl-4 text-foreground shadow-2xl"
			>
				<Search class="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
				<label for="landing-composer" class="sr-only">{m.landing_placeholder()}</label>
				<input
					bind:value={landingQuery}
					id="landing-composer"
					placeholder={m.landing_placeholder()}
					autocomplete="off"
					class="min-w-0 flex-1 bg-transparent px-1 py-3 text-base outline-none placeholder:text-muted-foreground sm:text-sm"
				/>
				<button
					type="submit"
					class="min-h-11 shrink-0 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 sm:px-6"
				>
					{m.landing_submit()}
				</button>
			</form>
			<div class="mt-6 flex flex-wrap justify-center gap-3">
				<button
					type="button"
					onclick={() => onSelectPrompt(m.landing_prompt_live_music())}
					class="flex min-h-11 items-center gap-2 rounded-full border border-white/70 px-4 py-2 text-sm font-medium hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
				>
					<Mic2 class="size-4" aria-hidden="true" />{m.landing_live_music()}
				</button>
				<button
					type="button"
					onclick={() => onSelectPrompt(m.landing_prompt_free_weekend())}
					class="flex min-h-11 items-center gap-2 rounded-full border border-white/70 px-4 py-2 text-sm font-medium hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
				>
					<Ticket class="size-4" aria-hidden="true" />{m.landing_free_weekend()}
				</button>
				<button
					type="button"
					onclick={() => onSelectPrompt(m.context_prompt_surprise())}
					class="flex min-h-11 items-center gap-2 rounded-full border border-white/70 px-4 py-2 text-sm font-medium hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
				>
					<Sparkles class="size-4" aria-hidden="true" />{m.home_surprise_label()}
				</button>
			</div>
			<p class="mt-7 text-sm text-white/80">{m.landing_reassurance()}</p>
		</div>
	</section>

	<main class="mx-auto max-w-7xl px-5 py-12 sm:px-10 sm:py-16">
		<HappeningSoonEvents onSelectPrompt={onSelectPrompt} initialEvents={happeningSoonEvents} />

		<section class="grid gap-10 py-16 lg:grid-cols-2 lg:items-center" aria-labelledby="ask-heading">
			<div>
				<h2 id="ask-heading" class="font-display text-4xl leading-tight sm:text-5xl">
					{m.landing_ask_title()}
				</h2>
				<p class="mt-5 max-w-lg leading-7 text-muted-foreground">{m.landing_ask_body()}</p>
				<div class="mt-8 space-y-6">
					<div class="flex gap-4">
						<MessageCircle class="mt-1 size-5 shrink-0 text-primary" aria-hidden="true" />
						<p><strong>{m.landing_capability_ask_title()}</strong><br /><span class="text-sm text-muted-foreground">{m.landing_capability_ask_body()}</span></p>
					</div>
					<div class="flex gap-4">
						<CalendarDays class="mt-1 size-5 shrink-0 text-primary" aria-hidden="true" />
						<p><strong>{m.landing_capability_details_title()}</strong><br /><span class="text-sm text-muted-foreground">{m.landing_capability_details_body()}</span></p>
					</div>
					<div class="flex gap-4">
						<MapPin class="mt-1 size-5 shrink-0 text-primary" aria-hidden="true" />
						<p><strong>{m.landing_capability_followup_title()}</strong><br /><span class="text-sm text-muted-foreground">{m.landing_capability_followup_body()}</span></p>
					</div>
				</div>
			</div>
			<div
				class="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-8"
				aria-label={m.landing_example_label()}
			>
				<div class="ml-auto max-w-[85%] rounded-xl bg-primary/10 p-4 text-sm">{m.landing_example_user()}</div>
				<div class="mt-4 max-w-[90%] rounded-xl border bg-background p-4 text-sm leading-6">
					<p>{m.landing_example_assistant()}</p>
					<div class="mt-3 rounded-lg border bg-card p-3">
						<p class="font-semibold">{m.landing_example_event_title()}</p>
						<p class="mt-1 text-xs text-muted-foreground">{m.landing_example_event_meta()}</p>
						<p class="mt-1 text-xs font-medium text-primary">{m.landing_example_event_price()}</p>
						<p class="mt-2 flex items-center gap-1 text-xs font-medium text-primary">
							{m.landing_example_details()} <ArrowUpRight class="size-3" aria-hidden="true" />
						</p>
					</div>
				</div>
				<div class="ml-auto mt-4 max-w-[70%] rounded-xl bg-primary/10 p-4 text-sm">{m.landing_example_followup()}</div>
				<div class="mt-4 max-w-[90%] rounded-xl border bg-background p-4 text-sm leading-6">{m.landing_example_directions()}</div>
				<div class="mt-4 rounded-full border px-4 py-3 text-sm text-muted-foreground">{m.landing_example_input()}</div>
			</div>
		</section>

		<section id="how-it-works" class="scroll-mt-8 py-12 text-center" aria-labelledby="how-heading">
			<h2 id="how-heading" class="font-display text-4xl">{m.landing_how_it_works()}</h2>
			<div class="mt-10 grid gap-10 md:grid-cols-3">
				<div><MessageCircle class="mx-auto size-8 text-primary" aria-hidden="true" /><h3 class="mt-4 font-semibold">1. {m.landing_step_one_title()}</h3><p class="mt-2 text-sm leading-6 text-muted-foreground">{m.landing_step_one_body()}</p></div>
				<div><CalendarDays class="mx-auto size-8 text-primary" aria-hidden="true" /><h3 class="mt-4 font-semibold">2. {m.landing_step_two_title()}</h3><p class="mt-2 text-sm leading-6 text-muted-foreground">{m.landing_step_two_body()}</p></div>
				<div><Ticket class="mx-auto size-8 text-primary" aria-hidden="true" /><h3 class="mt-4 font-semibold">3. {m.landing_step_three_title()}</h3><p class="mt-2 text-sm leading-6 text-muted-foreground">{m.landing_step_three_body()}</p></div>
			</div>
		</section>

		<section class="flex flex-col items-center py-12 text-center">
			<button
				type="button"
				onclick={startAsking}
				class="flex min-h-12 items-center gap-3 rounded-xl bg-primary px-10 py-3 font-semibold text-primary-foreground shadow-lg hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				{m.landing_cta()} <ArrowUp class="size-4" aria-hidden="true" />
			</button>
			<p class="mt-5 text-sm text-muted-foreground">{m.landing_reassurance()}</p>
		</section>
	</main>
</div>
