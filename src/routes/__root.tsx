import { HeadContent, Outlet, Scripts, createRootRoute, useLocation } from '@tanstack/react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '@/components/AuthProvider'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { queryClient } from '@/lib/query'
import { MainLayout } from '@/components/MainLayout'
import { getLocale } from '@/paraglide/runtime'

import appCss from '../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'BA Events - Discover Buenos Aires',
      },
      {
        name: 'description',
        content: 'AI-powered event discovery for Buenos Aires. Find techno nights, jazz bars, tango milongas, and more.',
      },
      {
        name: 'theme-color',
        content: '#1a1612',
      },
    ],
    links: [
      {
        rel: 'preconnect',
        href: 'https://fonts.googleapis.com',
      },
      {
        rel: 'preconnect',
        href: 'https://fonts.gstatic.com',
        crossOrigin: 'anonymous',
      },
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,400&family=DM+Sans:ital,wght@0,300;0,400;0,500;0,600;1,400&display=swap',
      },
      {
        rel: 'stylesheet',
        href: appCss,
      },
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
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <TooltipProvider>
              <RootLayout />
            </TooltipProvider>
          </AuthProvider>
        </QueryClientProvider>
        <Toaster position="bottom-right" richColors />
        <Scripts />
      </body>
    </html>
  )
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
