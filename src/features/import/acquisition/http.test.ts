import { describe, it, expect } from 'vitest'
import { fetchRevalidatedHtml } from './http.ts'

describe('daily HTTP conditional freshness', () => {
  it('sends observed validators, retains a 304 body, and replaces it on 200', async () => {
    let stored: unknown = { html: 'Original source', etag: '"v1"', modified: 'Wed, 01 Oct 2026 00:00:00 GMT' }
    let status = 304; let received: HeadersInit | undefined
    const dependencies = {
      read: async () => stored,
      write: async (_key: string, value: unknown) => { stored = value },
      fetch: (async (_url, options) => { received = options?.headers; return new Response(status === 304 ? null : 'Updated source', { status, headers: { etag: '"v2"' } }) }) as typeof fetch,
    }
    expect(await fetchRevalidatedHtml('https://www.meetup.com/fixture', dependencies)).toBe('Original source')
    expect(new Headers(received).get('If-None-Match')).toBe('"v1"')
    status = 200
    expect(await fetchRevalidatedHtml('https://www.meetup.com/fixture', dependencies)).toBe('Updated source')
    expect(stored).toMatchObject({ html: 'Updated source', etag: '"v2"' })
  })
  it('never stores blocked or failed responses as a successful observation', async () => {
    let writes = 0
    const dependencies = { read: async () => undefined, write: async () => { writes++ }, fetch: (async () => new Response('Blocked', { status: 403 })) as typeof fetch }
    await expect(fetchRevalidatedHtml('https://www.meetup.com/blocked', dependencies)).rejects.toThrow('403')
    expect(writes).toBe(0)
  })
})
