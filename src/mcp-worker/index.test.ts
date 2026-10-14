import { describe, expect, it, vi } from 'vitest'
import { createWorkerHandler } from './index.ts'
import { publicSearchInputSchema, toPublicEvent } from './public.ts'
import type { EventWithVenue } from '#shared/lib/types.ts'
import { EMPTY_FACETS } from '#shared/lib/search-facets.ts'

const EVENT_ID = '11111111-1111-4111-8111-111111111111'

const event: EventWithVenue = {
  id: EVENT_ID,
  name: 'Public show',
  description_es: 'Full Spanish description',
  description_en: null,
  description_display_es: 'Full Spanish description',
  description_display_en: null,
  description_summary_es: 'Un show',
  description_summary_en: null,
  starts_at: '2026-08-27T20:00:00Z',
  ends_at: null,
  is_all_day: false,
  time_tba: false,
  venue_id: '22222222-2222-4222-8222-222222222222',
  categories: ['music'],
  price: 100,
  is_free: false,
  min_age: null,
  image_url: null,
  link: 'https://source.test/event',
  ticket_url: 'https://tickets.test/event',
  source: 'internal-source',
  external_id: 'secret-external-id',
  status: 'scheduled',
  location_hidden: false,
  location_tba: false,
  description_unavailable: false,
  enrichment_status: 'completed',
  enrichment_error: null,
  enriched_at: null,
  facets: EMPTY_FACETS,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  venue_name: 'Club',
  venue_neighborhood: 'Palermo',
  venue_address: 'Secret 123',
  embedding: [1],
}

const ctx = {} as Parameters<ReturnType<typeof createWorkerHandler>>[2]

function env(outcome: { success: boolean } = { success: true }): Env {
  return { MCP_RATE_LIMIT: { limit: vi.fn(async () => outcome) } }
}

function rpcRequest(method: string, params: object, id = 1, origin = 'https://chatgpt.com', source?: string) {
  return new Request('https://mcp.test/mcp', {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      origin,
      ...(source ? { 'X-BA-Eventos-Source': source } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  })
}

async function rpc(
  handler: ReturnType<typeof createWorkerHandler>,
  method: string,
  params: object,
  requestEnv: Env = env(),
) {
  const response = await handler(rpcRequest(method, params), requestEnv, ctx)
  const text = await response.text()
  const payload = text.startsWith('event:')
    ? text.split('\n').find((line) => line.startsWith('data: '))?.slice(6)
    : text
  if (!payload) throw new Error('Missing JSON-RPC response')
  return { response, body: JSON.parse(payload) as Record<string, unknown> }
}

describe('public MCP boundary', () => {
  for (const tool of ['search_events', 'get_event'] as const) {
    it(`${tool} cancels its reader and excludes late results when the HTTP caller stops`, async () => {
      const controller = new AbortController()
      let received: AbortSignal | undefined
      let started!: () => void, release!: () => void
      const began = new Promise<void>(resolve => { started = resolve })
      const pending = new Promise<void>(resolve => { release = resolve })
      const read = async (signal?: AbortSignal) => { received = signal; started(); await pending }
      const handler = createWorkerHandler({
        search: async (_input, signal) => { await read(signal); return { success: true, events: [event] } },
        get: async (_id, signal) => { await read(signal); return event },
      })
      const request = new Request(rpcRequest('tools/call', { name: tool,
        arguments: tool === 'get_event' ? { eventId: EVENT_ID } : { query: 'music' } }), { signal: controller.signal })
      const running = handler(request, env(), ctx)
      await began
      controller.abort(new Error('Caller stopped'))
      release()
      const response = await running
      expect(received?.aborted).toBe(true)
      expect(await response.text()).not.toContain('Public show')
    })

    it(`${tool} aborts its owned read at the deadline without retrying`, async () => {
      let received: AbortSignal | undefined, calls = 0
      const read = (signal?: AbortSignal) => { received = signal; calls++; return new Promise<never>(() => {}) }
      const handler = createWorkerHandler({ toolTimeoutMs: 5,
        search: async (_input, signal) => read(signal), get: async (_id, signal) => read(signal) })
      const { body } = await rpc(handler, 'tools/call', { name: tool,
        arguments: tool === 'get_event' ? { eventId: EVENT_ID } : { query: 'music' } })
      expect(received?.aborted).toBe(true)
      expect(calls).toBe(1)
      expect((body.result as { isError: boolean }).isError).toBe(true)
    })
  }

  it('lists exactly the two public read tools', async () => {
    const handler = createWorkerHandler()
    const { response, body } = await rpc(handler, 'tools/list', {})
    const result = body.result as { tools: Array<{ name: string }> }

    expect(response.status).toBe(200)
    expect(result.tools.map((tool) => tool.name)).toEqual(['search_events', 'get_event'])
  })

  it('calls search_events through the protocol and returns only whitelisted fields', async () => {
    const search = vi.fn(async () => ({ success: true, events: [event] }))
    const handler = createWorkerHandler({ search })
    const { response, body } = await rpc(handler, 'tools/call', {
      name: 'search_events',
      arguments: { query: 'music', limit: 1 },
    })
    const result = body.result as { structuredContent: { events: Array<Record<string, unknown>> } }

    expect(response.status).toBe(200)
    expect(search).toHaveBeenCalledOnce()
    expect(result.structuredContent.events[0]).toEqual(expect.objectContaining({ id: EVENT_ID, name: 'Public show' }))
    expect(JSON.stringify(result)).not.toContain('embedding')
    expect(JSON.stringify(result)).not.toContain('external_id')
    expect(JSON.stringify(result)).not.toContain('enrichment')
  })

  it('rejects invalid search input before execution', async () => {
    const search = vi.fn(async () => ({ success: true, events: [] }))
    const handler = createWorkerHandler({ search })
    const { body } = await rpc(handler, 'tools/call', {
      name: 'search_events',
      arguments: { venueIds: ['secret'], limit: 6 },
    })

    expect(search).not.toHaveBeenCalled()
    expect(JSON.stringify(body)).toMatch(/invalid/i)
  })

  it('preserves a model-readable note for an unknown venue', async () => {
    const handler = createWorkerHandler({ search: async () => ({ success: true, events: [], note: 'unknown venue: Missing Club' }) })
    const { body } = await rpc(handler, 'tools/call', {
      name: 'search_events',
      arguments: { venueName: 'Missing Club' },
    })
    const result = body.result as { structuredContent: { note: string } }

    expect(result.structuredContent.note).toBe('unknown venue: Missing Club')
  })

  it('returns a protocol error for an unknown tool', async () => {
    const handler = createWorkerHandler()
    const { body } = await rpc(handler, 'tools/call', { name: 'missing_tool', arguments: {} })
    expect(JSON.stringify(body)).toMatch(/not found/i)
  })

  it('redacts hidden locations and rejects non-displayable details', async () => {
    expect(toPublicEvent({ ...event, location_hidden: true }).venue).toEqual({ name: 'Club', neighborhood: 'Palermo' })

    const handler = createWorkerHandler({ get: async () => ({ ...event, status: 'canceled' }) })
    const { body } = await rpc(handler, 'tools/call', {
      name: 'get_event',
      arguments: { eventId: EVENT_ID },
    })
    const result = body.result as { isError: boolean; structuredContent: { error: string } }

    expect(result.isError).toBe(true)
    expect(result.structuredContent.error).toContain('not publicly available')
  })

  it('rejects disallowed browser origins', async () => {
    const handler = createWorkerHandler()
    const response = await handler(rpcRequest('tools/list', {}, 1, 'https://evil.example'), env(), ctx)
    expect(response.status).toBe(403)
  })

  it('rate limits and fails closed before MCP handling', async () => {
    const handler = createWorkerHandler()
    const request = () => rpcRequest('tools/call', { name: 'missing_tool', arguments: {} })
    const limited = await handler(request(), env({ success: false }), ctx)
    const unavailable = await handler(
      request(),
      { MCP_RATE_LIMIT: { limit: vi.fn(async () => { throw new Error('down') }) } },
      ctx,
    )

    expect(limited.status).toBe(429)
    expect(unavailable.status).toBe(429)
  })

  it('does not spend tool quota on protocol discovery', async () => {
    const limiter = vi.fn(async () => ({ success: true }))
    const handler = createWorkerHandler()

    await handler(rpcRequest('tools/list', {}), { MCP_RATE_LIMIT: { limit: limiter } }, ctx)

    expect(limiter).not.toHaveBeenCalled()
  })

  it('marks only explicitly tagged calls as dogfood', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const handler = createWorkerHandler({ search: async () => ({ success: true, events: [] }) })

    const tagged = await handler(rpcRequest('tools/call', { name: 'search_events', arguments: {} }, 1, 'https://chatgpt.com', 'dogfood'), env(), ctx)
    await tagged.text()
    const untagged = await handler(rpcRequest('tools/call', { name: 'search_events', arguments: {} }), env(), ctx)
    await untagged.text()

    const calls = log.mock.calls
      .map(([entry]) => JSON.parse(String(entry)) as { event?: string; audience?: string })
      .filter((entry) => entry.event === 'mcp_tool_call')
    expect(calls.map((entry) => entry.audience)).toEqual(['dogfood', 'external'])
    log.mockRestore()
  })

  it('keeps the public search schema bounded', () => {
    expect(publicSearchInputSchema.safeParse({ categories: ['music'], neighborhoods: ['Palermo'], limit: 5 }).success).toBe(true)
    expect(publicSearchInputSchema.safeParse({ categories: ['unknown'] }).success).toBe(false)
    expect(publicSearchInputSchema.safeParse({ dateFrom: '2026-08-28', dateTo: '2026-08-27' }).success).toBe(false)
  })
})
