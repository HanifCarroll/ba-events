import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
// @ts-expect-error Bun-only fixture; application type checking has no Bun test declarations.
import { mock } from 'bun:test'
import { Effect } from 'effect'
import type { RequestEvent } from '@sveltejs/kit'
import type { CanonicalChatResponse } from '#shared/lib/types.ts'

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
const writes: unknown[] = []
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
    failChatTurnEffect: () => Effect.sync(() => { writes.push('failed') }),
    completeChatTurnEffect: () => { throw new Error('Must neither save a replay nor complete without history') },
    getTurnAssistantEffect: () => {
      assert(replay, 'Must not replay a running turn')
      return Effect.succeed({ id: 'stored-assistant', canonical: saved })
    },
  }))
  mock.module('#features/chat/api/agent/shared-turn.server.ts', () => ({
    normalizeChatTurn: () => { throw new Error('Authenticated text must be authoritative') },
    runSharedChatTurnEffect: () => { throw new Error('Must not start the model on replay or without history') },
  }))
  const { POST } = await import('#features/chat/api/execute.server.ts')
  running = POST({
    request: new Request('https://example.com/api/chat/execute', { method: 'POST', headers: {
      'Content-Type': 'application/json', 'x-chat-owner': 'synthetic-user', 'x-chat-turn': turnId,
      'x-chat-attempt': attemptId, 'x-chat-token': 'a'.repeat(64),
    }, body: JSON.stringify({ messages: [], turnId, happeningSoonEventId: turnId }) }),
    getClientAddress: () => '203.0.113.1', locals: {},
    platform: { env: { CHAT_DELIVERY: {
      idFromName: (name: string) => name,
      get: () => ({ fetch: async (request: Request) => {
        assert(replay)
        assert.equal(new URL(request.url).pathname, '/commit')
        return new Response(null, { status: 204 })
      } }),
    } } },
  } as unknown as RequestEvent)
}
try {
  await new Promise(resolve => setTimeout(resolve, 0))
  if (!replay) assert.deepEqual(started, mode === 'events' ? [] : ['pin', 'history'])
  assert.equal(writes.length, 0)
} finally { release() }
const response = await running
if (mode === 'events') {
  assert.equal(response.status, 500)
  assert.match(await response.text(), /Creating events through the API is not available on D1/)
  assert.equal(writes.length, 0)
} else if (replay) {
  assert.equal(response.status, 200)
  const frames = (await response.text()).split('\n').filter(line => line.startsWith('data: {'))
    .map(line => JSON.parse(line.slice('data: '.length)))
  assert.deepEqual(frames.filter(frame => frame.type === 'data-response'), [{ type: 'data-response', data: saved }])
  assert.deepEqual(frames.filter(frame => frame.type === 'finish'), [{ type: 'finish', finishReason: 'stop' }])
  assert.equal(writes.length, 0)
} else {
  assert.match(await response.text(), /Chat turn unavailable/)
  assert.deepEqual(writes, ['failed'])
}
writeFileSync(output, JSON.stringify({ mode, passed: true }))
