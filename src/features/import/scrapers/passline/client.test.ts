import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchPasslineEventsClient } from './client.ts'
import fixture from './catalog-fixture.json'
afterEach(() => vi.unstubAllGlobals())

describe('admin Passline catalog completeness', () => {
  it('uses country pagination beyond the capped home billboard', async () => {
    const requests: string[] = []
    vi.stubGlobal('fetch', async (url: string, options: RequestInit) => {
      expect(url).toContain('GetBillboardByCountry')
      const limit = JSON.parse(options.body as string).limit as string
      requests.push(limit)
      return new Response(JSON.stringify(limit === '0,200' ? [fixture] : []))
    })
    const rows = await fetchPasslineEventsClient()
    expect(rows.map(row => row.id)).toEqual([fixture.id])
    expect(requests).toEqual(['0,200', '1,200'])
  })
})
