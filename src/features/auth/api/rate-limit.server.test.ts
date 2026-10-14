import { describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { checkRateLimit, checkApiRateLimit, RateLimitUnavailableError } from './rate-limit.server.ts'

for (const [scope, check, maximum] of [['chat', checkRateLimit, 50], ['public_api', checkApiRateLimit, 10]] as const) {
  describe(`${scope} rate limit through actual PostgREST transport`, () => {
    for (const success of [true, false]) {
      it(`preserves a genuine ${success ? 'allowed' : 'exhausted'} quota and hashes the identifier`, async () => {
        let sent: Record<string, unknown> = {}
        const result = { success, remaining: success ? 1 : 0, reset: Date.now() + 60_000, request_count: success ? maximum - 1 : maximum + 1 }
        const client = createClient('https://database.example.test', 'test-only-key', {
          auth: { persistSession: false, autoRefreshToken: false },
          global: { fetch: async (_input, init) => {
            sent = JSON.parse(String(init?.body))
            return Response.json(result)
          } },
        })
        expect(await check('203.0.113.1', client)).toEqual({ success, remaining: result.remaining, reset: result.reset })
        expect(sent.p_scope).toBe(scope)
        expect(sent.p_max_requests).toBe(maximum)
        expect(String(sent.p_identifier_hash)).toHaveLength(64)
        expect(JSON.stringify(sent)).not.toContain('203.0.113.1')
      })
    }

    it('aborts a stalled admission request at its deadline', async () => {
      let signal: AbortSignal | undefined
      const client = createClient('https://database.example.test', 'test-only-key', {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: async (_input, init) => {
          signal = init?.signal ?? undefined
          return new Promise<Response>((_resolve, reject) => signal!.addEventListener('abort', () => reject(signal!.reason), { once: true }))
        } },
      })
      const error = await check('203.0.113.1', client).catch(error => error)
      expect(error).toBeInstanceOf(RateLimitUnavailableError)
      expect(signal?.aborted).toBe(true)
    })

    for (const mode of ['backend', 'transport', 'empty', 'malformed'] as const) {
      it(`fails closed on ${mode} failure instead of allowing paid work`, async () => {
        const client = createClient('https://database.example.test', 'test-only-key', {
          auth: { persistSession: false, autoRefreshToken: false },
          global: { fetch: async () => {
            if (mode === 'transport') throw new Error('private backend detail')
            if (mode === 'backend') return Response.json({ message: 'private backend detail' }, { status: 503 })
            return Response.json(mode === 'empty' ? null : { success: 'true', remaining: 50, reset: -1 })
          } },
        })
        const error = await check('203.0.113.1', client).catch(error => error)
        expect(error).toBeInstanceOf(RateLimitUnavailableError)
        expect(error.message).not.toContain('private backend detail')
      })
    }
  })
}
