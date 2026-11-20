import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
// @ts-expect-error Bun-only fixture; application type checking has no Bun test declarations.
import { mock } from 'bun:test'
import { Effect } from 'effect'
import type { RequestEvent } from '@sveltejs/kit'
import type { CanonicalChatResponse } from '#shared/lib/types.ts'
import { EXECUTION_FENCE_HEADER, EXECUTION_STAGE_HEADER, type ExecutionStage } from '../../chat-delivery-worker/recovery.ts'

const [, , output, mode] = process.argv
const replay = mode === 'replay'
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
  const execute = (stage?: ExecutionStage) => POST({
    request: new Request('https://example.com/api/chat/execute', { method: 'POST', headers: {
      'Content-Type': 'application/json', 'x-chat-owner': 'synthetic-user', 'x-chat-turn': turnId,
      'x-chat-attempt': attemptId, 'x-chat-token': 'a'.repeat(64),
      ...(stage ? { [EXECUTION_STAGE_HEADER]: stage, [EXECUTION_FENCE_HEADER]: '1' } : {}),
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
  running = replay ? execute('generate').then(async response => {
    assert.equal(response.status, 200)
    assert.deepEqual(await readReplayFrames(response), [])
    assert.deepEqual(checkpoint, { canonical: saved, executionTrace: [] })
    return execute('commit')
  }) : execute()
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
