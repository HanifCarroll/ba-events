<script lang="ts">
	import '../app.css'
	import { untrack } from 'svelte'
	import { page } from '$app/state'
	import { browser, dev } from '$app/env'
	import { PUBLIC_POSTHOG_KEY, PUBLIC_POSTHOG_HOST } from '$app/env/public'
	import { initAuthContext, getAuthState } from '#features/auth/hooks/auth-context.svelte.ts'
	import { getLocale } from '#paraglide/runtime.js'
	import { getSiteUrl } from '#shared/lib/utils/url.ts'
	import { isAnalyticsEnabled } from '#shared/lib/analytics.ts'
	import MainLayout from '#shared/ui/MainLayout.svelte'
	import Toaster from '#shared/ui/sonner/sonner.svelte'
	import type { LayoutProps } from './$types'

	let { children, data }: LayoutProps = $props()

	// One-time init: `data` only seeds the initial SSR session state; the
	// auth-context listener keeps it current afterwards.
	untrack(() => initAuthContext(data))

	// The legacy ChatProvider wrapped the whole tree at the root so ChatContainer
	// (and its descendants) could read/write shared conversation state across
	// route transitions. U1's chat.svelte.ts ports this as a module singleton
	// (`getChatState()` / `chatState`) — it self-initialises on first import and
	// needs no root wiring, so there is no init call here (see evidence).

	// ---------------------------------------------------------------------------
	// PostHog (legacy __root.tsx PostHogInit / PostHogIdentify)
	// ---------------------------------------------------------------------------

	// PostHog is loaded dynamically client-side only to avoid SSR issues.
	let posthogInstance: typeof import('posthog-js').default | null = null
	let posthogInitStarted = false

	// PostHogIdentify can't rely on being re-run by a remount (PostHogInit is a
	// non-wrapping sibling in the legacy), so it registers itself here and
	// PostHogInit notifies it once the client instance is ready.
	const posthogReadyCallbacks = new Set<() => void>()
	function notifyPosthogReady() {
		for (const callback of posthogReadyCallbacks) callback()
	}

	// Client-only init. The legacy PostHogInit rendered nothing on purpose so it
	// would NOT wrap children (a conditionally-mounted provider made React
	// unmount/remount the whole tree when the async import resolved, replaying
	// every entrance animation). In Svelte there is no provider remount, so a
	// plain $effect is the faithful equivalent — it never touches the render
	// tree. Runs once per app lifetime via the module-instance guard.
	$effect(() => {
		if (!browser || posthogInitStarted || !isAnalyticsEnabled()) return
		posthogInitStarted = true
		let cancelled = false

		import('posthog-js').then((posthogModule) => {
			if (cancelled) return
			const posthog = posthogModule.default

			if (PUBLIC_POSTHOG_KEY && !posthogInstance) {
				posthog.init(PUBLIC_POSTHOG_KEY, {
					api_host: PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
					defaults: '2025-05-24',
					capture_pageview: true,
					capture_pageleave: false,
					autocapture: false,
					disable_surveys: true,
					disable_session_recording: true,
					respect_dnt: true,
					loaded: (ph) => {
						// Expose globally for debugging.
						;(window as unknown as Record<string, unknown>).posthog = ph
						if (dev) {
							ph.opt_out_capturing()
						}
					}
				})
				posthogInstance = posthog
				notifyPosthogReady()
			}
		})

		return () => {
			cancelled = true
		}
	})

	// Identify users when auth state changes (legacy PostHogIdentify). The saved
	// locale is applied server-side by the locale-sync handle, so no client
	// reload is needed. The deferred-identify registration mirrors the legacy
	// posthogReadyCallbacks semantics: if identify runs before the async import
	// resolves, notifyPosthogReady() re-runs it once the instance is ready.
	$effect(() => {
		const authState = getAuthState()
		const user = authState.user
		const isAdmin = authState.isAdmin

		const identify = () => {
			const posthogClient = posthogInstance
			if (!posthogClient) return

			if (user) {
				// Keep PostHog pseudonymous: Supabase remains the system of record for email.
				posthogClient.identify(user.id, {
					locale: getLocale(),
					is_admin: isAdmin
				})
			} else {
				// Reset on logout to unlink future anonymous events.
				posthogClient.reset()
			}
		}

		identify()
		posthogReadyCallbacks.add(identify)
		return () => {
			posthogReadyCallbacks.delete(identify)
		}
	})

	// ---------------------------------------------------------------------------
	// Head (legacy __root.tsx head())
	// ---------------------------------------------------------------------------
	type AppLocale = 'en' | 'es'

	// Locale-specific title & descriptions (voseo for es, plain for en).
	const SEO: Record<AppLocale, { title: string; description: string }> = {
		en: {
			title: 'BA Events - Discover Buenos Aires',
			description:
				'Discover events in Buenos Aires with artificial intelligence. Find techno nights, jazz bars, tango milongas, and more.'
		},
		es: {
			title: 'BA Eventos - Descubrí Buenos Aires',
			description:
				'Descubrí eventos en Buenos Aires con inteligencia artificial. Encontrá noches de techno, bares de jazz, milongas de tango, y más.'
		}
	}

	const locale = getLocale() as AppLocale
	const seo = SEO[locale]
	const siteUrl = getSiteUrl()
	const ogImageUrl = `${siteUrl}/og-image.png`

	const webAppSchema = JSON.stringify({
		'@context': 'https://schema.org',
		'@type': 'WebApplication',
		name: 'BA Eventos',
		description:
			'Descubrí eventos en Buenos Aires con inteligencia artificial. Encontrá noches de techno, bares de jazz, milongas de tango, y más.',
		url: siteUrl,
		applicationCategory: 'EntertainmentApplication',
		operatingSystem: 'Web',
		availableLanguage: ['es', 'en'],
		offers: {
			'@type': 'Offer',
			price: '0',
			priceCurrency: 'ARS'
		},
		author: {
			'@type': 'Organization',
			name: 'BA Eventos',
			url: siteUrl
		}
	})

	// Pages that should not have the main sidebar (auth pages only).
	const EXCLUDED_ROUTES = ['/login', '/auth/callback']
	const isExcludedPage = $derived(
		EXCLUDED_ROUTES.some((route) => page.url.pathname.startsWith(route))
	)
</script>

<svelte:head>
	<title>{seo.title}</title>
	<meta name="description" content={seo.description} />
	<meta name="theme-color" content="#fafaf8" />

	<!-- Open Graph tags -->
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="BA Eventos" />
	<meta property="og:title" content={seo.title} />
	<meta property="og:description" content={seo.description} />
	<meta property="og:image" content={ogImageUrl} />
	<meta property="og:url" content={siteUrl} />
	<meta property="og:locale" content="es_AR" />
	<meta property="og:locale:alternate" content="en_US" />

	<!-- Twitter Card tags -->
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={seo.title} />
	<meta name="twitter:description" content={seo.description} />
	<meta name="twitter:image" content={ogImageUrl} />

	<link rel="canonical" href={siteUrl} />
	<link rel="manifest" href="/manifest.json" />

	<script type="application/ld+json">
		{@html webAppSchema}
	</script>
</svelte:head>

{#if isExcludedPage}
	<!-- Atmospheric gradient overlay -->
	<div
		class="fixed inset-0 bg-gradient-to-b from-primary/[0.02] via-transparent to-accent/[0.03] pointer-events-none z-0"
	></div>
	<div class="h-full">
		{@render children()}
	</div>
{:else}
	<MainLayout>
		{@render children()}
	</MainLayout>
{/if}

<Toaster position="bottom-right" richColors />
