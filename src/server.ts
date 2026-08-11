import { createStartHandler, defaultStreamHandler } from '@tanstack/react-start/server'
import type { RequestOptions } from '@tanstack/react-start/server'
import type { Register } from '@tanstack/react-router'
import { paraglideMiddleware } from './paraglide/server'

const startHandler = createStartHandler(defaultStreamHandler)

// Custom server entry: route every request through paraglide's locale
// middleware so SSR resolves the same locale the client will resolve.
//
// Without this, on a request with no locale cookie the server falls back to
// the base locale (es) while the client uses the browser's preferred language
// (en) — the two disagree, React's hydration fails at the <html lang>
// attribute, and the whole tree is regenerated client-side on first load.
// That regeneration is the "flash a few times, then the fade-up" on load:
// every animated element is remounted and its fade-in-up animation replays.
export default {
  async fetch(request: Request, opts?: RequestOptions<Register>): Promise<Response> {
    return paraglideMiddleware(request, async ({ request: newRequest }) => {
      return startHandler(newRequest, opts)
    })
  },
}
