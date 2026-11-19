import { getHomeAgendaEvents } from '#shared/lib/db/client.server.ts'
import { HOME_FEED_FRESH_SECONDS, HOME_FEED_STALE_SECONDS, homeWindow, type HomeAgenda, type HomeAgendaEvent, type HomeWindow } from '../lib/home-feed.ts'
import type { PublicCache } from './platform-cache.ts'

const CACHE_PREFIX = 'https://baeventos.com/__cache/home-agenda-slots-1'
type Entry = { events: HomeAgendaEvent[]; storedAt: number }
type Options = { cache?: PublicCache; retain?: (task: Promise<unknown>) => void; now?: () => number; load?: (window: HomeWindow) => Promise<HomeAgendaEvent[]> }

/** Cold reads wait for the result so the selected view is present in server HTML. */
export async function readHomeFeed(options: Options = {}): Promise<HomeAgenda> {
  const now = options.now ?? Date.now
  const asOf = now()
  const window = homeWindow(new Date(asOf))
  const key = `${CACHE_PREFIX}/${window.day}`
  const cache = options.cache
  const refresh = async () => {
    const events = await (options.load ?? getHomeAgendaEvents)(window)
    if (cache) {
      const response = Response.json({ events, storedAt: now() } satisfies Entry, {
        headers: { 'Cache-Control': `public, max-age=${HOME_FEED_FRESH_SECONDS + HOME_FEED_STALE_SECONDS}` },
      })
      await cache.put(key, response).catch(() => {})
    }
    return { window, events, asOf }
  }
  const cached = await cache?.match(key).catch(() => undefined)
  const entry = await cached?.json().catch(() => undefined) as Entry | undefined
  if (entry && Array.isArray(entry.events)) {
    const age = (now() - entry.storedAt) / 1000
    if (age < HOME_FEED_FRESH_SECONDS + HOME_FEED_STALE_SECONDS) {
      if (age >= HOME_FEED_FRESH_SECONDS) options.retain?.(refresh().catch(() => {}))
      return { window, events: entry.events, asOf }
    }
  }
  return refresh()
}

export function homeFeedOptions(platform: App.Platform | undefined): Options {
  return {
    cache: platform?.caches?.default as unknown as PublicCache | undefined,
    retain: platform?.context ? (task) => platform.context.waitUntil(task) : undefined,
  }
}
