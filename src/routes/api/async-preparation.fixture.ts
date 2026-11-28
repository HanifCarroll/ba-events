import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { writeFileSync } from 'node:fs'
// @ts-expect-error Bun-only fixture; application type checking has no Bun test declarations.
import { mock } from 'bun:test'
import { Effect } from 'effect'
import type { RequestEvent } from '@sveltejs/kit'
import type { CanonicalChatResponse } from '#shared/lib/types.ts'

const [, , output, mode] = process.argv
const wire = mode === 'wire'
const replay = mode === 'replay' || wire
const saved: CanonicalChatResponse = {
  contractVersion: 5, requestId: 'saved-request', kind: 'no_results', messageKey: 'no_results',
  text: 'No matching events this week.', events: [], directions: null, venue: null, operations: [], suggestions: [],
  clarificationQuestions: [], provenance: {
    sourceToolCallIds: [], directionToolCallIds: [], venueToolCallIds: [], mutationToolCallIds: [],
    suggestionToolCallIds: [], emptySourceToolCallIds: [], retainedSourceToolCallIds: [], stageIds: [],
    searchAttemptToolCallIds: [], searchIncomplete: false, origin: 'validated', fallbackUsed: false, fallbackReason: null,
  },
}
const started: string[] = []
const effects: string[] = []
const deliveryCalls: string[] = []
const readReplayFrames = async (response: Response) => (await response.text()).split('\n').filter(line => line.startsWith('data: {'))
  .map(line => JSON.parse(line.slice('data: '.length)))
  .filter(frame => ['text-start', 'text-delta', 'text-end', 'data-response', 'error', 'finish'].includes(frame.type))
let release!: () => void
const gate = new Promise<void>(resolve => { release = resolve })
const turnId = '10000000-0000-4000-8000-000000000001'
const attemptId = '20000000-0000-4000-8000-000000000001'
mock.module('#shared/lib/db/client.server.ts', () => ({
  getEventFactsByIds: async () => { started.push('pin'); await gate; return [] },
  getEventsWithVenues: async () => [],
}))
mock.module('#features/auth/api/rate-limit.server.ts', () => ({
  checkApiRateLimit: async () => ({ success: true, reset: 0 }),
  checkRateLimit: async () => ({ success: true, reset: 0 }),
  RATE_LIMIT_RETRY_SECONDS: 30, RATE_LIMIT_REQUESTS: 10,
}))
mock.module('#shared/lib/ai/embeddings.ts', () => ({
  embedEventWithDocument: async () => { throw new Error('Disabled event creation must not call an embedding provider') },
}))
mock.module('#features/events/lib/description-presentation.server.ts', () => ({
  buildDescriptionPresentationFields: async () => { throw new Error('Disabled event creation must not call a presentation provider') },
}))
let running: Promise<Response>
if (mode === 'events') {
  const { POST } = await import('./events/+server.ts')
  running = POST({
    request: new Request('https://example.com/api/events', { method: 'POST', headers: { Authorization: 'Bearer fixture', 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Synthetic Jazz', starts_at: '2026-12-01T20:00:00-03:00' }) }),
    getClientAddress: () => '203.0.113.1',
  } as RequestEvent)
} else {
  assert(mode === 'chat' || replay)
  mock.module('#features/chat/api/user-tools.server.ts', () => ({
    getUserToolContext: async () => ({ userId: 'synthetic-user', isAuthenticated: true }),
    getUserToolContextEffect: () => Effect.succeed({ userId: 'synthetic-user', isAuthenticated: true }),
  }))
  mock.module('#features/chat/api/conversations.server.ts', () => ({
    getConversationEffect: () => Effect.tryPromise(async () => { started.push('history'); await gate; return null }),
  }))
  mock.module('#features/chat/api/turns.server.ts', () => ({
    claimChatTurnEffect: () => Effect.succeed({ status: replay ? 'completed' : 'running', claim_id: attemptId, conversation_id: turnId, user_client_message_id: turnId, assistant_client_message_id: turnId, content: 'Tell me more', locale: 'en' }),
    failChatTurnEffect: () => Effect.sync(() => { effects.push('failed') }),
    completeChatTurnEffect: () => { effects.push('complete'); throw new Error('Must neither save a replay nor complete without history') },
    getTurnAssistantEffect: () => {
      assert(replay, 'Must not replay a running turn')
      return Effect.succeed({ id: 'stored-assistant', canonical: saved })
    },
  }))
  mock.module('#features/chat/api/agent/persist.ts', () => ({
    persistAssistantMessageV4Effect: () => { effects.push('persist assistant'); throw new Error('Must not persist an assistant reply') },
  }))
  mock.module('#features/chat/api/agent/shared-turn.server.ts', () => ({
    normalizeChatTurn: () => { throw new Error('Authenticated text must be authoritative') },
    runSharedChatTurnEffect: () => { effects.push('model'); throw new Error('Must not start the model on replay or without history') },
  }))
  const { POST } = await import('#features/chat/api/execute.server.ts')
  let checkpoint: unknown = null
  const execute = (stage?: 'generate' | 'commit') => POST({
    request: new Request('https://example.com/api/chat/execute', { method: 'POST', headers: {
      'Content-Type': 'application/json', 'x-chat-owner': 'synthetic-user', 'x-chat-turn': turnId,
      'x-chat-attempt': attemptId, 'x-chat-token': 'a'.repeat(64),
      ...(stage ? { 'x-chat-execution-stage': stage, 'x-chat-execution-fence': '1' } : {}),
    }, body: JSON.stringify({
      messages: replay ? [{ role: 'user', parts: [null] }] : [],
      turnId,
      happeningSoonEventId: turnId,
    }) }),
    getClientAddress: () => '203.0.113.1', locals: {},
    platform: { env: { CHAT_DELIVERY: {
      idFromName: (name: string) => name,
      get: () => ({ fetch: async (request: Request) => {
        assert(replay)
        const call = `${request.method} ${new URL(request.url).pathname}`
        deliveryCalls.push(call)
        if (call === 'GET /checkpoint') return Response.json(checkpoint)
        if (call === 'POST /checkpoint') checkpoint = await request.json()
        else assert.equal(call, 'POST /commit')
        return new Response(null, { status: 204 })
      } }),
    } } },
  } as unknown as RequestEvent)
  running = wire ? runDeliveryWireContract() : replay ? execute('generate').then(async response => {
    assert.equal(response.status, 200)
    assert.deepEqual(await readReplayFrames(response), [])
    assert.deepEqual(checkpoint, { canonical: saved, executionTrace: [] })
    return execute('commit')
  }) : execute()
}
// Use the pre-refactor wire values directly, not the production codec, so this
// fixture also runs unchanged on the previous version of both services.
async function runDeliveryWireContract(): Promise<Response> {
  const { ChatDelivery } = await import('../../chat-delivery-worker/index.ts')
  const { POST: start } = await import('./chat/+server.ts')
  const { POST: acceptExecution } = await import('./chat/execute/+server.ts')
  const name = `${turnId}:${attemptId}`
  const secret = 'synthetic-contract-key'
  const token = 'a'.repeat(64)
  const owner = 'synthetic-user'
  const clientIp = '203.0.113.1'
  const body = JSON.stringify({ messages: [], turnId, conversationId: turnId, userClientMessageId: turnId, assistantClientMessageId: turnId })
  const checkpointJson = JSON.stringify({ canonical: saved, executionTrace: [] })
  const hmac = (value: string) => createHmac('sha256', secret).update(value).digest('hex')
  const rows = new Map<string, unknown>()
  const tasks: Promise<unknown>[] = []
  const stages: string[] = []
  const storage = {
    async get<T>(key: string) { return structuredClone(rows.get(key)) as T | undefined },
    async put(entries: Record<string, unknown>) { for (const [key, value] of Object.entries(entries)) rows.set(key, structuredClone(value)) },
    async list<T>({ prefix }: { prefix: string }) { return new Map([...rows].filter(([key]) => key.startsWith(prefix)).sort().map(([key, value]) => [key, value as T])) },
    async setAlarm() {},
    async deleteAll() { rows.clear() },
    async delete(keys: string[]) { for (const key of keys) rows.delete(key) },
  }
  const namespace = {
    idFromName(objectName: string) { assert.equal(objectName, name); return objectName },
    get() { return { fetch: forward } },
  }
  const asWebEvent = (request: Request) => ({ request, locals: {}, getClientAddress: () => clientIp,
    platform: { env: { CHAT_DELIVERY: namespace, CHAT_DELIVERY_SECRET: secret } },
  }) as unknown as RequestEvent
  const object = new ChatDelivery({ storage, waitUntil: task => { tasks.push(task) } }, {
    CHAT_DELIVERY_SECRET: secret, CHAT_DELIVERY: namespace,
    CHAT_RESPONSE_WORKFLOW: {
      async create(input) { assert.deepEqual(input, { id: `${turnId}-${attemptId}`, params: { name } }); return {} },
      async get() { throw new Error('Workflow admission should not need a retry') },
    },
    CHAT_EXECUTION: { async fetch(request) {
      const stage = request.headers.get('x-chat-execution-stage')
      const fence = request.headers.get('x-chat-execution-fence')
      const time = request.headers.get('x-chat-execution-time')
      assert(stage === 'generate' || stage === 'commit')
      assert.equal(fence, stage === 'generate' ? '1' : '2')
      stages.push(stage)
      assert.equal(request.url, 'https://example.com/api/chat/execute')
      assert.equal(request.method, 'POST')
      assert.equal(await request.clone().text(), body)
      assert.equal(request.headers.get('x-chat-client-ip'), clientIp)
      assert.match(time ?? '', /^\d+$/)
      const signature = hmac(JSON.stringify([turnId, attemptId, token, owner, time, fence, stage]))
      assert.equal(request.headers.get('x-chat-execution-auth'), signature)
      const rejected = request.clone()
      rejected.headers.set('x-chat-execution-fence', '0')
      assert.equal((await acceptExecution(asWebEvent(rejected))).status, 404)
      return acceptExecution(asWebEvent(request))
    } },
  })
  async function forward(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname
    if (path === '/checkpoint' || path === '/commit') {
      deliveryCalls.push(`${request.method} ${path}`)
      assert.equal(request.url, `https://chat-delivery${path}`)
      if (request.method === 'POST' && path === '/checkpoint') assert.equal(await request.clone().text(), checkpointJson)
    }
    const response = await object.fetch(request)
    if (path === '/checkpoint' && request.method === 'GET') {
      assert.equal(response.headers.get('content-type')?.split(';')[0], 'application/json')
      assert.equal(await response.clone().text(), checkpointJson)
    }
    return response
  }
  const stream = await start(asWebEvent(new Request('https://example.com/api/chat?drop=executor-query', {
    method: 'POST', headers: { 'x-chat-attempt': attemptId, 'x-chat-token': token }, body,
  })))
  assert.equal(stream.status, 200)
  assert.equal(stream.headers.get('x-chat-reconnectable'), '1')
  assert.equal(stream.headers.get('x-vercel-ai-ui-message-stream'), 'v1')
  assert.equal(stream.headers.get('content-type'), 'text/event-stream')
  await Promise.all(tasks)
  for (const [stage, phase, fence] of [['generate', 'running', 1], ['commit', 'completed', 2]] as const) {
    const url = new URL('https://chat-delivery/run')
    url.searchParams.set('name', name)
    url.searchParams.set('stage', stage)
    const time = String(Date.now())
    const response = await object.fetch(new Request(url, { method: 'POST', headers: {
      'x-chat-workflow-time': time, 'x-chat-workflow-auth': hmac(`${url.pathname}${url.search}:${time}`),
    } }))
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { phase, fence })
    if (stage === 'generate') assert.deepEqual(rows.get('checkpoint'), JSON.parse(checkpointJson))
  }
  assert.deepEqual(stages, ['generate', 'commit'])
  const frames = (await stream.clone().text()).split('\n\n')
  assert.equal(frames.shift(), ': connected')
  assert.equal(frames.pop(), '')
  assert.equal(frames.pop(), 'data: [DONE]')
  assert(frames.length > 0)
  frames.forEach((frame, offset) => assert.match(frame, new RegExp(`^id: ${offset}\\ndata: \\{`)))
  return stream
}

try {
  await new Promise(resolve => setTimeout(resolve, 0))
  if (!replay) assert.deepEqual(started, mode === 'events' ? [] : ['pin', 'history'])
  assert.deepEqual(effects, [])
} finally { release() }
const response = await running
if (mode === 'events') {
  assert.equal(response.status, 500)
  assert.match(await response.text(), /Creating events through the API is not available on D1/)
  assert.deepEqual(effects, [])
} else if (replay) {
  assert.equal(response.status, 200)
  const frames = await readReplayFrames(response)
  assert.deepEqual(frames.slice(-2), [
    { type: 'data-response', data: saved }, { type: 'finish', finishReason: 'stop' },
  ])
  const text = frames.slice(0, -2)
  assert.equal(text[0]?.type, 'text-start')
  assert.equal(text.at(-1)?.type, 'text-end')
  assert(text.every(frame => frame.id === text[0].id))
  const deltas = text.slice(1, -1)
  assert(deltas.every(frame => frame.type === 'text-delta'))
  assert.equal(deltas.map(frame => frame.delta).join(''), saved.text)
  assert.deepEqual(deliveryCalls, ['POST /checkpoint', 'GET /checkpoint', 'POST /commit'])
  assert.deepEqual(effects, [])
} else {
  assert.match(await response.text(), /Chat turn unavailable/)
  assert.deepEqual(effects, ['failed'])
}
writeFileSync(output, JSON.stringify({ mode, passed: true }))
