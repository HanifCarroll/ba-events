import { HeadContent, Outlet, Scripts, createRootRoute, useLocation } from '@tanstack/react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '@/shared/providers/AuthProvider'
import { ChatProvider } from '@/shared/providers/ChatProvider'
import { useAuthContext } from '@/features/auth/hooks/useAuthContext'
import { getSessionUser, type SessionUser } from '@/features/auth/api/session'
import { TooltipProvider } from '@/shared/ui/tooltip'
import { Toaster } from '@/shared/ui/sonner'
import { ErrorBoundary } from '@/shared/ui/ErrorBoundary'
import { queryClient } from '@/shared/lib/query'
import { MainLayout } from '@/shared/ui/MainLayout'
import { getLocale, serverAsyncLocalStorage } from '@/paraglide/runtime'
import { useEffect } from 'react'
import { getSiteUrl } from '@/shared/lib/utils/url'

import appCss from '../styles.css?url'

// Route context type for auth state
export interface RootRouteContext {
  session: SessionUser | null
}

// PostHog is loaded dynamically client-side only to avoid SSR issues
let posthogInstance: typeof import('posthog-js').default | null = null

function getPostHog() {
  return posthogInstance
}

// PostHogIdentify can't rely on being re-run by a remount (PostHogInit is a
// non-wrapping sibling), so it registers itself here and PostHogInit notifies
// it once the client instance is ready.
const posthogReadyCallbacks = new Set<() => void>()

function notifyPosthogReady() {
  posthogReadyCallbacks.forEach((callback) => callback())
}

export const Route = createRootRoute({
  // Fetch auth state server-side so it's available during SSR
  beforeLoad: async (): Promise<RootRouteContext> => {
    const session = await getSessionUser()

    // Server-side: render in the user's saved locale and persist it to the
    // paraglide cookie so the client resolves the same locale. Previously this
    // happened client-side in PostHogIdentify via setLocale(..., { reload: true })
    // — a full page reload on load whenever the saved locale differed from the
    // browser language (the reload flash).
    const savedLocale = session?.profile?.locale
    if (import.meta.env.SSR && savedLocale) {
      const store = serverAsyncLocalStorage?.getStore()
      if (store) {
        store.locale = savedLocale
      }
      // Server-only module: static import would pull h3/node APIs into the
      // client bundle. Same pattern as getSessionUser's db/server import.
      const { setCookie } = await import('@tanstack/react-start/server')
      setCookie('PARAGLIDE_LOCALE', savedLocale, {
        path: '/',
        maxAge: 34560000, // matches paraglide's cookieMaxAge (1 year)
      })
    }

    return { session }
  },

  head: () => {
    const siteUrl = getSiteUrl()
    const ogImageUrl = `${siteUrl}/og-image.png`
    const locale = getLocale() as 'en' | 'es'

    // Locale-specific title & descriptions (voseo for es, plain for en)
    const SEO = {
      en: {
        title: 'BA Events - Discover Buenos Aires',
        description:
          'Discover events in Buenos Aires with artificial intelligence. Find techno nights, jazz bars, tango milongas, and more.',
      },
      es: {
        title: 'BA Eventos - Descubrí Buenos Aires',
        description:
          'Descubrí eventos en Buenos Aires con inteligencia artificial. Encontrá noches de techno, bares de jazz, milongas de tango, y más.',
      },
    }[locale]

    return {
      meta: [
      // Core meta tags
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: SEO.title },
      { name: 'description', content: SEO.description },
      { name: 'theme-color', content: '#fafaf8' },

      // Open Graph tags
      { property: 'og:type', content: 'website' },
      { property: 'og:site_name', content: 'BA Eventos' },
      { property: 'og:title', content: SEO.title },
      { property: 'og:description', content: SEO.description },
      { property: 'og:image', content: ogImageUrl },
      { property: 'og:url', content: siteUrl },
      { property: 'og:locale', content: 'es_AR' },
      { property: 'og:locale:alternate', content: 'en_US' },

      // Twitter Card tags
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: SEO.title },
      { name: 'twitter:description', content: SEO.description },
      { name: 'twitter:image', content: ogImageUrl },
      ],
      links: [
      { rel: 'canonical', href: siteUrl },
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
      { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,400&family=DM+Sans:ital,wght@0,300;0,400;0,500;0,600;1,400&display=swap' },
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: '/favicon.ico', sizes: 'any' },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
      { rel: 'manifest', href: '/manifest.json' },
      ],
      scripts: [
      {
        type: 'application/ld+json',
        children: JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'WebApplication',
          'name': 'BA Eventos',
          'description': 'Descubrí eventos en Buenos Aires con inteligencia artificial. Encontrá noches de techno, bares de jazz, milongas de tango, y más.',
          'url': siteUrl,
          'applicationCategory': 'EntertainmentApplication',
          'operatingSystem': 'Web',
          'availableLanguage': ['es', 'en'],
          'offers': {
            '@type': 'Offer',
            'price': '0',
            'priceCurrency': 'ARS',
          },
          'author': {
            '@type': 'Organization',
            'name': 'BA Eventos',
            'url': siteUrl,
          },
        }),
      },
      ],
    }
  },

  component: RootDocument,
})

// Initializes PostHog on the client. Renders nothing on purpose: it must NOT
// wrap children. Conditionally swapping the app root between a fragment and a
// <Provider> (as a wrapping provider would) makes React unmount and remount the
// entire tree when the async import resolves — that remount replays every
// entrance animation and is the visible "UI flashes" on load. Nothing in the
// app consumes the PostHog React context (tracking goes through the module
// instance via getPostHog), so the wrapper has no purpose here.
function PostHogInit() {
  useEffect(() => {
    let cancelled = false
    // Dynamically import posthog-js only on client
    import('posthog-js').then((posthogModule) => {
      if (cancelled) return
      const posthog = posthogModule.default
      const posthogKey = import.meta.env.VITE_PUBLIC_POSTHOG_KEY
      const posthogHost = import.meta.env.VITE_PUBLIC_POSTHOG_HOST

      if (posthogKey && !posthogInstance) {
        posthog.init(posthogKey, {
          api_host: posthogHost || 'https://us.i.posthog.com',
          defaults: '2025-05-24',
          capture_pageview: true,
          capture_pageleave: true,
          autocapture: true,
          disable_surveys: false,
          disable_session_recording: false,
          session_recording: {
            maskAllInputs: false,
            maskInputOptions: {
              password: true,
            },
          },
          loaded: (ph) => {
            // Expose globally for debugging
            ;(window as unknown as Record<string, unknown>).posthog = ph
            if (import.meta.env.DEV) {
              ph.opt_out_capturing()
            }
          },
        })
        posthogInstance = posthog
        notifyPosthogReady()
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  return null
}

// Registers the PWA service worker. Client-only: the SW is generated by the
// pwa-workbox plugin during `vite build` (dist/client/sw.js) and skipped in
// dev, where no sw.js exists. SSR-safe via useEffect + import.meta.env checks.
function PwaRegister() {
  useEffect(() => {
    if (import.meta.env.SSR || import.meta.env.DEV) return
    if (!('serviceWorker' in navigator)) return

    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .catch((err) => {
        console.error('[pwa] failed to register service worker', err)
      })
  }, [])

  return null
}

function RootDocument() {
  // Get auth state from route context (fetched in beforeLoad during SSR)
  const { session } = Route.useRouteContext()

  return (
    <html lang={getLocale()}>
      <head>
        <HeadContent />
      </head>
      <body className="bg-background text-foreground antialiased bg-grain">
        <ErrorBoundary>
          <PwaRegister />
          <PostHogInit />
          <QueryClientProvider client={queryClient}>
            <AuthProvider initialSession={session}>
              <TooltipProvider>
                <PostHogIdentify />
                <RootLayout />
              </TooltipProvider>
            </AuthProvider>
          </QueryClientProvider>
        </ErrorBoundary>
        <Toaster position="bottom-right" richColors />
        <Scripts />
      </body>
    </html>
  )
}

// Identify users when auth state changes. The saved locale preference is now
// applied server-side in beforeLoad (rendered + persisted to the cookie), so
// the client always hydrates in the same locale — no reload needed here.
function PostHogIdentify() {
  const { user, isAdmin } = useAuthContext()

  useEffect(() => {
    const identify = () => {
      const posthogClient = getPostHog()
      if (!posthogClient) return

      if (user) {
        // Identify user with their ID (never use email as distinct_id)
        posthogClient.identify(user.id, {
          email: user.email,
          locale: getLocale(),
          is_admin: isAdmin,
        })
      } else {
        // Reset on logout to unlink future anonymous events
        posthogClient.reset()
      }
    }

    identify()
    posthogReadyCallbacks.add(identify)
    return () => {
      posthogReadyCallbacks.delete(identify)
    }
  }, [user, isAdmin])

  return null
}

// Pages that should not have the main sidebar (auth pages only)
const EXCLUDED_ROUTES = ['/login', '/auth/callback']

function RootLayout() {
  const location = useLocation()
  const isExcludedPage = EXCLUDED_ROUTES.some(route => location.pathname.startsWith(route))

  // ChatProvider wraps everything to prevent context errors during route transitions
  return (
    <ChatProvider>
      {isExcludedPage ? (
        <>
          {/* Atmospheric gradient overlay */}
          <div className="fixed inset-0 bg-gradient-to-b from-primary/[0.02] via-transparent to-accent/[0.03] pointer-events-none z-0" />
          <div className="h-full">
            <Outlet />
          </div>
        </>
      ) : (
        <MainLayout>
          <Outlet />
        </MainLayout>
      )}
    </ChatProvider>
  )
}
