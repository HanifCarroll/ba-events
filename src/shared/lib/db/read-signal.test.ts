import { describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { withReadSignal } from './read-signal.ts'

describe('actual PostgREST read cancellation', () => {
  for (const kind of ['detail', 'rpc'] as const) {
    it(`aborts a pending ${kind} HTTP request without retrying it`, async () => {
      const controller = new AbortController()
      let calls = 0
      let requestSignal: AbortSignal | undefined
      let started: () => void = () => {}
      const ready = new Promise<void>((resolve) => { started = resolve })
      const client = createClient('https://database.example.test', 'test-only-key', {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: async (_input, init) => {
          calls++
          requestSignal = init?.signal ?? undefined
          started()
          return new Promise<Response>((_resolve, reject) => {
            requestSignal!.addEventListener('abort', () => reject(requestSignal!.reason), { once: true })
          })
        } },
      })
      const query = kind === 'detail'
        ? withReadSignal(client.from('events').select('id').eq('id', 'event'), controller.signal).single()
        : withReadSignal(client.rpc('test_search', { query: 'event' }), controller.signal)
      const result = Promise.resolve(query)
      await ready
      controller.abort()
      expect((await result).error).not.toBeNull()
      expect(requestSignal?.aborted).toBe(true)
      expect(calls).toBe(1)
    })
  }

  it('rejects a previously aborted query before any HTTP request', () => {
    const controller = new AbortController()
    controller.abort()
    let calls = 0
    const client = createClient('https://database.example.test', 'test-only-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: async () => { calls++; throw new Error('Unexpected HTTP request') } },
    })
    expect(() => withReadSignal(client.from('events').select('id'), controller.signal)).toThrow()
    expect(calls).toBe(0)
  })
})
