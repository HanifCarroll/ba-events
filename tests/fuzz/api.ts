import assert from 'node:assert/strict'
import type { RequestEvent } from '@sveltejs/kit'
import { runSchemathesis } from './schemathesis.mjs'
import { handleTelegramWebhook } from '../../src/features/telegram/webhook.server.ts'
import { openTelegramEnvelope } from '../../src/features/telegram/envelope.server.ts'
import { parseTelegramPlaintextPayload } from '../../src/features/telegram/task-payload.ts'
import { parseTelegramUpdate, parseTelegramText } from '../../src/features/telegram/update.ts'
import { chatDeliveryFixture } from '../support/chat-delivery-fixture.ts'

// All credentials and sessions here are fixtures. The Supabase transport is
// local; it checks RPC mapping but does not stand in for production SQL/RLS tests.
process.env.ADMIN_API_KEY = 'fuzz-only-local-api-key'
const events = await import('../../src/routes/api/events/+server')
const bootstrap = await import('../../src/routes/api/chat/bootstrap/+server')
const key = Buffer.alloc(32, 7).toString('base64')
const ownerId = '10000000-0000-4000-8000-000000000001'
let successfulBootstraps = 0, telegramDispatches = 0, authorizedDelivery = 0, rejectedDelivery = 0

await runSchemathesis(async (origin: string) => {
  let rpcCalls = 0
  const rpc = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    assert.equal(new URL(request.url).pathname, '/rest/v1/rpc/bootstrap_chat_turn')
    const input = await request.json() as Record<string, unknown>
    assert.deepEqual(Object.keys(input).sort(), ['p_assistant_client_message_id', 'p_content', 'p_conversation_id', 'p_locale', 'p_turn_id', 'p_user_client_message_id'])
    assert.equal(typeof input.p_content, 'string')
    assert.ok((input.p_content as string).trim().length > 0)
    rpcCalls++
    return Response.json({ id: input.p_turn_id, conversation_id: input.p_conversation_id,
      user_message_id: input.p_user_client_message_id, assistant_message_id: null,
      user_client_message_id: input.p_user_client_message_id, assistant_client_message_id: input.p_assistant_client_message_id,
      content: input.p_content, locale: input.p_locale, status: 'pending', claim_id: null,
      claimed_until: null, attempt_count: 0, last_error: null })
  } })
  process.env.SUPABASE_URL = `http://127.0.0.1:${rpc.port}`
  process.env.SUPABASE_ANON_KEY = 'synthetic-anon-key'
  const application = {
    async handle(request: Request) {
      const url = new URL(request.url)
      const user = request.headers.get('x-test-session') === 'owner' ? { id: ownerId } : null
      const event = { request, url, locals: { user }, params: {}, cookies: { getAll: () => [], set() {} },
        getClientAddress: () => '127.0.0.1' } as unknown as RequestEvent
      if (url.pathname === '/api/events') {
        if (request.method === 'GET') return events.GET(event)
        if (request.method === 'POST') return events.POST(event)
      }
      if (url.pathname === '/api/chat/bootstrap' && request.method === 'POST') {
        const before = rpcCalls
        const input = await request.clone().json().catch(() => null) as { turnId: string } | null
        const response = await bootstrap.POST(event)
        if (response.status === 200) {
          assert.ok(user)
          assert.equal(rpcCalls, before + 1)
          const { turn } = await response.clone().json() as { turn: { content: string; id: string } }
          assert.equal(turn.id, input?.turnId)
          assert.ok(turn.content.trim())
          successfulBootstraps++
        } else assert.equal(rpcCalls, before, 'Rejected bootstrap must not persist')
        return response
      }
      if (url.pathname === '/api/telegram' && request.method === 'POST') {
        const body = await request.clone().json().catch(() => null)
        const update = parseTelegramUpdate(body)
        let dispatched = 0
        const response = await handleTelegramWebhook(request, {
          webhookSecret: 'synthetic-secret', identitySecret: 'i'.repeat(32),
          claim: async () => ({ completed: false, envelopeKey: key, checkRateLimit: true }),
          getOrCreateConversation: (async () => ({ id: ownerId })) as never,
          attachConversation: async () => undefined, markFailed: async () => undefined,
          rateLimit: async () => ({ success: true, remaining: 1, reset: 0 }),
          trigger: async (payload, options) => {
            assert.ok(update)
            assert.equal(payload.updateId, update.update_id)
            assert.equal(options.idempotencyKey, `telegram-update:${update.update_id}`)
            assert.equal(options.concurrencyKey, ownerId)
            const plain = parseTelegramPlaintextPayload(openTelegramEnvelope(payload.sealedEnvelope, key, payload.updateId, payload.queueKey))
            assert.ok(plain)
            if ('message' in update) assert.equal(plain.text, update.message.text)
            else assert.equal(plain.callbackData, update.callback_query.data)
            dispatched++; telegramDispatches++
          },
        })
        const accepted = request.headers.get('x-telegram-bot-api-secret-token') === 'synthetic-secret'
          && update && (!('message' in update) || parseTelegramText(update.message.text))
        assert.equal(dispatched, accepted ? 1 : 0)
        return response
      }
      if (url.pathname.startsWith('/delivery/')) {
        const action = url.pathname.slice('/delivery/'.length)
        const fixture = chatDeliveryFixture()
        // Seed the real object with one known owner/capability and end its
        // producer so generated reads have a finite, real replay stream.
        const started = await fixture.object.fetch(fixture.request('start'))
        await started.body?.cancel()
        await Promise.all(fixture.tasks)
        await fixture.object.fetch(fixture.request('stop'))
        const principal = request.headers.get('x-test-session') === 'owner' ? fixture.owner : 'another-owner'
        const token = request.headers.get('x-chat-token') ?? ''
        const body = action === 'start' ? await request.text() : undefined
        const forwarded = fixture.request(action, { owner: principal, token, ...(body !== undefined ? { body } : {}) })
        const before = { storage: structuredClone([...fixture.values]), admissions: fixture.admissions }
        const response = await fixture.object.fetch(forwarded)
        const authorized = principal === fixture.owner && token === fixture.identity.token
        if (action === 'start') {
          const expected = Buffer.byteLength(body!, 'utf8') > 128 * 1024 ? 413
            : !/^[0-9a-f]{64}$/.test(token) ? 400
            : authorized && body === '{"message":"Synthetic question"}' ? 200 : 409
          assert.equal(response.status, expected, 'Start must preserve payload, owner and capability authority')
        } else assert.equal(response.status, authorized ? action === 'stop' ? 204 : 200 : 403)
        if (!response.ok) {
          assert.deepEqual([...fixture.values], before.storage, 'Rejected delivery request must not mutate durable state')
          assert.equal(fixture.admissions, before.admissions, 'Rejected delivery request must not admit work')
        }
        if (response.ok) authorizedDelivery++; else rejectedDelivery++
        return response
      }
      return new Response(null, { status: 404 })
    },
    close() {
      rpc.stop(true)
      assert.ok(successfulBootstraps > 0, 'Must exercise successful authenticated chat bootstrap')
      assert.ok(telegramDispatches > 0, 'Must exercise successful Telegram dispatch')
      assert.ok(authorizedDelivery > 0 && rejectedDelivery > 0, 'Must exercise delivery ownership acceptance and rejection')
      console.log(JSON.stringify({ successfulBootstraps, telegramDispatches, authorizedDelivery, rejectedDelivery }))
    },
  }
  // Fixed probes ensure exact-payload replay and each rejection oracle run even
  // when generated JSON uses a different whitespace representation.
  try {
    for (const probe of [
      { session: 'owner', token: 'a'.repeat(64), body: '{"message":"Synthetic question"}', status: 200 },
      { session: 'anonymous', token: 'a'.repeat(64), body: '{"message":"Synthetic question"}', status: 409 },
      { session: 'owner', token: 'b'.repeat(64), body: '{"message":"Synthetic question"}', status: 409 },
      { session: 'owner', token: 'a'.repeat(64), body: '{"message":"Changed question"}', status: 409 },
      { session: 'owner', token: 'invalid', body: '{"message":"Synthetic question"}', status: 400 },
      { session: 'owner', token: '', body: '{"message":"Synthetic question"}', status: 400 },
    ]) {
      const response = await application.handle(new Request(`${origin}/delivery/start`, { method: 'POST', body: probe.body,
        headers: { 'x-test-session': probe.session, ...(probe.token ? { 'x-chat-token': probe.token } : {}) } }))
      assert.equal(response.status, probe.status)
      await response.body?.cancel()
    }
  } catch (error) {
    rpc.stop(true)
    throw error
  }
  return application
}, 'tests/fuzz/openapi.json')
