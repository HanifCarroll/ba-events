<script lang="ts">
	import { onMount } from 'svelte'
	import { gsap } from 'gsap'
	import { ScrollTrigger } from 'gsap/ScrollTrigger'
	import {
		ArrowUp,
		ArrowUpRight,
		CalendarDays,
		Mic,
		MapPin,
		MessageCircle,
		Mic2,
		Search,
		Sparkles,
		Ticket,
		User,
		Send
	} from 'lucide-svelte'
	import * as m from '#paraglide/messages.js'
	import { toast } from 'svelte-sonner'
	import { getLocale } from '#paraglide/runtime.js'
	import {
		createSpeechRecognition,
		ensureOnDeviceLanguagePack,
		getRecognitionMode,
		type RecognitionMode,
		type SpeechRecognitionLike
	} from '#features/chat/lib/speech-recognition.ts'
	import type { HomeEventFeed } from '#features/events/lib/home-feed.ts'
	import LanguageSwitcher from '#shared/ui/LanguageSwitcher.svelte'
	import InstallApp from '#shared/ui/InstallApp.svelte'
	import {
		DropdownMenu,
		DropdownMenuContent,
		DropdownMenuItem,
		DropdownMenuSeparator,
		DropdownMenuTrigger
	} from '#shared/ui/dropdown-menu/index.ts'
	import { useAuthContext, getAuthState } from '#features/auth/hooks/auth-context.svelte.ts'
	import { signOut } from '#features/auth/api/auth.remote.ts'
	import { goto } from '$app/navigation'
	import { track } from '#shared/lib/analytics.ts'
	import HappeningSoonEvents from './HappeningSoonEvents.svelte'

	let {
		onSelectPrompt,
		happeningSoonEvents = []
	}: {
		onSelectPrompt: (prompt: string, options?: { eventId?: string }) => void
		happeningSoonEvents?: HomeEventFeed
	} = $props()

	const auth = useAuthContext()
	let landingQuery = $state('')
	let landingPage = $state<HTMLDivElement | null>(null)
	let landingInput = $state<HTMLTextAreaElement | null>(null)
	let isSigningOut = $state(false)
	let isSupported = $state(false)
	let modeRef: RecognitionMode = 'cloud'
	let isListening = $state(false)
	let recognitionRef: SpeechRecognitionLike | null = null
	let baseValueRef = ''
	let committedTranscriptRef = ''

	const getRecognitionLang = () => (getLocale() === 'es' ? 'es-AR' : 'en-US')

	function startRecognition(recognition: SpeechRecognitionLike, base: string) {
		recognitionRef = recognition
		baseValueRef = base
		committedTranscriptRef = ''

		recognition.onresult = (event) => {
			let interim = ''
			let committed = committedTranscriptRef
			for (let i = event.resultIndex; i < event.results.length; i++) {
				const result = event.results[i]
				if (result.isFinal) committed += result[0].transcript
				else interim += result[0].transcript
			}
			committedTranscriptRef = committed
			landingQuery = [baseValueRef, committed, interim].filter(Boolean).join(' ')
			requestAnimationFrame(resizeLandingInput)
		}

		recognition.onerror = (event) => {
			if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
				toast.error(m.chat_dictate_permission())
			} else if (event.error === 'language-not-supported') {
				recognition.abort()
				const fallback = createSpeechRecognition(getRecognitionLang(), 'cloud')
				if (fallback) startRecognition(fallback, baseValueRef)
			}
		}

		recognition.onend = () => {
			isListening = false
			if (recognitionRef === recognition) recognitionRef = null
		}

		recognition.start()
		isListening = true
	}

	async function handleMicClick() {
		if (!isSupported) return
		if (isListening) {
			recognitionRef?.stop()
			return
		}

		const lang = getRecognitionLang()
		let effectiveMode: RecognitionMode = modeRef
		if (modeRef === 'on-device') {
			const { ok, fallbackToCloud } = await ensureOnDeviceLanguagePack(lang)
			if (!ok && !fallbackToCloud) {
				toast.error(m.chat_dictate_install_error())
				return
			}
			effectiveMode = ok ? 'on-device' : 'cloud'
		}

		const recognition = createSpeechRecognition(lang, effectiveMode)
		if (recognition) startRecognition(recognition, landingQuery)
	}

	async function handleSignOut() {
		isSigningOut = true
		try {
			await signOut()
			const state = getAuthState()
			state.user = null
			state.profile = null
			await goto('/')
		} catch (err) {
			console.error('Sign out error:', err)
		} finally {
			isSigningOut = false
		}
	}

	function submitQuery() {
		const prompt = landingQuery.trim()
		if (prompt) onSelectPrompt(prompt)
	}

	function handleComposerKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
			event.preventDefault()
			submitQuery()
		}
	}

	function resizeLandingInput() {
		if (!landingInput || window.matchMedia('(min-width: 640px)').matches) return
		landingInput.style.height = 'auto'
		landingInput.style.height = `${landingInput.scrollHeight}px`
	}

	function startAsking() {
		landingPage?.scrollTo({ top: 0, behavior: 'smooth' })
	}

	$effect(() => {
		const mode = getRecognitionMode()
		modeRef = mode
		isSupported = mode !== 'unsupported'
	})

	$effect(() => {
		return () => recognitionRef?.abort()
	})

	onMount(() => {
		const root = landingPage
		if (!root) return
		landingInput?.focus({ preventScroll: true })

		gsap.registerPlugin(ScrollTrigger)
		const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
		const context = gsap.context(() => {
			const revealItems = root.querySelectorAll('[data-reveal]')
			const prompts = [
				m.landing_placeholder(),
				m.landing_placeholder_2(),
				m.landing_placeholder_3(),
				m.landing_placeholder_4(),
				m.landing_placeholder_5()
			]
			const input = landingInput

			if (reduceMotion) {
				gsap.set(revealItems, { clearProps: 'all' })
				input?.setAttribute('placeholder', prompts[0])
				return
			}

			if (input) {
				const progress = { value: 0 }
				const typewriter = gsap.timeline({ repeat: -1, defaults: { ease: 'none' } })
				const setPlaceholder = (text: string) => {
					input.setAttribute('placeholder', text.slice(0, Math.round(progress.value * text.length)))
				}

				for (const prompt of prompts) {
					typewriter.to({}, { duration: 2 })
					typewriter.to(progress, {
						value: 1,
						duration: prompt.length * 0.045,
						onUpdate: () => setPlaceholder(prompt)
					})
					typewriter.to({}, { duration: 3 })
					typewriter.to(progress, {
						value: 0,
						duration: prompt.length * 0.045,
						onUpdate: () => setPlaceholder(prompt)
					})
				}
			}

			gsap.set(revealItems, { opacity: 0, y: 24 })

			const reveal = (selector: string, trigger: string, start = 'top 82%') => {
				gsap.to(selector, {
					opacity: 1,
					y: 0,
					duration: 0.8,
					ease: 'power3.out',
					stagger: 0.12,
					scrollTrigger: { trigger, scroller: root, start, once: true }
				})
			}

			reveal('[data-reveal="explanation"]', '[data-reveal="explanation"]')
			reveal('[data-reveal="steps"], [data-reveal="steps-heading"], [data-reveal="step"]', '[data-reveal="steps"]')
			reveal('[data-reveal="cta"]', '[data-reveal="cta"]', 'top 88%')
		}, root)

		return () => context.revert()
	})
</script>

<div bind:this={landingPage} class="h-full overflow-y-auto scroll-smooth bg-background text-foreground">
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
			data-hero-motion="nav"
			class="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-10"
			aria-label={m.landing_nav_label()}
		>
			<a href="/" class="flex items-center gap-2 text-base font-semibold tracking-tight sm:text-lg">
				BA Eventos
			</a>
			<div class="flex items-center gap-2 text-xs font-medium sm:gap-4 sm:text-sm">
				<a href="#what-it-does" class="hidden hover:text-indigo-200 sm:inline">{m.landing_what_it_does()}</a>
				<a href="#how-it-works" class="hidden hover:text-indigo-200 sm:inline">{m.landing_how_it_works()}</a>
				<LanguageSwitcher compact />
				<InstallApp compact class="border border-white/60 px-2.5 py-2 text-white hover:bg-white/10 sm:px-3" />
				{#if auth.user}
					<DropdownMenu>
						<DropdownMenuTrigger>
							{#snippet child({ props })}
								<button
									{...props}
									type="button"
									class="flex min-h-10 items-center gap-1 rounded-lg border border-white/60 px-2.5 py-2 hover:bg-white/10 sm:px-3"
								>
									<User class="size-4" aria-hidden="true" />
									<span>{m.nav_account()}</span>
								</button>
							{/snippet}
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" class="w-48">
							<DropdownMenuItem
								onclick={() => goto('/saved')}
								class="cursor-pointer hover:bg-primary/10 hover:text-primary focus:bg-primary/10 focus:text-primary"
							>
								{m.nav_my_saved_events()}
							</DropdownMenuItem>
							<DropdownMenuItem
								onclick={() => goto('/profile')}
								class="cursor-pointer hover:bg-primary/10 hover:text-primary focus:bg-primary/10 focus:text-primary"
							>
								{m.nav_settings()}
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							<DropdownMenuItem
								onclick={handleSignOut}
								disabled={isSigningOut}
								class="cursor-pointer hover:bg-primary/10 hover:text-primary focus:bg-primary/10 focus:text-primary"
							>
								{isSigningOut ? m.auth_signing_out() : m.auth_sign_out()}
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				{:else}
					<a
						href="/login"
						class="rounded-lg border border-white/60 px-3 py-2 hover:bg-white/10 sm:px-4"
					>
						{m.auth_sign_in()}
					</a>
				{/if}
			</div>
		</nav>

		<div data-hero-motion="content" class="mx-auto flex max-w-4xl flex-col items-center px-5 pb-16 pt-16 text-center sm:pt-24">
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
				class="mt-8 flex w-full max-w-3xl flex-col gap-0 rounded-2xl bg-white p-3 text-foreground shadow-2xl sm:flex-row sm:items-center sm:gap-2 sm:p-1.5 sm:pl-4"
			>
				<Search class="hidden size-5 shrink-0 text-muted-foreground sm:block" aria-hidden="true" />
				<label for="landing-composer" class="sr-only">{m.landing_placeholder()}</label>
				<textarea
					bind:this={landingInput}
					bind:value={landingQuery}
					id="landing-composer"
					placeholder=""
					autocomplete="off"
					onkeydown={handleComposerKeydown}
					oninput={resizeLandingInput}
					rows="1"
					class="min-h-11 w-full min-w-0 resize-none overflow-x-hidden bg-transparent px-1 py-2 text-base leading-6 outline-none placeholder:text-muted-foreground sm:!h-11 sm:min-h-11 sm:flex-1 sm:overflow-hidden sm:py-3 sm:text-sm"
				></textarea>
				<div class="flex items-center justify-between gap-2 sm:contents">
					<button
						type="button"
						onclick={handleMicClick}
						disabled={!isSupported}
						aria-label={isListening ? m.chat_stop_dictating() : m.chat_dictate()}
						aria-pressed={isListening}
						title={!isSupported ? m.chat_dictate_unsupported() : undefined}
						class="flex min-h-11 min-w-11 items-center justify-center rounded-xl transition-colors {isListening
							? 'bg-red-500/15 text-red-500'
							: 'text-muted-foreground hover:bg-primary/10 hover:text-primary'} disabled:cursor-not-allowed disabled:text-muted-foreground/40"
					>
						<Mic class="size-5" aria-hidden="true" />
						<span class="sr-only">{isListening ? m.chat_stop_dictating() : m.chat_dictate()}</span>
					</button>
					<button
						type="submit"
						class="min-h-11 shrink-0 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 sm:px-6"
					>
						{m.landing_submit()}
					</button>
				</div>
			</form>
			<div data-hero-motion="actions" class="mt-6 flex flex-wrap justify-center gap-3">
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
			<p data-hero-motion="reassurance" class="mt-7 text-sm text-white/80">{m.landing_reassurance()}</p>
			<a
				href="https://t.me/BAEventosBot?start=website"
				target="_blank"
				rel="noopener noreferrer"
				onclick={() => track('telegram:link_clicked', { source: 'homepage' })}
				class="mt-3 inline-flex min-h-11 flex-col items-center justify-center gap-0.5 text-sm text-white/80 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
			>
				<span class="inline-flex items-center gap-2 font-medium">
					<Send class="size-4" aria-hidden="true" />
					{m.telegram_use_bot()}
				</span>
				<span class="text-xs text-white/60">{m.telegram_start_description()}</span>
				<span class="sr-only">{m.telegram_external_link()}</span>
			</a>
		</div>
	</section>

	<div class="mx-auto max-w-7xl px-5 py-12 sm:px-10 sm:py-16">
		<HappeningSoonEvents onSelectPrompt={onSelectPrompt} initialEvents={happeningSoonEvents} />

		<section id="what-it-does" data-reveal="explanation" class="scroll-mt-8 grid gap-10 py-16 lg:grid-cols-2 lg:items-center" aria-labelledby="ask-heading">
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

		<section id="how-it-works" data-reveal="steps" class="scroll-mt-8 py-12 text-center" aria-labelledby="how-heading">
			<h2 id="how-heading" data-reveal="steps-heading" class="font-display text-4xl">{m.landing_how_it_works()}</h2>
			<div class="mt-10 grid gap-10 md:grid-cols-3">
				<div data-reveal="step"><MessageCircle class="mx-auto size-8 text-primary" aria-hidden="true" /><h3 class="mt-4 font-semibold">1. {m.landing_step_one_title()}</h3><p class="mt-2 text-sm leading-6 text-muted-foreground">{m.landing_step_one_body()}</p></div>
				<div data-reveal="step"><CalendarDays class="mx-auto size-8 text-primary" aria-hidden="true" /><h3 class="mt-4 font-semibold">2. {m.landing_step_two_title()}</h3><p class="mt-2 text-sm leading-6 text-muted-foreground">{m.landing_step_two_body()}</p></div>
				<div data-reveal="step"><Ticket class="mx-auto size-8 text-primary" aria-hidden="true" /><h3 class="mt-4 font-semibold">3. {m.landing_step_three_title()}</h3><p class="mt-2 text-sm leading-6 text-muted-foreground">{m.landing_step_three_body()}</p></div>
			</div>
		</section>

		<section data-reveal="cta" class="flex flex-col items-center py-12 text-center">
			<button
				type="button"
				onclick={startAsking}
				class="flex min-h-12 items-center gap-3 rounded-xl bg-primary px-10 py-3 font-semibold text-primary-foreground shadow-lg hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				{m.landing_cta()} <ArrowUp class="size-4" aria-hidden="true" />
			</button>
			<p class="mt-5 text-sm text-muted-foreground">{m.landing_reassurance()}</p>
			<a
				href="/mcp"
				onclick={() => track('mcp:signpost_clicked', { source: 'homepage' })}
				class="mt-8 inline-flex min-h-11 items-center text-sm text-muted-foreground underline decoration-border underline-offset-4 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				{m.mcp_signpost()}
			</a>
		</section>
	</div>
</div>

<style>
	@keyframes hero-enter {
		from {
			opacity: 0;
			transform: translateY(18px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@media (prefers-reduced-motion: no-preference) {
		[data-hero-motion] {
			animation: hero-enter 800ms cubic-bezier(0.22, 1, 0.36, 1) both;
		}

		[data-hero-motion='content'] {
			animation-delay: 100ms;
		}

		[data-hero-motion='actions'] {
			animation-delay: 200ms;
		}

		[data-hero-motion='reassurance'] {
			animation-delay: 300ms;
		}
	}
</style>
