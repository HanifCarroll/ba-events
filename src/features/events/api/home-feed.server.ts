import { Effect } from 'effect'
import { getHappeningSoonEventsForGridEffect } from './crud.server.ts'
import { HOME_FEED_FRESH_SECONDS, HOME_FEED_STALE_SECONDS, type HomeEventCard } from '../lib/home-feed.ts'
import type { PublicCache } from './platform-cache.ts'

const CACHE_KEY = 'https://baeventos.com/__cache/home-feed-v1'
type Entry = { events: HomeEventCard[]; storedAt: number }
type Options = { cache?: PublicCache; retain?: (task: Promise<unknown>) => void; now?: () => number; load?: () => Promise<HomeEventCard[]> }

/** Cache API adapter. A miss is returned as a nested promise so SSR can stream the row. */
export async function readHomeFeed(options: Options = {}): Promise<{ events: HomeEventCard[] } | { pending: Promise<HomeEventCard[]> }> {
  const now = options.now ?? Date.now
  const cache = options.cache
  const refresh = async () => {
    const events = await (options.load?.() ?? Effect.runPromise(getHappeningSoonEventsForGridEffect()))
    if (cache) {
      const response = Response.json({ events, storedAt: now() } satisfies Entry, {
        headers: { 'Cache-Control': `public, max-age=${HOME_FEED_FRESH_SECONDS + HOME_FEED_STALE_SECONDS}` },
      })
      await cache.put(CACHE_KEY, response).catch(() => {})
    }
    return events
  }
  const cached = await cache?.match(CACHE_KEY).catch(() => undefined)
  if (cached) {
    const entry = await cached.json() as Entry
    const age = (now() - entry.storedAt) / 1000
    if (age < HOME_FEED_FRESH_SECONDS + HOME_FEED_STALE_SECONDS) {
      if (age >= HOME_FEED_FRESH_SECONDS) options.retain?.(refresh().catch(() => []))
      return { events: entry.events }
    }
  }
  // Catch before exposing a streamed promise: a failed feed must not reject the page.
  return { pending: refresh().catch(() => []) }
}

export function homeFeedOptions(platform: App.Platform | undefined): Options {
  return {
    cache: platform?.caches?.default as unknown as PublicCache | undefined,
    retain: platform?.context ? (task) => platform.context.waitUntil(task) : undefined,
  }
}
