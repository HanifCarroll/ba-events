import { describe, expect, it } from 'vitest'
import type { HomeEventCard } from '#features/events/lib/home-feed.ts'
import { HOME_FEED_HEADERS } from '#features/events/lib/home-feed.ts'

const events = [{ id: 'event-1' }] as HomeEventCard[]
const event = () => ({ platform: { caches: { default: {
  match: async () => Response.json({ events, storedAt: Date.now() }),
  put: async () => {},
} } } })

describe('homepage event discovery', () => {
  it('returns warm cards directly for SSR', async () => {
    const { load } = await import('./(chat)/+page.server.ts')
    await expect(load(event() as unknown as Parameters<typeof load>[0])).resolves.toEqual({ happeningSoonEvents: events })
  })

  it('returns the compact public feed with explicit browser and CDN freshness', async () => {
    const { GET } = await import('./api/events/happening-soon/+server.ts')
    const response = await GET(event() as unknown as Parameters<typeof GET>[0])
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, data: events, meta: { total: 1 } })
    for (const [key, value] of Object.entries(HOME_FEED_HEADERS)) expect(response.headers.get(key)).toBe(value)
  })
})
