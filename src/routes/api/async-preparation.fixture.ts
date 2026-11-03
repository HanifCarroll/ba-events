import assert from 'node:assert/strict'
// @ts-expect-error Bun-only fixture; application type checking has no Bun test declarations.
import { mock } from 'bun:test'
import { Effect } from 'effect'
import type { RequestEvent } from '@sveltejs/kit'

const mode = process.argv[2]
const started: string[] = []
const writes: unknown[] = []
let release!: () => void
const gate = new Promise<void>(resolve => { release = resolve })
const turnId = '10000000-0000-4000-8000-000000000001'
const attemptId = '20000000-0000-4000-8000-000000000001'
mock.module('#shared/lib/db/client.server.ts', () => ({
  getEventFactsByIds: async () => { started.push('pin'); await gate; return [] },
  createEvent: async (data: unknown) => { writes.push(data); return { id: turnId } },
  getEventsWithVenues: async () => [],
}))
mock.module('#features/auth/api/rate-limit.server.ts', () => ({
  checkApiRateLimit: async () => ({ success: true, reset: 0 }),
  checkRateLimit: async () => ({ success: true, reset: 0 }),
  RATE_LIMIT_RETRY_SECONDS: 30, RATE_LIMIT_REQUESTS: 10,
}))
mock.module('#shared/lib/ai/embeddings.ts', () => ({
  CURRENT_EMBEDDING_VERSION: 2,
  embedEventWithDocument: async () => { started.push('embedding'); await gate; return { embedding: [0.1], searchDocument: 'Synthetic Jazz' } },
}))
mock.module('#features/events/lib/description-presentation.server.ts', () => ({
  buildDescriptionPresentationFields: async () => { started.push('presentation'); await gate; return { description_display_es: 'Jazz.' } },
}))
let running: Promise<Response>
if (mode === 'events') {
  const { POST } = await import('./events/+server.ts')
  running = POST({
    request: new Request('https://example.com/api/events', { method: 'POST', headers: { Authorization: 'Bearer fixture', 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Synthetic Jazz', starts_at: '2026-12-01T20:00:00-03:00' }) }),
    getClientAddress: () => '203.0.113.1',
  } as RequestEvent)
} else {
  assert.equal(mode, 'chat')
  mock.module('#features/chat/api/user-tools.server.ts', () => ({
    getUserToolContext: async () => ({ userId: 'synthetic-user', isAuthenticated: true }),
    getUserToolContextEffect: () => Effect.succeed({ userId: 'synthetic-user', isAuthenticated: true }),
  }))
  mock.module('#features/chat/api/conversations.server.ts', () => ({
    getConversationEffect: () => Effect.tryPromise(async () => { started.push('history'); await gate; return null }),
  }))
  mock.module('#features/chat/api/turns.server.ts', () => ({
    claimChatTurnEffect: () => Effect.succeed({ status: 'running', claim_id: attemptId, conversation_id: turnId, user_client_message_id: turnId, assistant_client_message_id: turnId, content: 'Tell me more', locale: 'en' }),
    failChatTurnEffect: () => Effect.sync(() => { writes.push('failed') }),
    completeChatTurnEffect: () => { throw new Error('Must not complete without history') },
    getTurnAssistantEffect: () => { throw new Error('Must not replay a running turn') },
  }))
  mock.module('#features/chat/api/agent/shared-turn.server.ts', () => ({
    normalizeChatTurn: () => { throw new Error('Authenticated text must be authoritative') },
    runSharedChatTurnEffect: () => { throw new Error('Must not start the model without history') },
  }))
  const { POST } = await import('#features/chat/api/execute.server.ts')
  running = POST({
    request: new Request('https://example.com/api/chat/execute', { method: 'POST', headers: {
      'Content-Type': 'application/json', 'x-chat-owner': 'synthetic-user', 'x-chat-turn': turnId,
      'x-chat-attempt': attemptId, 'x-chat-token': 'a'.repeat(64),
    }, body: JSON.stringify({ messages: [], turnId, happeningSoonEventId: turnId }) }),
    getClientAddress: () => '203.0.113.1', locals: {},
  } as RequestEvent)
}
try {
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(started, mode === 'events' ? ['embedding', 'presentation'] : ['pin', 'history'])
  assert.equal(writes.length, 0)
} finally { release() }
const response = await running
if (mode === 'events') {
  assert.equal(response.status, 201)
  assert.equal(writes.length, 1)
  const written = writes[0] as Record<string, unknown>
  assert.deepEqual(written.embedding, [0.1])
  assert.equal(written.search_document, 'Synthetic Jazz')
  assert.equal(written.description_display_es, 'Jazz.')
} else {
  assert.match(await response.text(), /Chat turn unavailable/)
  assert.deepEqual(writes, ['failed'])
}
console.log(JSON.stringify({ mode, passed: true }))
