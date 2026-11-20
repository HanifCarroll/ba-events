<script lang="ts">
	import { ArrowUp, CalendarDays, Camera, Mic, Search, Ticket, Send } from 'lucide-svelte'
	import * as m from '#paraglide/messages.js'
	import { toast } from 'svelte-sonner'
	import { getLocale } from '#paraglide/runtime.js'
	import { useSpeech } from '#features/chat/lib/speech.svelte.ts'
	import { parseHomeFilter, type HomeAgendaPage, type HomeAgendaEvent, type HomeViewPage } from '#features/events/lib/home-feed.ts'
	import HomeAgenda from '#features/events/components/HomeAgenda.svelte'
	import HomeFlyerCollage from '#features/events/components/HomeFlyerCollage.svelte'
	import BrandLogo from '#shared/ui/BrandLogo.svelte'
	import LanguageSwitcher from '#shared/ui/LanguageSwitcher.svelte'
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
	const placeholder = $derived(m.home_chat_placeholder())
	const view: HomeViewPage = $derived(homeAgenda?.view ?? { events: [], empty: 'feed', total: 0 })
	const flyers = $derived(homeAgenda?.flyers ?? [])
	let refreshPending = false
	let refreshAt = Infinity
	let scroller = $state<HTMLDivElement>()
	let headline = $state<HTMLHeadingElement>()
	let showBackToTop = $state(false)
	let backToTopButton = $state<HTMLButtonElement>()
	let composer = $state<HTMLFormElement>()
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
		if (!scroller) return
		const pastThreshold = scroller.scrollTop > 2 * scroller.clientHeight
		const atEnd = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1
		if (!composer || !backToTopButton || !pastThreshold || atEnd) {
			showBackToTop = pastThreshold || (atEnd && scroller.scrollTop > 0)
			return
		}
		const button = backToTopButton.getBoundingClientRect()
		const form = composer.getBoundingClientRect()
		const gap = 8
		showBackToTop = form.right + gap <= button.left || form.left >= button.right + gap
			|| form.bottom + gap <= button.top || form.top >= button.bottom + gap
	}

	async function revealAgendaPage(href: string) {
		const scrollport = scroller
		if (!scrollport) return goto(href, { reset: false })
		scrollport.style.overflowAnchor = 'none'
		try {
			await goto(href, { reset: false })
			// Lay out the new cards before the browser can anchor to the old pager.
			void scrollport.offsetHeight
		} finally {
			scrollport.style.removeProperty('overflow-anchor')
		}
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
		updateBackToTop()
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

</script>

<svelte:window onfocus={refreshAgendaIfDue} onresize={updateBackToTop} />
<svelte:document onvisibilitychange={refreshAgendaIfDue} />

<div bind:this={scroller} onscroll={updateBackToTop} class="home h-full overflow-y-auto bg-[#101012] text-[#f6f6f7]">
	<header data-section="intro" class="mx-auto max-w-[90rem] px-4 pt-3 pb-4 sm:px-8 sm:pt-4 sm:pb-7 lg:px-12">
		<nav class="flex items-center justify-between gap-2" aria-label={m.landing_nav_label()}>
			<a href="/" class="inline-flex min-h-11 min-w-11 items-center max-md:[&_img]:h-auto max-md:[&_img]:w-32">
				<BrandLogo />
			</a>
			<div class="flex shrink-0 items-center gap-1 text-sm font-medium">
				<LanguageSwitcher class="justify-center hover:bg-white/10" />
				{#if auth.user}
					<DropdownMenu>
						<DropdownMenuTrigger>
							{#snippet child({ props })}
								<button
									{...props}
									type="button"
									class="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-3 hover:bg-white/10"
								>
									{m.nav_account()}
								</button>
							{/snippet}
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" class="w-48">
							<DropdownMenuItem
								onclick={() => goto('/saved')}
								class="min-h-11 cursor-pointer hover:bg-primary/10 hover:text-primary focus:bg-primary/10 focus:text-primary"
							>
								{m.nav_my_saved_events()}
							</DropdownMenuItem>
							<DropdownMenuItem
								onclick={() => goto('/profile')}
								class="min-h-11 cursor-pointer hover:bg-primary/10 hover:text-primary focus:bg-primary/10 focus:text-primary"
							>
								{m.nav_settings()}
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							<DropdownMenuItem
								onclick={handleSignOut}
								disabled={isSigningOut}
								class="min-h-11 cursor-pointer hover:bg-primary/10 hover:text-primary focus:bg-primary/10 focus:text-primary"
							>
								{isSigningOut ? m.auth_signing_out() : m.auth_sign_out()}
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				{:else}
					<a
						href="/login"
						class="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-3 hover:bg-white/10"
					>
						{m.nav_sign_in()}
					</a>
				{/if}
			</div>
		</nav>

		<div class={['mt-3 grid items-stretch gap-8', flyers.length && 'md:grid-cols-[minmax(0,1fr)_minmax(9rem,21%)]']}>
			<div class="min-w-0">
				<h1 bind:this={headline} tabindex="-1" class={['max-w-[28ch] font-display text-[clamp(1.875rem,8.2vw,2.25rem)] leading-[1.02] font-semibold tracking-tight max-md:text-balance md:text-5xl lg:text-6xl', !flyers.length && 'md:max-w-none']}>
					{m.landing_title()}
				</h1>
				<p class="mt-2 max-w-3xl text-sm text-[#d5d5db] max-md:text-pretty sm:text-base">{m.home_intro_subtitle()}</p>
			</div>
			{#if flyers.length}<HomeFlyerCollage {flyers} />{/if}
		</div>
	</header>

	<HomeAgenda {view} {filter} {url} day={homeAgenda?.day} chat={chatBlock} onAsk={askAbout} onMore={revealAgendaPage} />

	{#snippet chatBlock()}
	<section data-section="chat" class="rounded-2xl border border-[#3b3b42] bg-[#19191d] px-3 py-5 text-center sm:p-8" aria-labelledby="home-chat-heading">
		<div data-chat-body class="mx-auto flex max-w-3xl flex-col items-center">
			<h2 id="home-chat-heading" class="text-lg leading-tight font-semibold sm:text-2xl">{m.home_chat_heading()}</h2>
			<form
				bind:this={composer}
				onsubmit={(event) => {
					event.preventDefault()
					submitQuery()
				}}
				class="mt-3 flex w-full max-w-3xl items-center gap-1 rounded-2xl bg-white p-1.5 pl-2 text-foreground sm:gap-2 sm:pl-4"
			>
				<Search class="hidden size-5 shrink-0 text-muted-foreground sm:block" aria-hidden="true" />
				<label for="landing-composer" class="sr-only">{m.home_composer_label()}</label>
				<textarea
					bind:this={landingInput}
					bind:value={landingQuery}
					id="landing-composer"
					{placeholder}
					autocomplete="off"
					onkeydown={handleComposerKeydown}
					oninput={resizeLandingInput}
					rows="1"
					class="min-h-11 w-full min-w-0 flex-1 resize-none overflow-x-hidden bg-transparent px-1 py-2 text-base leading-6 outline-none placeholder:text-muted-foreground sm:!h-11 sm:overflow-hidden sm:py-3 sm:text-sm"
				></textarea>
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
				</button>
				<button
					type="submit"
					class="min-h-11 shrink-0 rounded-xl border border-[#171a0c] bg-[#d0ff36] text-sm font-semibold text-[#171a0c] transition-colors hover:bg-[#bde62f] max-sm:grid max-sm:min-w-11 max-sm:place-items-center sm:px-6"
				>
					<Send class="size-4 sm:hidden" aria-hidden="true" />
					<span class="max-sm:sr-only">{m.landing_submit()}</span>
				</button>
			</form>
			<div class="mt-3 flex flex-wrap justify-center gap-2">
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
			</div>
		</div>
	</section>
	{/snippet}

	<section data-section="follow" class="mx-auto max-w-[90rem] px-4 py-10 sm:px-8 lg:px-12" aria-labelledby="home-follow-heading">
		<h2 id="home-follow-heading" class="text-3xl font-semibold">{m.home_follow_heading()}</h2>
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

	<footer data-section="footer" class="mx-auto max-w-[90rem] border-t border-[#3b3b42] px-4 py-4 sm:px-8 lg:px-12">
		<a
			href="/mcp"
			onclick={() => track('mcp:signpost_clicked', { source: 'homepage' })}
			class="inline-flex min-h-11 items-center text-sm text-[#d5d5db] underline underline-offset-4 hover:text-white"
		>{m.mcp_signpost()}</a>
	</footer>

	<button
		bind:this={backToTopButton}
		type="button"
		aria-label={m.home_back_to_top()}
		onclick={backToTop}
		class={['back-to-top fixed z-30 grid place-items-center rounded-full border border-[#d0ff36] bg-[#19191d] text-[#d0ff36] shadow-lg hover:bg-[#29320c]', !showBackToTop && 'invisible']}
	>
		<ArrowUp class="size-5" aria-hidden="true" />
	</button>
</div>

<style>
	.home {
		--back-to-top-size: 2.75rem;
		--back-to-top-right: calc(1rem + env(safe-area-inset-right, 0px));
	}

	.back-to-top {
		width: var(--back-to-top-size);
		aspect-ratio: 1;
		right: var(--back-to-top-right);
		bottom: calc(3.5rem + env(safe-area-inset-bottom, 0px));
	}

	.home :global(:focus-visible) {
		outline: 2px solid #d0ff36;
		outline-offset: 3px;
	}

	.home :global([data-section='filters'] a:focus-visible) {
		outline-color: white;
		outline-offset: -4px;
	}

	.home :global([data-section='filters'] a[aria-current]:focus-visible) {
		outline-color: #171a0c;
	}

	.home :global(form :focus-visible) {
		outline-color: #171a0c;
	}
</style>
