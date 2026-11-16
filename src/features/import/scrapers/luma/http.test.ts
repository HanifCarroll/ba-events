import { describe, expect, it } from 'vitest'
import { fetchLumaJson, LumaRateLimitError, parseRetryAfter } from './http.ts'
import { fetchLumaEvents } from './api.ts'
import { fetchLumaEventDetail, prosemirrorText } from './detail.ts'
import { getAllVenueInfo, transformLumaEvent } from './transformer.ts'

const respond = (status: number, body: unknown = {}, headers: Record<string, string> = {}) =>
  (async () => new Response(JSON.stringify(body), { status, headers })) as unknown as typeof fetch

describe('Luma API rate limits', () => {
  it('parses Retry-After as seconds or an HTTP date, and ignores junk', () => {
    const now = Date.parse('2026-11-16T09:00:00Z')
    expect(parseRetryAfter('120', now)).toBe(120)
    expect(parseRetryAfter('Mon, 16 Nov 2026 09:02:30 GMT', now)).toBe(150)
    expect(parseRetryAfter('Mon, 16 Nov 2026 08:00:00 GMT', now)).toBe(0)
    expect(parseRetryAfter('soon', now)).toBeNull()
    expect(parseRetryAfter(null, now)).toBeNull()
  })

  it('turns a 429 into a LumaRateLimitError that carries the wait in its message', async () => {
    const limited = fetchLumaJson('/discover/x', respond(429, { code: 'api/rate-limit' }, { 'retry-after': '90' }))
    await expect(limited).rejects.toBeInstanceOf(LumaRateLimitError)
    await expect(limited).rejects.toThrow('Luma rate limited (429); retry after 90s')
    await expect(fetchLumaJson('/discover/x', respond(429))).rejects.toThrow(/^Luma rate limited \(429\)$/)
    await expect(fetchLumaJson('/discover/x', respond(500))).rejects.toThrow('Luma API /discover/x failed: 500')
  })

  it('lets a rate-limited listing fail the import instead of returning an empty catalog', async () => {
    await expect(fetchLumaEvents(respond(429, {}, { 'retry-after': '60' }))).rejects.toThrow('retry after 60s')
  })
})

describe('Luma discover API', () => {
  it('follows the cursor and parses entries like the page data', async () => {
    const entry = (id: string) => ({ api_id: id, event: { api_id: id, name: `Evento ${id}`, url: id, start_at: '2026-12-01T22:00:00.000Z', timezone: 'America/Argentina/Buenos_Aires' } })
    const urls: string[] = []
    const fetchImpl = (async (url: string) => {
      urls.push(url)
      const second = url.includes('pagination_cursor=c1')
      return new Response(JSON.stringify(second ? { entries: [entry('evt-b')], has_more: false } : { entries: [entry('evt-a')], has_more: true, next_cursor: 'c1' }))
    }) as unknown as typeof fetch
    const events = await fetchLumaEvents(fetchImpl)
    expect(events.map(event => [event.api_id, event.url])).toEqual([['evt-a', 'https://luma.com/evt-a'], ['evt-b', 'https://luma.com/evt-b']])
    expect(urls).toHaveLength(2)
    expect(urls[0]).toMatch(/^https:\/\/api2\.luma\.com\/discover\/get-paginated-events\?discover_place_api_id=discplace-wX2J5xGwAJpznew/)
  })
})

describe('Luma guests-only events in the listing', () => {
  // Shapes from the live discover API (2026-11-16), with synthetic names and places.
  const listing = (geo: unknown) => (async () => new Response(JSON.stringify({ entries: [{ api_id: 'evt-h', event: {
    api_id: 'evt-h', name: 'Encuentro sintético', url: 'sintetico', start_at: '2026-12-01T22:00:00.000Z', timezone: 'America/Argentina/Buenos_Aires',
    geo_address_info: geo, coordinate: { latitude: -34.55, longitude: -58.45 },
  } }], has_more: false }))) as unknown as typeof fetch

  it('marks an obfuscated event hidden with no venue, and the transform keeps it that way', async () => {
    const [event] = await fetchLumaEvents(listing({ mode: 'obfuscated', city: 'Buenos Aires', city_state: 'Buenos Aires, Argentina', sublocality: 'Belgrano', country: 'Argentina' }))
    expect(event).toMatchObject({ location_hidden: true, venue: null })
    expect(getAllVenueInfo([event!]).size).toBe(0)
    // Even a venue id from elsewhere never reaches the row.
    expect(transformLumaEvent(event!, 'venue-synthetic')).toMatchObject({ location_hidden: true, venue_id: null })
  })

  it('reads a public event venue from geo_address_info and unhides it explicitly', async () => {
    const [event] = await fetchLumaEvents(listing({ mode: 'shown', address: 'Sala Sintética', full_address: 'Sala Sintética, Av. Ficticia 1234, CABA', sublocality: 'Retiro', city: 'ACY' }))
    expect(event).toMatchObject({ location_hidden: false, venue: { name: 'Sala Sintética', full_address: 'Sala Sintética, Av. Ficticia 1234, CABA', city: 'Retiro', latitude: -34.55, longitude: -58.45 } })
    expect(transformLumaEvent(event!, 'venue-synthetic')).toMatchObject({ location_hidden: false, venue_id: 'venue-synthetic' })
  })
})

describe('Luma event detail API', () => {
  it('reads the description and public venue, and omits obfuscated venues', async () => {
    const detail = (geo: unknown) => respond(200, {
      api_id: 'evt-abc',
      ...{
        event: { geo_address_info: geo, coordinate: { latitude: -34.6, longitude: -58.4 } },
        description_mirror: { type: 'doc', content: [
          { type: 'heading', content: [{ type: 'text', text: 'Título' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Uno' }, { type: 'hard_break' }, { type: 'text', text: 'dos' }] },
          { type: 'bullet_list', content: [{ type: 'list_item', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ítem' }] }] }] },
        ] },
      },
    })
    const open = await fetchLumaEventDetail('https://luma.com/abc123', detail({ address: 'Paseo La Plaza', full_address: 'Paseo La Plaza, Av. Corrientes 1660' }))
    expect(open).toEqual({
      description: 'Título\n\nUno\ndos\n\nÍtem',
      venue: { name: 'Paseo La Plaza', address: 'Paseo La Plaza, Av. Corrientes 1660', latitude: -34.6, longitude: -58.4 },
      location_hidden: false,
    })
    expect(await fetchLumaEventDetail('https://luma.com/abc123', detail({ mode: 'obfuscated', city: 'Buenos Aires', city_state: 'Buenos Aires, Argentina', address: 'Paseo La Plaza' })))
      .toMatchObject({ venue: null, location_hidden: true })
    expect(prosemirrorText([])).toBe('')
  })

  it('propagates a 429 from the detail read', async () => {
    await expect(fetchLumaEventDetail('https://luma.com/abc123', respond(429))).rejects.toBeInstanceOf(LumaRateLimitError)
  })
})
