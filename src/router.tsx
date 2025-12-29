import { createRouter } from '@tanstack/react-router'

// Import the generated route tree
import { routeTree } from './routeTree.gen'

function DefaultPendingComponent() {
  return (
    <div className="flex items-center justify-center p-8">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  )
}

function DefaultNotFoundComponent() {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center">
      <h1 className="text-2xl font-display font-semibold mb-2">Page Not Found</h1>
      <p className="text-muted-foreground">The page you're looking for doesn't exist.</p>
    </div>
  )
}

// Create a new router instance
export const getRouter = () => {
  const router = createRouter({
    routeTree,
    context: {},

    scrollRestoration: true,
    defaultPreloadStaleTime: 0,

    // Preloading - load data on hover before user clicks
    defaultPreload: 'intent',
    defaultPreloadDelay: 50,

    // Pending - show loading indicator after threshold
    defaultPendingMs: 300,
    defaultPendingMinMs: 200,
    defaultPendingComponent: DefaultPendingComponent,

    // 404 page
    defaultNotFoundComponent: DefaultNotFoundComponent,
  })

  return router
}
