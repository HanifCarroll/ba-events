import assert from 'node:assert/strict'
import type { RequestEvent } from '@sveltejs/kit'
import type { ChatTurnBootstrapInput } from '../../src/features/chat/api/turn-authority.ts'
import { runSchemathesis } from './schemathesis.mjs'
import { handleTelegramWebhook } from '../../src/features/telegram/webhook.server.ts'
import { openTelegramEnvelope } from '../../src/features/telegram/envelope.server.ts'
import { parseTelegramPlaintextPayload } from '../../src/features/telegram/task-payload.ts'
import { parseTelegramUpdate, parseTelegramText } from '../../src/features/telegram/update.ts'
import { chatDeliveryFixture } from '../support/chat-delivery-fixture.ts'

import { freshD1 } from '../support/d1.ts'
import { useD1Binding } from '../../src/shared/lib/db/d1-binding.server.ts'

// All credentials, sessions, and persisted rows here are synthetic.
process.env.ADMIN_API_KEY = 'fuzz-only-local-api-key'
const events = await import('../../src/routes/api/events/+server')
const bootstrap = await import('../../src/routes/api/chat/bootstrap/+server')
const key = Buffer.alloc(32, 7).toString('base64')
const ownerId = '10000000-0000-4000-8000-000000000001'
let successfulBootstraps = 0, telegramDispatches = 0, authorizedDelivery = 0, rejectedDelivery = 0

await runSchemathesis(async (origin: string) => {
  const { db, dispose } = await freshD1()
  await db.prepare('INSERT INTO profiles (id, email) VALUES (?, ?)').bind(ownerId, 'owner@example.test').run()
  let writes = 0
  const bootstrappedTurns = new Map<string, string>()
  useD1Binding({ DB: { prepare: db.prepare.bind(db), batch: (...args: Parameters<typeof db.batch>) => {
    writes++
    return db.batch(...args)
  } } })
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
        const before = writes
        const input = await request.clone().json().catch(() => null) as ChatTurnBootstrapInput | null
        const response = await bootstrap.POST(event)
        if (response.status === 200) {
          assert.ok(user && input)
          const { turn } = await response.clone().json() as { turn: { content: string; id: string } }
          // A replay of the same submission returns its original durable turn ID.
          const submission = JSON.stringify([user.id, input.conversationId, input.userClientMessageId])
          assert.equal(turn.id, bootstrappedTurns.get(submission) ?? input.turnId)
          assert.ok(turn.content.trim())
          assert.deepEqual(await db.prepare(`SELECT c.user_id, m.content, t.conversation_id, t.user_client_message_id, t.assistant_client_message_id
            FROM chat_turns t JOIN conversations c ON c.id = t.conversation_id JOIN messages m ON m.id = t.user_message_id
            WHERE t.id = ?`).bind(turn.id).first(), {
            user_id: ownerId, content: turn.content, conversation_id: input.conversationId,
            user_client_message_id: input.userClientMessageId, assistant_client_message_id: input.assistantClientMessageId,
          })
          bootstrappedTurns.set(submission, turn.id)
          successfulBootstraps++
        } else if (response.status === 400 || response.status === 401) assert.equal(writes, before, 'Invalid bootstrap must not write to D1')
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
    async close() {
      await dispose()
      assert.ok(successfulBootstraps > 0, 'Must exercise successful authenticated chat bootstrap')
      assert.ok(telegramDispatches > 0, 'Must exercise successful Telegram dispatch')
      assert.ok(authorizedDelivery > 0 && rejectedDelivery > 0, 'Must exercise delivery ownership acceptance and rejection')
      console.log(JSON.stringify({ successfulBootstraps, telegramDispatches, authorizedDelivery, rejectedDelivery }))
    },
  }
  // Fixed probes ensure exact-payload replay and each rejection oracle run even
  // when generated JSON uses a different whitespace representation.
  try {
    const submission = {
      conversationId: 'f0000000-0000-4000-8000-000000000001',
      turnId: 'f0000000-0000-4000-8000-000000000002',
      userClientMessageId: 'f0000000-0000-4000-8000-000000000003',
      assistantClientMessageId: 'f0000000-0000-4000-8000-000000000004',
      content: 'Synthetic tango tonight', locale: 'es',
    }
    for (const { body, status } of [
      { body: { locale: submission.locale, assistantClientMessageId: submission.assistantClientMessageId, extra: true }, status: 400 },
      { body: submission, status: 200 },
      { body: { ...submission, turnId: 'f0000000-0000-4000-8000-000000000005', extra: true }, status: 200 },
    ]) {
      const response = await application.handle(new Request(`${origin}/api/chat/bootstrap`, {
        method: 'POST', body: JSON.stringify(body), headers: { 'x-test-session': 'owner', 'content-type': 'application/json' },
      }))
      assert.equal(response.status, status)
      if (status === 200) assert.equal((await response.json()).turn.id, submission.turnId)
      else await response.body?.cancel()
    }
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
    await dispose()
    throw error
  }
  return application
}, 'tests/fuzz/openapi.json')
