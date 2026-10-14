import { beforeAll, afterAll, describe, it, expect } from 'vitest'
import { fetchRevalidatedHtml, fetchRevalidatedHtmlObservation } from './http.ts'
import { withAcquisitionRun } from './run.ts'

const previousMode = process.env.NODE_ENV
beforeAll(() => { process.env.NODE_ENV = 'test' })
afterAll(() => {
  if (previousMode === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = previousMode
})

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

  it('preserves body observation time on 304 and both times across run retries', async () => {
    const sourceObservedAt = '2026-10-01T10:00:00.000Z'
    const id = crypto.randomUUID()
    let reads = 0
    const dependencies = {
      read: async () => ({ html: 'Retained source', etag: 'v1', modified: null, sourceObservedAt }),
      write: async () => {},
      fetch: (async () => { reads++; return new Response(null, { status: 304 }) }) as typeof fetch,
    }
    const acquire = () => fetchRevalidatedHtmlObservation(`https://example.com/${id}`, dependencies)
    const first = await withAcquisitionRun(id, acquire)
    const retried = await withAcquisitionRun(id, acquire)
    expect(first.sourceObservedAt).toBe(sourceObservedAt)
    expect(Date.parse(first.sourceValidatedAt)).toBeGreaterThan(Date.parse(sourceObservedAt))
    expect(retried).toEqual(first)
    expect(reads).toBe(1)
    const refreshed = await withAcquisitionRun(crypto.randomUUID(), acquire)
    expect(refreshed.sourceObservedAt).toBe(sourceObservedAt)
    expect(reads).toBe(2)
  })

  it('leaves legacy body age unknown and records a new 200 observation', async () => {
    let stored: unknown = { html: 'Legacy source', etag: 'v1', modified: null }
    let status = 304
    const dependencies = {
      read: async () => stored,
      write: async (_key: string, value: unknown) => { stored = value },
      fetch: (async () => new Response(status === 304 ? null : 'New source', { status })) as typeof fetch,
    }
    expect((await fetchRevalidatedHtmlObservation('https://example.com/legacy', dependencies)).sourceObservedAt).toBeNull()
    status = 200
    const fresh = await fetchRevalidatedHtmlObservation('https://example.com/legacy', dependencies)
    expect(fresh.sourceObservedAt).toBe(fresh.sourceValidatedAt)
    expect(Number.isFinite(Date.parse(fresh.sourceObservedAt!))).toBe(true)
    expect(stored).toMatchObject({ html: 'New source', sourceObservedAt: fresh.sourceObservedAt })
  })
})
