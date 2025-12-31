// import { paraglideMiddleware } from './paraglide/server.js'
import handler, { createServerEntry } from '@tanstack/react-start/server-entry'

export default createServerEntry({
  fetch(req: Request): Promise<Response> {
    // Temporarily bypass paraglide middleware due to compatibility issues
    // with TanStack Start 1.145.x
    return handler.fetch(req)
    // return paraglideMiddleware(req, ({ request }) => handler.fetch(request))
  },
})
