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
    ],
    links: [
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
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="bg-background text-foreground">
        <div className="min-h-screen flex flex-col">
          <header className="h-16 border-b flex items-center px-4 shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold">BA Events</span>
              <span className="text-xs text-muted-foreground hidden sm:inline">
                Discover Buenos Aires
              </span>
            </div>
          </header>
          <Outlet />
        </div>
        <Scripts />
      </body>
    </html>
  )
}
