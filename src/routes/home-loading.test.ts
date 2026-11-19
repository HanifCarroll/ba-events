import { describe, expect, it } from 'vitest'
import { addDays } from 'date-fns'
import { agendaEvent } from '../../tests/support/home-agenda.ts'
import { HOME_FEED_HEADERS, homeWindow } from '#features/events/lib/home-feed.ts'

const events = [agendaEvent('event-1', addDays(new Date(), 2).toISOString(), { music: true, payWhatYouCan: true })]
const event = () => ({ platform: { caches: { default: {
  match: async () => Response.json({ events, storedAt: Date.now() }),
  put: async () => {},
} } } })

describe('homepage event discovery', () => {
  it('returns the same weekly agenda for ordinary SSR and filtered URLs', async () => {
    const { load } = await import('./(chat)/+page.server.ts')
    for (const path of ['/', '/?f=hoy']) {
      const request = { ...event(), url: new URL(path, 'https://example.test') }
      await expect(load(request as unknown as Parameters<typeof load>[0])).resolves.toEqual({ homeAgenda: { window: homeWindow(new Date()), events } })
    }
  })

  it('keeps the public endpoint compact, with explicit browser and CDN freshness', async () => {
    const { GET } = await import('./api/events/happening-soon/+server.ts')
    const response = await GET(event() as unknown as Parameters<typeof GET>[0])
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, data: [{
      id: 'event-1', name: 'event-1', starts_at: events[0].starts_at, time_tba: false, image_url: null,
      image_width: null, image_height: null, venue_name: 'Sala sintética', venue_neighborhood: 'Almagro', price: null, is_free: false,
    }], meta: { total: 1 } })
    for (const [key, value] of Object.entries(HOME_FEED_HEADERS)) expect(response.headers.get(key)).toBe(value)
  })
})
