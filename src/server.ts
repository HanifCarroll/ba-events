import { paraglideMiddleware } from './paraglide/server.js'
import handler, { createServerEntry } from '@tanstack/react-start/server-entry'

// Temporarily bypass paraglide middleware to test AsyncLocalStorage issue
const USE_PARAGLIDE = false

export default createServerEntry({
  fetch(req: Request): Promise<Response> {
    if (USE_PARAGLIDE) {
      return paraglideMiddleware(req, ({ request }) => handler.fetch(request))
    }
    return handler.fetch(req)
  },
})
