import { describe, expect, it } from 'vitest'
import { addDays } from 'date-fns'
import { agendaEvent } from '../../tests/support/home-agenda.ts'
import { HOME_FEED_HEADERS, homeWindow } from '#features/events/lib/home-feed.ts'

const events = [agendaEvent('event-1', addDays(new Date(), 2).toISOString(), { music: true, payWhatYouCan: true })]
const event = (cached = events) => ({ platform: { caches: { default: {
  match: async () => Response.json({ events: cached, storedAt: Date.now() }),
  put: async () => {},
} } } })

describe('homepage event discovery', () => {
  it('returns only the requested cards plus the unchanged collage, and keeps each filter independent', async () => {
    const { load } = await import('./(chat)/+page.server.ts')
    const { tomorrow } = homeWindow(new Date())
    const cached = Array.from({ length: 53 }, (_, index) => agendaEvent(`card-${index}`,
      new Date(Date.parse(tomorrow) + (index + 12) * 3600_000).toISOString(), { is_free: index < 31 }))
    const loadView = async (path: string) => (await load({
      ...event(cached), url: new URL(path, 'https://example.test'), depends() {},
    } as unknown as Parameters<typeof load>[0])).homeAgenda!

    const first = await loadView('/')
    expect(first.view).toMatchObject({ events: cached.slice(0, 24), total: 53, empty: null })
    expect(first.flyers).toHaveLength(4)
    expect(first.refreshInMs).toBeGreaterThan(0)
    expect(Object.keys(first).sort()).toEqual(['flyers', 'refreshInMs', 'view'])
    expect((await loadView('/?n=48')).view).toMatchObject({ events: cached.slice(0, 48), total: 53 })
    const free = await loadView('/?f=gratis&n=48')
    expect(free.view).toMatchObject({ events: cached.slice(0, 31), total: 31 })
    expect(free.flyers).toEqual(first.flyers)
  })

  it('keeps the public endpoint compact, with explicit browser and CDN freshness', async () => {
    const { GET } = await import('./api/events/happening-soon/+server.ts')
    const response = await GET(event() as unknown as Parameters<typeof GET>[0])
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, data: [{
      id: 'event-1', name: 'event-1', starts_at: events[0].starts_at, time_tba: false, image_url: events[0].image_url,
      image_width: null, image_height: null, venue_name: 'Sala sintética', venue_neighborhood: 'Almagro', price: null, is_free: false,
    }], meta: { total: 1 } })
    for (const [key, value] of Object.entries(HOME_FEED_HEADERS)) expect(response.headers.get(key)).toBe(value)
  })
})
