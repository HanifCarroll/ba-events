/** Isolated real route probe: no backend credentials or external requests. */
import type { RequestEvent } from '@sveltejs/kit'

Object.assign(process.env, { ADMIN_API_KEY: 'test-only-key', NODE_ENV: 'production',
  SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '', LANGFUSE_TRACING_ENABLED: 'false' })
let networkCalls = 0
let downstream = 0
globalThis.fetch = async () => { networkCalls++; throw new Error('External requests disabled') }
const events = await import('../../../routes/api/events/+server.ts')
const feedback = await import('../../../routes/api/feedback/+server.ts')
const results = []
for (const [name, method, handler] of [['events-read', 'GET', events.GET], ['events-write', 'POST', events.POST], ['feedback', 'POST', feedback.POST]] as const) {
  const event = { request: new Request('https://baeventos.com/api/events', {
    method, headers: { Authorization: 'Bearer test-only-key', 'content-type': 'application/json' },
    ...(method === 'POST' ? { body: 'not-json' } : {}),
  }), getClientAddress: () => '203.0.113.1',
    get locals() { downstream++; throw new Error('Downstream work must not start') },
  } as unknown as RequestEvent
  const response = await handler(event)
  results.push({ name, status: response.status, retryAfter: response.headers.get('Retry-After'), body: await response.json() })
}
console.log(JSON.stringify({ results, networkCalls, downstream }))
