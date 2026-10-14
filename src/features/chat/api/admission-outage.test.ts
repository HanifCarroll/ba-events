import { describe, expect, it } from 'vitest'
import type { RequestEvent } from '@sveltejs/kit'
import { POST } from './execute.server.ts'
import english from '../../../../messages/en.json'
import spanish from '../../../../messages/es.json'
import { RateLimitUnavailableError } from '../../auth/api/rate-limit.server.ts'

describe('web chat admission outage', () => {
  for (const locale of ['en', 'es']) {
    it(`returns a retryable ${locale} error before identity, persistence or model work`, async () => {
      let downstream = 0
      const event = {
        request: new Request('https://baeventos.com/api/chat/execute', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ messages: [{ id: 'user', role: 'user', parts: [{ type: 'text', text: 'Find events' }] }], locale }),
        }),
        getClientAddress: () => '203.0.113.1',
        get locals() { downstream++; throw new Error('Downstream work must not start') },
      } as unknown as RequestEvent
      const result = await POST(event, { rateLimit: async () => { throw new RateLimitUnavailableError() } })
      const body = await result.text()
      expect(result.headers.get('Retry-After')).toBe('30')
      expect(body).toContain('"type":"error"')
      expect(body).toContain(locale === 'en' ? english.chat_error_generic : spanish.chat_error_generic)
      expect(body).not.toContain('Rate limit service')
      expect(downstream).toBe(0)
    })
  }
})
