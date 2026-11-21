import type { RequestEvent } from '@sveltejs/kit'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('#features/auth/api/rate-limit.server.ts', () => ({
  checkApiRateLimit: async () => ({ success: true, reset: 0 }),
  RATE_LIMIT_RETRY_SECONDS: 3,
}))
vi.mock('#shared/lib/db/client.server.ts', () => ({ getEventsWithVenues: vi.fn() }))

const apiKey = 'synthetic-admin-key'
let POST: typeof import('./+server.ts').POST
beforeAll(async () => {
  vi.stubEnv('ADMIN_API_KEY', apiKey)
  const route = await import('./+server.ts')
  POST = route.POST
})
afterAll(() => vi.unstubAllEnvs())

function submit(price: string) {
  const request = new Request('https://example.com/api/events', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: `{"name":"Synthetic event","starts_at":"2026-12-01T21:00:00Z","price":${price}}`,
  })
  return POST({ request, getClientAddress: () => '192.0.2.1' } as RequestEvent)
}

describe('legacy event submission price validation', () => {
  it.each([
    ['-1', 'price must be a positive number'],
    ['-1e309', 'price must be a positive number'],
    ['1e309', 'price must be a positive number'],
    ['"invalid"', 'Expected number | null | undefined'],
  ])('rejects %s with field-specific validation text', async (price, message) => {
    const response = await submit(price)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      success: false,
      error: { message: `price: ${message}`, code: 'VALIDATION_ERROR' },
    })
  })

  it('accepts finite decimal prices at validation without enabling event creation', async () => {
    const response = await submit('1500.5')
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ error: { code: 'CREATE_ERROR' } })
  })
})
