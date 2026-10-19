/** Real SDK transport, deterministic source reads, no network. */
import { orchestrate, runToolLoop } from './orchestrate.ts'
import type { ChatEventPayload } from '#shared/lib/types.ts'

const mode = process.argv[2] ?? 'complete'
const locale = process.argv[3] === 'es' ? 'es' : 'en'
const eventId = '11111111-1111-4111-8111-111111111111'
const venueId = '22222222-2222-4222-8222-222222222222'
let calls = 0, directionReads = 0, detailReads = 0
const toolCall = (name: string, input: unknown) => ({ id: `call-${calls}`, type: 'function', function: { name, arguments: JSON.stringify(input) } })
globalThis.fetch = async (_url, init) => {
  calls++
  const body = JSON.parse(String(init?.body))
  const call = mode === 'ambiguous' && calls === 1
    ? toolCall('ask_clarification', { key: 'which_event', reason: 'Multiple possible events' })
    : mode === 'details-first' && calls === 1
      ? toolCall('get_event_details', { eventRef: 'pinned_event', purpose: 'details' })
    : mode === 'details-first' && calls === 2
      ? toolCall('get_directions', { eventRef: 'pinned_event', completeAnswer: true })
    : calls === 1
      ? toolCall('get_directions', { eventRef: 'pinned_event', ...(mode === 'default' ? {} : { completeAnswer: mode !== 'continue' }) })
      : mode === 'continue' && calls === 2
        ? toolCall('get_event_details', { eventRef: 'pinned_event', purpose: 'details' })
        : mode === 'failed' && calls === 2
          ? toolCall('get_directions', { venueRef: 'pinned_venue', completeAnswer: true }) : null
  const message = { role: 'assistant', content: call ? null : 'The source describes live jazz.', ...(call ? { tool_calls: [call] } : {}) }
  if (body.stream) throw new Error('This fixture exercises non-streaming SDK execution')
  return Response.json({ id: `response-${calls}`, object: 'chat.completion', created: 1, model: 'deepseek-flash',
    choices: [{ index: 0, finish_reason: call ? 'tool_calls' : 'stop', message }],
    usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } })
}
const result = await orchestrate({
  requestId: 'direct-directions-fixture', originalQuery: ['continue', 'details-first'].includes(mode) ? 'Give me directions and tell me about the music.' : 'How do I get there?',
  locale, userContext: { userId: null, isAuthenticated: false }, priorDisplayedEvents: [],
  pin: { requested: true, status: 'resolved', eventId, venueId },
  runAgentFn: input => runToolLoop(input, { completeDirections: mode !== 'default' }),
  readExecutors: {
    directions: async () => {
      directionReads++
      if (mode === 'failed' && directionReads === 1) return { success: false, formatted: '{}', error: 'location_unavailable' }
      return { success: true, formatted: '{}', directions: { eventId, venueName: 'Source venue', address: 'Source address 123', mapsUrl: 'https://maps.google.com/?daddr=Source+address+123' } }
    },
    eventDetails: async () => { detailReads++; return { success: true, formatted: '{}', events: [{ id: eventId, name: 'Source event',
      description: 'Live jazz.', starts_at: '2026-10-20T20:00:00Z', ends_at: null, venue_name: 'Source venue', venue_address: 'Source address 123',
      venue_neighborhood: 'Palermo', price: null, is_free: true } as unknown as ChatEventPayload] } },
  },
})
console.log(JSON.stringify({ calls, directionReads, detailReads, text: result.canonical.text, kind: result.canonical.kind,
  eventId: result.canonical.directions?.eventId, fallback: result.canonical.provenance.fallbackUsed,
  reads: result.reads.map(read => ({ tool: read.toolName, success: read.success })) }))
process.exit(0)
