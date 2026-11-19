<script lang="ts">
	import { onMount } from 'svelte'
	import { gsap } from 'gsap'
	import { ArrowUp, CalendarDays, Camera, LogIn, Mic, Search, Sparkles, Ticket, User, Send } from 'lucide-svelte'
	import * as m from '#paraglide/messages.js'
	import { toast } from 'svelte-sonner'
	import { getLocale } from '#paraglide/runtime.js'
	import { useSpeech } from '#features/chat/lib/speech.svelte.ts'
	import { parseHomeFilter, type HomeAgendaPage, type HomeAgendaEvent, type HomeViewPage } from '#features/events/lib/home-feed.ts'
	import HomeAgenda from '#features/events/components/HomeAgenda.svelte'
	import HomeFlyerCollage from '#features/events/components/HomeFlyerCollage.svelte'
	import BrandLogo from '#shared/ui/BrandLogo.svelte'
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
	import { goto, invalidate } from '$app/navigation'
	import { page } from '$app/state'
	import { track } from '#shared/lib/analytics.ts'

	let {
		onSelectPrompt,
		homeAgenda = null
	}: {
		onSelectPrompt: (prompt: string, options: { eventId?: string; happeningSoonEventIds: string[] }) => void
		homeAgenda?: HomeAgendaPage | null
	} = $props()

	const auth = useAuthContext()
	let landingQuery = $state('')
	let promptedEvent: { id: string; prompt: string } | null = null
	const url = $derived(new URL(page.url.href))
	const filter = $derived(parseHomeFilter(url.searchParams.get('f')))
	const view: HomeViewPage = $derived(homeAgenda?.view ?? { events: [], empty: 'feed', total: 0 })
	const flyers = $derived(homeAgenda?.flyers ?? [])
	let refreshPending = false
	let refreshAt = Infinity
	let scroller = $state<HTMLDivElement>()
	let headline = $state<HTMLHeadingElement>()
	let showBackToTop = $state(false)
	let composerInView = $state(false)
	const instagram = 'https://www.instagram.com/baeventos.app/'
	let landingInput = $state<HTMLTextAreaElement | null>(null)
	let isSigningOut = $state(false)
	const speech = useSpeech({
		getLanguage: () => (getLocale() === 'es' ? 'es-AR' : 'en-US'),
		getText: () => landingQuery,
		onTranscript: (text) => {
			landingQuery = text
			requestAnimationFrame(resizeLandingInput)
		},
		onFailure: (failure) => {
			if (failure === 'permission') toast.error(m.chat_dictate_permission())
			else if (failure === 'language-pack') toast.error(m.chat_dictate_install_error())
		}
	})
	const speechState = speech.snapshot
	const isSupported = $derived(!$speechState.matches('uninitialized') && !$speechState.matches('unsupported'))
	const isListening = $derived($speechState.matches('recognizing') || $speechState.matches('preparing'))
	const handleMicClick = speech.toggle

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

	async function refreshAgendaIfDue() {
		if (Date.now() < refreshAt || document.hidden || refreshPending) return
		refreshPending = true
		try {
			await invalidate('ba:home-agenda')
		} finally {
			refreshPending = false
		}
	}

	$effect(() => {
		if (!homeAgenda) return
		const delay = homeAgenda.refreshInMs
		refreshAt = Date.now() + delay
		const timeout = window.setTimeout(() => {
			refreshAt = 0
			void refreshAgendaIfDue()
		}, delay)
		return () => {
			window.clearTimeout(timeout)
			refreshAt = Infinity
		}
	})

	function updateBackToTop() {
		if (scroller) showBackToTop = scroller.scrollTop > 2 * scroller.clientHeight
	}

	function watchComposer(section: HTMLElement) {
		const observer = new IntersectionObserver(([entry]) => { composerInView = entry.isIntersecting })
		observer.observe(section)
		return () => observer.disconnect()
	}

	function backToTop() {
		headline?.focus({ preventScroll: true })
		scroller?.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
	}

	function sendPrompt(prompt: string, eventId?: string) {
		const happeningSoonEventIds = view.events.slice(0, 4).map(({ id }) => id)
		onSelectPrompt(prompt, { eventId, happeningSoonEventIds })
	}

	function submitQuery() {
		const prompt = landingQuery.trim()
		if (prompt) {
			speech.cancel()
			sendPrompt(prompt, promptedEvent?.prompt === prompt ? promptedEvent.id : undefined)
		}
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

	function askAbout(event: HomeAgendaEvent) {
		const prompt = m.home_happening_soon_prompt({ name: event.name })
		promptedEvent = { id: event.id, prompt }
		speech.cancel()
		landingQuery = prompt
		landingInput?.focus({ preventScroll: true })
		landingInput?.scrollIntoView({ block: 'center' })
		requestAnimationFrame(resizeLandingInput)
	}

	onMount(() => {
		const input = landingInput
		if (!input || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
		const prompts = [m.landing_placeholder(), m.landing_placeholder_2(), m.landing_placeholder_3(),
			m.landing_placeholder_4(), m.landing_placeholder_5()]
		const progress = { value: 0 }
		const typewriter = gsap.timeline({ repeat: -1, defaults: { ease: 'none' } })
		for (const prompt of prompts) {
			const setPlaceholder = () => {
				input.setAttribute('placeholder', prompt.slice(0, Math.round(progress.value * prompt.length)))
			}
			typewriter.to({}, { duration: 2 })
			typewriter.to(progress, { value: 1, duration: prompt.length * 0.045, onUpdate: setPlaceholder })
			typewriter.to({}, { duration: 3 })
			typewriter.to(progress, { value: 0, duration: prompt.length * 0.045, onUpdate: setPlaceholder })
		}
		return () => { typewriter.kill() }
	})
</script>

<svelte:window onfocus={refreshAgendaIfDue} />
<svelte:document onvisibilitychange={refreshAgendaIfDue} />

<div bind:this={scroller} onscroll={updateBackToTop} class="home h-full overflow-y-auto bg-[#101012] text-[#f6f6f7]">
	<header class="mx-auto max-w-[90rem] px-4 pt-3 pb-5 sm:px-8 sm:pt-4 sm:pb-7 lg:px-12">
		<nav class="flex items-center max-md:-mx-1 md:flex-wrap md:gap-x-4 md:gap-y-2" aria-label={m.landing_nav_label()}>
			<a href="/" class="inline-flex min-h-10 min-w-0 items-center max-md:mr-2 max-md:[&_img]:h-auto max-md:[&_img]:w-32">
				<BrandLogo />
			</a>
			<div class="ml-auto shrink-0 md:contents">
				<LanguageSwitcher compact />
			</div>
			<div class="flex items-center text-xs font-medium max-md:shrink-0 md:ml-auto md:flex-wrap md:gap-4 md:text-sm">
				<a
					href={instagram}
					target="_blank"
					rel="noopener noreferrer"
					aria-label={m.landing_instagram_aria()}
					class="rounded hover:text-indigo-200 focus-visible:ring-2 focus-visible:ring-white max-md:grid max-md:size-[40px] max-md:place-items-center md:px-1 md:py-2"
				>
					<Camera class="size-4 md:hidden" aria-hidden="true" />
					<span class="max-md:sr-only">{m.landing_instagram()}</span>
				</a>
				<InstallApp compact class="border border-white/60 text-white hover:bg-white/10 max-md:size-[40px] max-md:p-0 max-md:has-[>svg]:px-0 md:px-3" />
				{#if auth.user}
					<DropdownMenu>
						<DropdownMenuTrigger>
							{#snippet child({ props })}
								<button
									{...props}
									type="button"
									class="flex min-h-[40px] items-center gap-1 rounded-lg border border-white/60 hover:bg-white/10 max-md:w-[40px] max-md:justify-center md:min-h-10 md:px-3 md:py-2"
								>
									<User class="size-4" aria-hidden="true" />
									<span class="max-md:sr-only">{m.nav_account()}</span>
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
						class="rounded-lg border border-white/60 hover:bg-white/10 max-md:grid max-md:size-[40px] max-md:place-items-center md:px-4 md:py-2"
					>
						<LogIn class="size-4 md:hidden" aria-hidden="true" />
						<span class="max-md:sr-only">{m.auth_sign_in()}</span>
					</a>
				{/if}
			</div>
		</nav>

		<div class={['mt-3 grid items-stretch gap-8', flyers.length && 'md:grid-cols-[minmax(0,1fr)_minmax(9rem,21%)]']}>
			<div class="min-w-0">
				<h1 bind:this={headline} tabindex="-1" class={['max-w-[28ch] font-display text-4xl leading-[1.02] font-semibold tracking-tight md:text-5xl lg:text-6xl', !flyers.length && 'md:max-w-none']}>
					{m.landing_title()}
				</h1>
				<p class="mt-2 max-w-3xl text-sm text-[#d5d5db] sm:text-base">{m.landing_subtitle()}</p>
				<p class="mt-1 max-w-3xl text-sm text-[#d5d5db] sm:text-base">{m.landing_subtitle_second()}</p>
			</div>
			{#if flyers.length}<HomeFlyerCollage {flyers} />{/if}
		</div>
	</header>

	<HomeAgenda {view} {filter} {url} onAsk={askAbout} />

	<section {@attach watchComposer} class="border-y border-[#3b3b42] bg-[#19191d] px-4 py-12 text-center sm:px-8 sm:py-16" aria-labelledby="home-chat-heading">
		<div class="mx-auto flex max-w-3xl flex-col items-center">
			<h2 id="home-chat-heading" class="font-display text-3xl font-semibold sm:text-4xl">{m.home_chat_heading()}</h2>
			<p class="mt-3 max-w-lg text-[#d5d5db]">{m.home_chat_body()}</p>
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
					placeholder={m.landing_placeholder()}
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
			<div class="mt-6 flex flex-wrap justify-center gap-3">
				<button
					type="button"
					onclick={() => sendPrompt(m.landing_prompt_today())}
					class="flex min-h-11 items-center gap-2 rounded-full border border-white/70 px-4 py-2 text-sm font-medium hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
				>
					<CalendarDays class="size-4" aria-hidden="true" />{m.landing_today()}
				</button>
				<button
					type="button"
					onclick={() => sendPrompt(m.landing_prompt_free_weekend())}
					class="flex min-h-11 items-center gap-2 rounded-full border border-white/70 px-4 py-2 text-sm font-medium hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
				>
					<Ticket class="size-4" aria-hidden="true" />{m.landing_free_weekend()}
				</button>
				<button
					type="button"
					onclick={() => sendPrompt(m.context_prompt_surprise())}
					class="flex min-h-11 items-center gap-2 rounded-full border border-white/70 px-4 py-2 text-sm font-medium hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
				>
					<Sparkles class="size-4" aria-hidden="true" />{m.home_surprise_label()}
				</button>
			</div>
			<p class="mt-6 text-sm text-[#d5d5db]">{m.landing_reassurance()}</p>
		</div>
	</section>

	<section class="mx-auto max-w-[90rem] px-4 py-10 sm:px-8 lg:px-12" aria-labelledby="home-follow-heading">
		<h2 id="home-follow-heading" class="font-display text-3xl font-semibold">{m.home_follow_heading()}</h2>
		<div class="mt-3 flex flex-wrap gap-x-8 gap-y-2">
			<a
				href={instagram}
				target="_blank"
				rel="noopener noreferrer"
				class="inline-flex min-h-11 items-center gap-2 text-sm text-[#d0ff36] hover:underline"
			>
				<Camera class="size-4 shrink-0" aria-hidden="true" />
				<span>{m.home_follow_instagram()}</span>
				<span class="sr-only">{m.landing_instagram_aria()}</span>
			</a>
			<a
				href="https://t.me/BAEventosBot?start=website"
				target="_blank"
				rel="noopener noreferrer"
				onclick={() => track('telegram:link_clicked', { source: 'homepage' })}
				class="inline-flex min-h-11 flex-col justify-center gap-0.5 text-sm text-[#d0ff36] hover:underline"
			>
				<span class="inline-flex items-center gap-2 font-medium">
					<Send class="size-4" aria-hidden="true" />
					{m.telegram_use_bot()}
				</span>
				<span class="text-xs text-[#d5d5db]">{m.telegram_start_description()}</span>
				<span class="sr-only">{m.telegram_external_link()}</span>
			</a>
		</div>
	</section>

	<footer class="mx-auto max-w-[90rem] border-t border-[#3b3b42] px-4 py-4 sm:px-8 lg:px-12">
		<a
			href="/mcp"
			onclick={() => track('mcp:signpost_clicked', { source: 'homepage' })}
			class="inline-flex min-h-11 items-center text-sm text-[#d5d5db] underline underline-offset-4 hover:text-white"
		>{m.mcp_signpost()}</a>
	</footer>

	{#if showBackToTop}
		<button
			type="button"
			aria-label={m.home_back_to_top()}
			onclick={backToTop}
			class={['back-to-top fixed z-30 grid size-11 place-items-center rounded-full border border-[#d0ff36] bg-[#19191d] text-[#d0ff36] shadow-lg hover:bg-[#29320c]', composerInView && 'max-lg:invisible']}
		>
			<ArrowUp class="size-5" aria-hidden="true" />
		</button>
	{/if}
</div>

<style>
	.back-to-top {
		right: calc(1rem + env(safe-area-inset-right));
		bottom: calc(3.5rem + env(safe-area-inset-bottom));
	}

	.home :global(:focus-visible) {
		outline: 2px solid #d0ff36;
		outline-offset: 3px;
	}

	.home :global(form :focus-visible) {
		outline-color: #4b35a3;
	}
</style>
