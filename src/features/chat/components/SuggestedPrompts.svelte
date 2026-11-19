<script lang="ts">
	import { onMount } from 'svelte'
	import { gsap } from 'gsap'
	import { CalendarDays, Camera, Mic, Search, Sparkles, Ticket, User, Send } from 'lucide-svelte'
	import * as m from '#paraglide/messages.js'
	import { toast } from 'svelte-sonner'
	import { getLocale } from '#paraglide/runtime.js'
	import { useSpeech } from '#features/chat/lib/speech.svelte.ts'
	import { parseHomeFilter, selectHomeView, type HomeAgenda as Agenda, type HomeAgendaEvent } from '#features/events/lib/home-feed.ts'
	import HomeAgenda from '#features/events/components/HomeAgenda.svelte'
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
	import { goto } from '$app/navigation'
	import { page } from '$app/state'
	import { track } from '#shared/lib/analytics.ts'

	let {
		onSelectPrompt,
		homeAgenda = null
	}: {
		onSelectPrompt: (prompt: string, options: { eventId?: string; happeningSoonEventIds: string[] }) => void
		homeAgenda?: Agenda | null
	} = $props()

	const auth = useAuthContext()
	let landingQuery = $state('')
	let promptedEvent: { id: string; prompt: string } | null = null
	const url = $derived(new URL((page.shallow?.url ?? page.url).href))
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

	function sendPrompt(prompt: string, eventId?: string) {
		const filter = parseHomeFilter(url.searchParams.get('f'))
		const happeningSoonEventIds = homeAgenda
			? selectHomeView(homeAgenda, filter).events.slice(0, 4).map(({ id }) => id)
			: []
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

<div class="home h-full overflow-y-auto bg-[#101012] text-[#f6f6f7]">
	<header class="mx-auto max-w-[90rem] px-4 pt-3 pb-5 sm:px-8 sm:pt-4 sm:pb-7 lg:px-12">
		<nav class="flex flex-wrap items-center gap-x-4 gap-y-2" aria-label={m.landing_nav_label()}>
			<a href="/" class="inline-flex min-h-10 items-center">
				<BrandLogo />
			</a>
			<LanguageSwitcher compact />
			<div class="flex flex-wrap items-center gap-2 text-xs font-medium sm:ml-auto sm:gap-4 sm:text-sm">
				<a
					href={instagram}
					target="_blank"
					rel="noopener noreferrer"
					aria-label={m.landing_instagram_aria()}
					class="rounded px-1 py-2 hover:text-indigo-200 focus-visible:ring-2 focus-visible:ring-white"
				>{m.landing_instagram()}</a>
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

		<div class="mt-3 grid items-stretch gap-8 md:grid-cols-[minmax(0,1fr)_minmax(9rem,21%)]">
			<div class="min-w-0">
				<h1 class="max-w-[28ch] font-display text-4xl leading-[1.02] font-semibold tracking-tight md:text-5xl lg:text-6xl">
					{m.landing_title()}
				</h1>
				<p class="mt-2 max-w-3xl text-sm text-[#d5d5db] sm:text-base">{m.landing_subtitle()}</p>
				<p class="mt-1 max-w-3xl text-sm text-[#d5d5db] sm:text-base">{m.landing_subtitle_second()}</p>
			</div>
			<div aria-hidden="true" class="header-photo hidden rounded-sm md:block"></div>
		</div>
	</header>

	<HomeAgenda agenda={homeAgenda} {url} onAsk={askAbout} onFilter={(href) => { void goto(href, { shallow: true }) }} />

	<section class="border-y border-[#3b3b42] bg-[#19191d] px-4 py-12 text-center sm:px-8 sm:py-16" aria-labelledby="home-chat-heading">
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
</div>

<style>
	.header-photo {
		background: #101012 url('/home-header.jpg') center 45% / cover no-repeat;
	}

	.home :global(:focus-visible) {
		outline: 2px solid #d0ff36;
		outline-offset: 3px;
	}

	.home :global(form :focus-visible) {
		outline-color: #4b35a3;
	}
</style>
