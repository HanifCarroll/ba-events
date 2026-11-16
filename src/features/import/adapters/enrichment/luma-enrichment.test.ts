import { describe, expect, it, vi } from 'vitest'
import { lumaEnrichmentAdapter } from './luma-enrichment.ts'

const detail = { api_id: 'evt-synthetic', ...{
  event: { geo_address_info: { address: 'Synthetic Venue', full_address: 'Synthetic Venue, Calle 1' }, coordinate: { latitude: -34.6, longitude: -58.4 } },
  description_mirror: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Synthetic live jazz.' }] }] },
} }

describe('Luma enrichment through the JSON API', () => {
  it('reads description and venue from one API call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(detail)))
    try {
      expect(await lumaEnrichmentAdapter.serverEnrich!('https://luma.com/synthetic', { extractVenue: true }))
        .toMatchObject({ description_en: 'Synthetic live jazz.', description_es: null, venue_name: 'Synthetic Venue', sourceObservedAt: expect.any(String) })
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      expect(String(fetchSpy.mock.calls[0]![0])).toBe('https://api2.luma.com/event/get?event_api_id=synthetic')
    } finally { fetchSpy.mockRestore() }
  })

  it('does not return a venue when it is not requested', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(detail)))
    try {
      expect(await lumaEnrichmentAdapter.serverEnrich!('https://luma.com/synthetic')).toMatchObject({ description_en: 'Synthetic live jazz.', venue_name: null })
    } finally { fetchSpy.mockRestore() }
  })
})
