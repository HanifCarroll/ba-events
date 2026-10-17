import { describe, expect, it, vi } from 'vitest'
import { readHomeFeed } from './home-feed.server.ts'
import type { HomeEventCard } from '../lib/home-feed.ts'

const events = [{ id: 'one' }] as HomeEventCard[]
function cachedAt(storedAt: number) {
  return { match: vi.fn(async () => Response.json({ events, storedAt })), put: vi.fn(async () => {}) } as unknown as Cache
}

describe('shared homepage cards cache', () => {
  it('serves a fresh cache hit without starting a database read', async () => {
    const load = vi.fn(async () => [])
    expect(await readHomeFeed({ cache: cachedAt(0), now: () => 59_000, load })).toEqual({ events })
    expect(load).not.toHaveBeenCalled()
  })

  it('serves stale cards immediately and retains one refresh', async () => {
    const cache = cachedAt(0)
    const load = vi.fn(async () => events)
    const tasks: Promise<unknown>[] = []
    expect(await readHomeFeed({ cache, now: () => 60_000, load, retain: (task) => { tasks.push(task) } })).toEqual({ events })
    await Promise.all(tasks)
    expect(load).toHaveBeenCalledOnce()
    expect(cache.put).toHaveBeenCalledOnce()
  })

  it('returns a cold read as a nested promise before the database completes', async () => {
    let finish!: (cards: HomeEventCard[]) => void
    const pending = new Promise<HomeEventCard[]>((resolve) => { finish = resolve })
    const feed = await readHomeFeed({ load: () => pending })
    expect('pending' in feed).toBe(true)
    finish(events)
    if ('pending' in feed) expect(await feed.pending).toEqual(events)
  })

  it('expires stale entries and exposes the read as a nested promise', async () => {
    const feed = await readHomeFeed({ cache: cachedAt(0), now: () => 360_000, load: async () => events })
    expect('pending' in feed).toBe(true)
    if ('pending' in feed) expect(await feed.pending).toEqual(events)
  })

  it('does not cache a failed database read as a successful empty list', async () => {
    const cache = { match: vi.fn(async () => undefined), put: vi.fn() } as unknown as Cache
    const feed = await readHomeFeed({ cache, load: async () => { throw new Error('offline') } })
    if (!('pending' in feed)) throw new Error('Expected streamed miss')
    expect(await feed.pending).toEqual([])
    expect(cache.put).not.toHaveBeenCalled()
  })
})
