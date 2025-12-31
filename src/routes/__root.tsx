import { HeadContent, Outlet, Scripts, createRootRoute, useLocation } from '@tanstack/react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '@/components/AuthProvider'
import { useAuthContext } from '@/hooks/useAuthContext'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { queryClient } from '@/lib/query'
import { MainLayout } from '@/components/MainLayout'
import { getLocale, setLocale } from '@/paraglide/runtime'
import React, { useEffect, useState, type ReactNode } from 'react'

import appCss from '../styles.css?url'

// PostHog is loaded dynamically client-side only to avoid SSR issues
let posthogInstance: typeof import('posthog-js').default | null = null

function getPostHog() {
  return posthogInstance
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      // Core meta tags
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'BA Eventos - Descubrí Buenos Aires' },
      { name: 'description', content: 'Descubrí eventos en Buenos Aires con inteligencia artificial. Encontrá noches de techno, bares de jazz, milongas de tango, y más.' },
      { name: 'theme-color', content: '#1a1612' },

      // Open Graph tags
      { property: 'og:type', content: 'website' },
      { property: 'og:site_name', content: 'BA Eventos' },
      { property: 'og:title', content: 'BA Eventos - Descubrí Buenos Aires' },
      { property: 'og:description', content: 'Descubrí eventos en Buenos Aires con inteligencia artificial. Encontrá noches de techno, bares de jazz, milongas de tango, y más.' },
      { property: 'og:image', content: 'https://baeventos.com/og-image.png' },
      { property: 'og:url', content: 'https://baeventos.com' },
      { property: 'og:locale', content: 'es_AR' },
      { property: 'og:locale:alternate', content: 'en_US' },

      // Twitter Card tags
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: 'BA Eventos - Descubrí Buenos Aires' },
      { name: 'twitter:description', content: 'Descubrí eventos en Buenos Aires con inteligencia artificial. Encontrá noches de techno, bares de jazz, milongas de tango, y más.' },
      { name: 'twitter:image', content: 'https://baeventos.com/og-image.png' },
    ],
    links: [
      { rel: 'canonical', href: 'https://baeventos.com' },
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
      { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,400&family=DM+Sans:ital,wght@0,300;0,400;0,500;0,600;1,400&display=swap' },
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: '/favicon.ico', sizes: 'any' },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
    ],
    scripts: [
      {
        type: 'application/ld+json',
        children: JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'WebApplication',
          'name': 'BA Eventos',
          'description': 'Descubrí eventos en Buenos Aires con inteligencia artificial. Encontrá noches de techno, bares de jazz, milongas de tango, y más.',
          'url': 'https://baeventos.com',
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
            'url': 'https://baeventos.com',
          },
        }),
      },
    ],
  }),

  component: RootDocument,
})

// Client-only PostHog provider that loads dynamically
function ClientPostHogProvider({ children }: { children: ReactNode }) {
  const [Provider, setProvider] = useState<React.ComponentType<{ client: typeof import('posthog-js').default; children: ReactNode }> | null>(null)

  useEffect(() => {
    // Dynamically import posthog-js only on client
    Promise.all([
      import('posthog-js'),
      import('posthog-js/react'),
    ]).then(([posthogModule, reactModule]) => {
      const posthog = posthogModule.default
      const posthogKey = import.meta.env.VITE_PUBLIC_POSTHOG_KEY
      const posthogHost = import.meta.env.VITE_PUBLIC_POSTHOG_HOST

      if (posthogKey && !posthogInstance) {
        posthog.init(posthogKey, {
          api_host: posthogHost || 'https://us.i.posthog.com',
          defaults: '2025-05-24',
          respect_dnt: true,
          capture_pageview: true,
          capture_pageleave: true,
          autocapture: true,
          loaded: (ph) => {
            if (import.meta.env.DEV) {
              ph.opt_out_capturing()
            }
          },
        })
        posthogInstance = posthog
      }

      setProvider(() => reactModule.PostHogProvider)
    })
  }, [])

  if (!Provider || !posthogInstance) {
    return <>{children}</>
  }

  return <Provider client={posthogInstance}>{children}</Provider>
}

function RootDocument() {
  return (
    <html lang={getLocale()} className="dark">
      <head>
        <HeadContent />
      </head>
      <body className="bg-background text-foreground antialiased overflow-hidden bg-grain">
        <ClientPostHogProvider>
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <TooltipProvider>
                <PostHogIdentify />
                <RootLayout />
              </TooltipProvider>
            </AuthProvider>
          </QueryClientProvider>
        </ClientPostHogProvider>
        <Toaster position="bottom-right" richColors />
        <Scripts />
      </body>
    </html>
  )
}

// Identify users when auth state changes and sync locale preference
function PostHogIdentify() {
  const { user, profile, isAdmin } = useAuthContext()

  useEffect(() => {
    const posthogClient = getPostHog()
    if (!posthogClient) return

    if (user) {
      // Identify user with their ID (never use email as distinct_id)
      posthogClient.identify(user.id, {
        email: user.email,
        locale: getLocale(),
        is_admin: isAdmin,
      })

      // Sync saved locale preference from database
      // If user has a saved locale preference that differs from current, apply it
      if (profile?.locale && profile.locale !== getLocale()) {
        setLocale(profile.locale, { reload: true })
      }
    } else {
      // Reset on logout to unlink future anonymous events
      posthogClient.reset()
    }
  }, [user, profile?.locale, isAdmin])

  return null
}

// Pages that should not have the main sidebar (auth pages only)
const EXCLUDED_ROUTES = ['/login', '/register', '/forgot-password', '/reset-password', '/auth/callback']

function RootLayout() {
  const location = useLocation()
  const isExcludedPage = EXCLUDED_ROUTES.some(route => location.pathname.startsWith(route))

  // Auth and admin pages render without the main sidebar layout
  if (isExcludedPage) {
    return (
      <>
        {/* Atmospheric gradient overlay */}
        <div className="fixed inset-0 bg-gradient-to-b from-primary/[0.02] via-transparent to-accent/[0.03] pointer-events-none z-0" />
        <div className="h-full">
          <Outlet />
        </div>
      </>
    )
  }

  // All other pages get the sidebar layout
  return (
    <MainLayout>
      <Outlet />
    </MainLayout>
  )
}
