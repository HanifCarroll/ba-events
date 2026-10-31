import type { RequestEvent } from '@sveltejs/kit'
import { runSchemathesis } from './schemathesis.mjs'

// Import after the synthetic key is installed; the route snapshots it at load.
process.env.ADMIN_API_KEY = 'fuzz-only-local-api-key'
const events = await import('../../src/routes/api/events/+server')
const bootstrap = await import('../../src/routes/api/chat/bootstrap/+server')

await runSchemathesis(async () => ({
  async handle(request: Request) {
    const url = new URL(request.url)
    const event = {
      request, url, locals: { user: null }, params: {},
      getClientAddress: () => '127.0.0.1',
    } as unknown as RequestEvent
    if (url.pathname === '/api/events') {
      if (request.method === 'GET') return events.GET(event)
      if (request.method === 'POST') return events.POST(event)
    }
    if (url.pathname === '/api/chat/bootstrap' && request.method === 'POST') return bootstrap.POST(event)
    return new Response(null, { status: 404 })
  },
}), 'tests/fuzz/openapi.json')
