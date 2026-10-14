/** Isolated, no-network fixture for the real AI SDK production model leaf. */
import { orchestrate, runToolLoop } from './orchestrate.ts'
import type { ChatEventPayload } from '#shared/lib/types.ts'

const streaming = process.argv[2] === 'stream'
const contextBudget = process.argv[2] === 'context-budget'
const controller = new AbortController()
let received: AbortSignal | undefined
let calls = 0
let bodyAborted = false
let started: () => void = () => {}
const ready = new Promise<void>((resolve) => { started = resolve })
globalThis.fetch = async (_input, init) => {
  calls++
  received = init?.signal ?? undefined
  if (contextBudget) return Response.json({
    id: 'test-completion', object: 'chat.completion', created: 1, model: 'deepseek-flash',
    choices: [{ index: 0, finish_reason: 'tool_calls', message: { role: 'assistant', content: null,
      tool_calls: [{ id: 'test-search', type: 'function', function: { name: 'search_events', arguments: '{"objective":"search","limit":1}' } }] } }],
    usage: { prompt_tokens: 17_000, completion_tokens: 10, total_tokens: 17_010 },
  })
  if (streaming) return new Response(new ReadableStream({
    start(body) {
      received!.addEventListener('abort', () => { bodyAborted = true; body.error(received!.reason) }, { once: true })
      started()
    },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } })
  started()
  return new Promise<Response>((_resolve, reject) => {
    received!.addEventListener('abort', () => reject(received!.reason), { once: true })
  })
}
if (contextBudget) {
  let businessReads = 0
  const result = await orchestrate({
    requestId: 'context-budget-test', userContext: { userId: null, isAuthenticated: false },
    locale: 'en', originalQuery: 'Show one event.', priorDisplayedEvents: [],
    readExecutors: { search: async () => {
      businessReads++
      return { success: true, formatted: '{}', events: [{ id: 'kept-event', name: 'Source event',
        starts_at: '2026-10-13T21:00:00Z', ends_at: null, venue_name: null, venue_address: null,
        venue_neighborhood: null, price: null, is_free: false } as ChatEventPayload] }
    } },
  })
  console.log(JSON.stringify({ calls, businessReads, eventIds: result.canonical.events.map(event => event.id), fallbackUsed: result.canonical.provenance.fallbackUsed }))
  process.exit(0)
}
const running = runToolLoop({
  instructions: 'Answer briefly.', messages: [{ role: 'user', content: 'Hello' }],
  tools: {}, abortSignal: controller.signal,
  ...(streaming ? { onText: () => {} } : {}),
})
const outcome = running.then(() => ({ rejected: false }), () => ({ rejected: true }))
await Promise.race([ready, outcome.then(() => { throw new Error('Model settled before the HTTP cancellation probe') })])
controller.abort()
console.log(JSON.stringify({ ...(await outcome), aborted: received?.aborted === true, calls, bodyAborted }))
