import { describe, expect, it, vi } from 'vitest'
import { lumaEnrichmentAdapter } from './luma-enrichment.ts'

const html = `<script type="application/ld+json">${JSON.stringify({
  '@type': 'Event', description: 'Synthetic live jazz.', location: { '@type': 'Place', name: 'Synthetic Venue' },
})}</script>`

describe('Luma independent description and venue reads', () => {
  it('starts both reads before either finishes', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { await gate; return new Response(html) })
    const running = lumaEnrichmentAdapter.serverEnrich!('https://lu.ma/synthetic', { extractVenue: true })
    try {
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(fetchSpy).toHaveBeenCalledTimes(2)
      release()
      expect(await running).toMatchObject({ description_en: 'Synthetic live jazz.', description_es: null, venue_name: 'Synthetic Venue', sourceObservedAt: expect.any(String) })
    } finally {
      release(); await running
      fetchSpy.mockRestore()
    }
  })

  it('does not fetch a venue when it is not requested', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(html))
    try {
      expect(await lumaEnrichmentAdapter.serverEnrich!('https://lu.ma/synthetic')).toMatchObject({ description_en: 'Synthetic live jazz.', venue_name: null })
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    } finally { fetchSpy.mockRestore() }
  })
})
