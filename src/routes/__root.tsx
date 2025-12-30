import { HeadContent, Outlet, Scripts, createRootRoute, useLocation } from '@tanstack/react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '@/components/AuthProvider'
import { useAuthContext } from '@/hooks/useAuthContext'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { queryClient } from '@/lib/query'
import { MainLayout } from '@/components/MainLayout'
import { getLocale } from '@/paraglide/runtime'
import posthog from 'posthog-js'
import { PostHogProvider, usePostHog } from 'posthog-js/react'
import { useEffect } from 'react'

import appCss from '../styles.css?url'

// Initialize PostHog (client-side only)
if (typeof window !== 'undefined') {
  const posthogKey = import.meta.env.VITE_PUBLIC_POSTHOG_KEY
  const posthogHost = import.meta.env.VITE_PUBLIC_POSTHOG_HOST

  if (posthogKey) {
    posthog.init(posthogKey, {
      api_host: posthogHost || 'https://us.i.posthog.com',
      // Use 2025 defaults for automatic SPA pageview tracking
      defaults: '2025-05-24',
      // Respect Do Not Track
      respect_dnt: true,
      // Capture performance metrics
      capture_performance: true,
      // Disable in development to avoid polluting data
      loaded: (posthog) => {
        if (import.meta.env.DEV) {
          posthog.opt_out_capturing()
        }
      },
    })
  }
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
    ],
  }),

  component: RootDocument,
})

function RootDocument() {
  return (
    <html lang={getLocale()} className="dark">
      <head>
        <HeadContent />
      </head>
      <body className="bg-background text-foreground antialiased overflow-hidden bg-grain">
        <PostHogProvider client={posthog}>
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <TooltipProvider>
                <PostHogIdentify />
                <RootLayout />
              </TooltipProvider>
            </AuthProvider>
          </QueryClientProvider>
        </PostHogProvider>
        <Toaster position="bottom-right" richColors />
        <Scripts />
      </body>
    </html>
  )
}

// Identify users when auth state changes
function PostHogIdentify() {
  const { user, isAdmin } = useAuthContext()
  const posthogClient = usePostHog()

  useEffect(() => {
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
  }, [user, isAdmin, posthogClient])

  return null
}

// Pages that should not have the main sidebar (auth pages only)
const EXCLUDED_ROUTES = ['/login', '/signup', '/forgot-password', '/reset-password', '/auth/callback']

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
