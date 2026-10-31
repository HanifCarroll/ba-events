import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { canonicalizeSearchIntent, applyPreferAvoid } from '../../features/chat/api/tools/search-intent.ts'
import { searchRetryBoundary, widenedSearchConstraints } from '../../features/chat/api/tools/search-retry.ts'
import { bootstrapGuestTurn, claimGuestTurn, completeGuestTurn, failGuestTurn, getGuestConversationWithMessages, deleteGuestConversation } from './db/guest-conversations.ts'
import { adaptStoredMessageToCanonical } from '../../features/chat/lib/canonical.ts'
import { candidateStart, canonicalTicket, decideMatch, type CatalogMatch } from '../../features/import/intake/planning.ts'
import { decodeCandidate } from '../../features/import/intake/schema.ts'
import { handleTelegramWebhook, type TelegramWebhookDependencies } from '../../features/telegram/webhook.server.ts'
import { openTelegramEnvelope } from '../../features/telegram/envelope.server.ts'
import { parseTelegramPlaintextPayload, type TelegramTaskPayload } from '../../features/telegram/task-payload.ts'

const options = { numRuns: 120, seed: Number(process.env.FC_SEED ?? 20261031) }
const id = '10000000-0000-4000-8000-000000000001'
const key = Buffer.alloc(32, 7).toString('base64')

// Generated histories exercise the actual IndexedDB transactions, including
// rejected stale writers, rather than a replacement in-memory implementation.
describe('critical workflow properties', () => {
  it('preserves the user message and one canonical reply through claim, stop, retry and replay histories', async () => {
    await fc.assert(fc.asyncProperty(
      fc.string({ minLength: 1, maxLength: 80 }),
      fc.array(fc.record({ action: fc.constantFrom('claim', 'retry', 'fail', 'complete', 'replay', 'conflict'), claim: fc.integer({ min: 0, max: 3 }) }), { minLength: 1, maxLength: 30 }),
      async (content, history) => {
        const conversationId = crypto.randomUUID()
        const input = { conversationId, turnId: crypto.randomUUID(), userClientMessageId: crypto.randomUUID(), assistantClientMessageId: crypto.randomUUID(), content }
        let status = 'pending', owner: string | null = null, saved: string | null = null
        await bootstrapGuestTurn(input)
        try {
          for (const { action, claim } of history) {
            const claimId = `claim-${claim}`
            if (action === 'claim' || action === 'retry') {
              await claimGuestTurn(input.turnId, claimId, action === 'retry')
              if (status === 'pending' || status === 'failed' && action === 'retry') { status = 'running'; owner = claimId }
            } else if (action === 'fail') {
              await failGuestTurn(input.turnId, claimId)
              if (status === 'running' && owner === claimId) status = 'failed'
            } else if (action === 'complete') {
              const text = `Reply from ${claimId}`
              const response = { canonical: adaptStoredMessageToCanonical({ id: input.assistantClientMessageId, content: text }), executionTrace: [] }
              if (owner === claimId && (status === 'running' || status === 'completed')) {
                await completeGuestTurn(input.turnId, claimId, response)
                if (status !== 'completed') saved = text
                status = 'completed'
              } else await assert.rejects(completeGuestTurn(input.turnId, claimId, response), /Turn claim lost/)
            } else if (action === 'conflict') {
              await assert.rejects(bootstrapGuestTurn({ ...input, content: `${content}!` }), /Turn conflict/)
              await assert.rejects(bootstrapGuestTurn({ ...input, conversationId: 'another-conversation' }), /Turn conflict/)
            } else await bootstrapGuestTurn(input)
            const stored = await getGuestConversationWithMessages(conversationId)
            expect(stored?.turns?.[0].status).toBe(status)
            assert.equal(stored?.turns?.[0].claim_id, owner)
            assert.equal(stored?.messages.filter(message => message.role === 'user').length, 1)
            assert.equal(stored?.messages.find(message => message.role === 'user')?.content, content)
            const replies = stored?.messages.filter(message => message.role === 'assistant') ?? []
            assert.equal(replies.length, saved === null ? 0 : 1)
            if (saved !== null) { assert.equal(replies[0].content, saved); assert.equal(replies[0].id, input.assistantClientMessageId) }
          }
        } finally { await deleteGuestConversation(conversationId) }
      }), { ...options, numRuns: 60 })
  }, 30_000)

  it('keeps paid/free, price, age, neighborhoods, categories and exclusions in retrieval and retries', async () => {
    await fc.assert(fc.asyncProperty(fc.record({
      query: fc.constantFrom('not free', 'conciertos que no sean gratis', 'free jazz'),
      isFree: fc.boolean(), maxPrice: fc.integer({ min: 0, max: 100000 }), minAge: fc.integer({ min: 0, max: 99 }),
      neighborhood: fc.constantFrom('Palermo', 'San Telmo', 'Recoleta'),
      categories: fc.subarray(['music', 'art', 'food'], { minLength: 1 }),
      avoid: fc.subarray(['techno', 'house', 'electronic'], { minLength: 1 }), limit: fc.integer({ min: -20, max: 20 }),
    }), async (input) => {
      const intent = await canonicalizeSearchIntent({ ...input, neighborhoods: [input.neighborhood], objective: 'search' }, new Date(2026, 9, 31, 12))
      const filters = applyPreferAvoid(intent)
      expect(filters.isFree).toBe(input.isFree)
      assert.equal(filters.maxPrice, input.maxPrice)
      assert.equal(filters.minAge, input.minAge)
      assert.deepEqual(filters.neighborhoods, [input.neighborhood])
      assert.deepEqual(filters.categories, input.categories)
      assert.deepEqual(filters.avoidGenres, input.avoid)
      assert.ok(intent.displayLimit >= 1 && intent.displayLimit <= 5)
      assert.equal(intent.candidateLimit, 50)
      const boundary = searchRetryBoundary(intent, {})
      assert.deepEqual(widenedSearchConstraints(boundary, structuredClone(boundary)), [])
      for (const constraint of ['isFree', 'maxPrice', 'attendeeAge', 'neighborhoodIds', 'categories'] as const) {
        const retry = structuredClone(boundary)
        delete retry.must[constraint]
        assert.ok(widenedSearchConstraints(boundary, retry).includes(constraint), `${constraint} must survive retries`)
      }
      const narrower = structuredClone(boundary)
      narrower.must.maxPrice = Math.floor(input.maxPrice / 2)
      narrower.must.attendeeAge = Math.floor(input.minAge / 2)
      assert.deepEqual(widenedSearchConstraints(boundary, narrower), [])
    }), options)
  })

  it('links repeat promotions, holds ambiguous duplicates, and preserves distinct showtimes and ticket identities', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 28 }), fc.integer({ min: 0, max: 22 }), fc.string({ minLength: 1, maxLength: 40 }), (day, hour, tracking) => {
      const date = `2026-11-${String(day).padStart(2, '0')}`
      const candidate = decodeCandidate({ id, expected_revision: 0, intent: 'create', target_event_id: null,
        name: 'Synthetic Jazz', date, time: `${String(hour).padStart(2, '0')}:00`, venue_name: 'Synthetic Venue', venue_id: id,
        description_es: null, description_en: null, categories: ['music'], status: 'scheduled', price_kind: 'unknown', price_ars: null,
        price_note: null, ticket_url: `https://tickets.example/show?session=main&utm_source=${encodeURIComponent(tracking)}`,
        artwork_media_id: null, issues: [], notes: '', evidence: [{ observation_id: id, fields: ['name', 'date', 'time', 'venue'], excerpt: 'Synthetic fixture', media_id: null }],
      })
      const original: CatalogMatch = { id: crypto.randomUUID(), name: candidate.name, starts_at: candidateStart(candidate), venue_id: id,
        ticket_url: 'https://tickets.example/show?session=main', link: null, updated_at: '2026-10-31T00:00:00Z', status: 'scheduled' }
      assert.equal(canonicalTicket(candidate.ticket_url), original.ticket_url)
      assert.equal(decideMatch(candidate, [original], [], []).target?.id, original.id)
      expect(decideMatch(candidate, [original], [], []).action).toBe('link')
      assert.equal(decideMatch(candidate, [original, { ...original, id: crypto.randomUUID() }], [], []).action, 'held')
      assert.equal(decideMatch(candidate, [original], [], ['Missing evidence']).action, 'held')
      const next = { ...candidate, time: `${String(hour + 1).padStart(2, '0')}:00`, distinct_occurrence: true, notes: 'Two separate performances are explicitly evidenced.' }
      assert.equal(decideMatch(next, [original], [], []).action, 'create')
      assert.equal(decideMatch({ ...next, distinct_occurrence: false }, [original], [], []).action, 'held')
      assert.equal(decideMatch({ ...next, intent: 'update', target_event_id: original.id }, [original], [original.id], []).action, 'update')
    }), options)
  })

  it('authenticates Telegram before dispatch and keeps duplicate/failed deliveries idempotent and encrypted', async () => {
    await fc.assert(fc.asyncProperty(fc.string({ minLength: 1, maxLength: 300 }).filter(text => text.trim().length > 0 && !text.trim().startsWith('/')),
      fc.array(fc.constantFrom('valid', 'wrong-secret', 'complete', 'dispatch-fails'), { minLength: 1, maxLength: 20 }), async (text, history) => {
        let completed = false, quotaCharged = false, triggerCount = 0, quotaCount = 0, shouldFail = false
        const dispatched: TelegramTaskPayload[] = []
        const dependencies: TelegramWebhookDependencies = {
          webhookSecret: 'synthetic-secret', identitySecret: 'i'.repeat(32),
          claim: async () => completed ? { completed: true } : { completed: false, envelopeKey: key, checkRateLimit: !quotaCharged },
          getOrCreateConversation: async () => ({ id, channel: 'telegram', title: 'Synthetic conversation', metadata: {}, created_at: '2026-10-31T00:00:00Z', updated_at: '2026-10-31T00:00:00Z' }),
          attachConversation: async () => undefined, markFailed: async () => undefined,
          rateLimit: async () => { quotaCount++; quotaCharged = true; return { success: true, remaining: 1, reset: 0 } },
          trigger: async (payload, triggerOptions) => {
            triggerCount++
            assert.equal(triggerOptions.idempotencyKey, 'telegram-update:42')
            assert.equal(triggerOptions.concurrencyKey, id)
            dispatched.push(payload)
            if (shouldFail) throw new Error('Synthetic dispatch outage')
          },
        }
        for (const action of history) {
          if (action === 'complete') { completed = true; continue }
          shouldFail = action === 'dispatch-fails'
          const before = triggerCount
          const response = await handleTelegramWebhook(new Request('https://baeventos.test/api/telegram', {
            method: 'POST', headers: { 'x-telegram-bot-api-secret-token': action === 'wrong-secret' ? 'wrong' : 'synthetic-secret' },
            body: JSON.stringify({ update_id: 42, message: { message_id: 1, from: { id: 123, is_bot: false }, chat: { id: 123, type: 'private' }, date: 1, text } }),
          }), dependencies)
          expect(response.status).toBe(action === 'wrong-secret' ? 401 : !completed && shouldFail ? 503 : 200)
          assert.equal(triggerCount, before + (action !== 'wrong-secret' && !completed ? 1 : 0))
          assert.ok(quotaCount <= 1)
        }
        expect(quotaCount).toBeLessThanOrEqual(1)
        for (const payload of dispatched) {
          assert.deepEqual(Object.keys(payload).sort(), ['queueKey', 'sealedEnvelope', 'updateId'])
          const plain = parseTelegramPlaintextPayload(openTelegramEnvelope(payload.sealedEnvelope, key, payload.updateId, payload.queueKey))
          assert.equal(plain?.text, text)
          assert.throws(() => openTelegramEnvelope(payload.sealedEnvelope, key, '43', payload.queueKey))
        }
      }), { ...options, numRuns: 60 })
  })
})
