import { describe, expect, it } from 'vitest'
import { Effect } from 'effect'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  getExternalConversationEffect,
  loadExternalConversationMessagesEffect,
  insertExternalConversationMessageEffect,
  updateExternalConversationMetadataEffect,
  hardDeleteExternalConversationEffect,
} from '../chat/api/external-conversations.server.ts'
import { getTelegramUpdateEnvelopeKeyEffect, markTelegramUpdateCompletedEffect } from './delivery.server.ts'

const input = { channel: 'telegram' as const, conversationId: 'conversation-1' }
const cases: Array<{ name: string; request: number; run: (client: SupabaseClient) => Effect.Effect<unknown, unknown> }> = [
  { name: 'conversation lookup', request: 1, run: (client) => getExternalConversationEffect(input, client) },
  { name: 'history lookup', request: 1, run: (client) => loadExternalConversationMessagesEffect(input, client) },
  { name: 'message RPC', request: 2, run: (client) => insertExternalConversationMessageEffect({ ...input, clientMessageId: 'turn:user', role: 'user', content: 'hello' }, client) },
  { name: 'metadata write', request: 2, run: (client) => updateExternalConversationMetadataEffect({ ...input, metadataPatch: { locale: 'en' } }, client) },
  { name: 'conversation deletion', request: 1, run: (client) => hardDeleteExternalConversationEffect(input, client) },
  { name: 'envelope lookup', request: 1, run: (client) => getTelegramUpdateEnvelopeKeyEffect('42', client) },
  { name: 'completion marker', request: 1, run: (client) => markTelegramUpdateCompletedEffect('42', input.conversationId, client) },
]

describe('Telegram storage cancellation through actual PostgREST transport', () => {
  for (const scenario of cases) {
    it(`interrupts ${scenario.name} without starting another request`, async () => {
      const controller = new AbortController()
      let calls = 0
      let transportSignal: AbortSignal | undefined
      let started!: () => void
      const ready = new Promise<void>((resolve) => { started = resolve })
      const client = createClient('https://database.example.test', 'test-only-key', {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: async (_input, init) => {
          calls++
          if (calls !== scenario.request) {
            return new Response(JSON.stringify({ id: input.conversationId, metadata: {} }), {
              headers: { 'content-type': 'application/json' },
            })
          }
          transportSignal = init?.signal ?? undefined
          started()
          return new Promise<Response>((_resolve, reject) => {
            transportSignal!.addEventListener('abort', () => reject(transportSignal!.reason), { once: true })
          })
        } },
      })
      const pending = Effect.runPromise(scenario.run(client), { signal: controller.signal })
      const outcome = pending.then(() => 'success', () => 'cancelled')
      await ready
      controller.abort()
      expect(await outcome).toBe('cancelled')
      expect(transportSignal?.aborted).toBe(true)
      expect(calls).toBe(scenario.request)
    })
  }
})
