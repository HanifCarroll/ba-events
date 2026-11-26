import { describe, expect, it, vi } from 'vitest'
import { lumaEnrichmentAdapter } from './luma-enrichment.ts'

const detail = { api_id: 'evt-synthetic', ...{
  event: { geo_address_info: { mode: 'shown', address: 'Synthetic Venue', full_address: 'Synthetic Venue, Calle 1' }, coordinate: { latitude: -34.6, longitude: -58.4 } },
  description_mirror: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Synthetic live jazz.' }] }] },
  // Sanitized /event/get projection: top-level hosts include api_id and a nullable username.
  hosts: [{ api_id: 'usr-synthetic', name: 'Colectivo Nube', username: 'colectivo_nube', avatar_url: 'https://example.com/avatar' },
    { api_id: 'usr-synthetic2', name: 'Segundo anfitrión', username: null }],
} }

describe('Luma enrichment through the JSON API', () => {
  it('reads description, venue, and the first named organizer from one API call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(detail)))
    try {
      expect(await lumaEnrichmentAdapter.serverEnrich!('https://luma.com/synthetic', { extractVenue: true }))
        .toMatchObject({ description_en: 'Synthetic live jazz.', description_es: null, venue_name: 'Synthetic Venue', location_hidden: false, sourceObservedAt: expect.any(String),
          organizer: { name: 'Colectivo Nube', url: 'https://luma.com/user/usr-synthetic' } })
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      expect(String(fetchSpy.mock.calls[0]![0])).toBe('https://api2.luma.com/event/get?event_api_id=synthetic')
    } finally { fetchSpy.mockRestore() }
  })

  it('returns the public host link even when the named host has no username', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      ...detail, hosts: [detail.hosts[1]],
    })))
    try {
      expect(await lumaEnrichmentAdapter.serverEnrich!('https://luma.com/synthetic')).toMatchObject({
        organizer: { name: 'Segundo anfitrión', url: 'https://luma.com/user/usr-synthetic2' },
      })
    } finally { fetchSpy.mockRestore() }
  })

  it('does not return a venue when it is not requested', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(detail)))
    try {
      expect(await lumaEnrichmentAdapter.serverEnrich!('https://luma.com/synthetic')).toMatchObject({ description_en: 'Synthetic live jazz.', venue_name: null })
    } finally { fetchSpy.mockRestore() }
  })

  it('reports a guests-only event as hidden and returns no venue', async () => {
    const hidden = { ...detail, event: { geo_address_info: { mode: 'obfuscated', city: 'Buenos Aires', address: 'Synthetic Venue' }, coordinate: { latitude: -34.6, longitude: -58.4 } } }
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(hidden)))
    try {
      expect(await lumaEnrichmentAdapter.serverEnrich!('https://luma.com/synthetic', { extractVenue: true }))
        .toMatchObject({ venue_name: null, location_hidden: true })
    } finally { fetchSpy.mockRestore() }
  })

  it('keeps the hidden reading when the description is empty, and reports nothing it cannot tell', async () => {
    const respond = (event: unknown) => vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ event })))
    let fetchSpy = respond({ geo_address_info: { mode: 'obfuscated', city: 'Buenos Aires' } })
    try {
      expect(await lumaEnrichmentAdapter.serverEnrich!('https://luma.com/synthetic', { extractVenue: true }))
        .toMatchObject({ description_es: null, description_en: null, venue_name: null, location_hidden: true })
    } finally { fetchSpy.mockRestore() }
    fetchSpy = respond({ geo_address_info: { city: 'Buenos Aires' } })
    try {
      expect(await lumaEnrichmentAdapter.serverEnrich!('https://luma.com/synthetic', { extractVenue: true })).toBeNull()
    } finally { fetchSpy.mockRestore() }
  })
})
