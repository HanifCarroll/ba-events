import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router'

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
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body className="bg-background text-foreground antialiased">
        <div className="min-h-screen flex flex-col bg-grain">
          {/* Atmospheric gradient overlay */}
          <div className="fixed inset-0 bg-gradient-to-b from-primary/[0.02] via-transparent to-accent/[0.03] pointer-events-none" />

          {/* Header */}
          <header className="relative h-16 border-b border-border/50 backdrop-blur-sm bg-background/80 flex items-center px-6 shrink-0 z-10">
            <div className="flex items-center gap-3">
              {/* Art deco inspired logo accent */}
              <div className="relative">
                <div className="absolute -inset-1 bg-gradient-to-r from-primary/20 via-primary/10 to-transparent blur-sm" />
                <div className="relative flex items-center gap-2">
                  <div className="w-1 h-6 bg-gradient-to-b from-primary to-accent rounded-full" />
                  <span className="font-display text-xl font-semibold tracking-tight text-foreground">
                    BA Events
                  </span>
                </div>
              </div>
              <span className="text-xs text-muted-foreground tracking-widest uppercase hidden sm:inline ml-2">
                Buenos Aires
              </span>
            </div>
          </header>

          {/* Main content */}
          <div className="relative flex-1 flex flex-col">
            <Outlet />
          </div>
        </div>
        <Scripts />
      </body>
    </html>
  )
}
