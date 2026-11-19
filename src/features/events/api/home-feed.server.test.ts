import { describe, expect, it, vi } from 'vitest'
import { agendaEvent } from '../../../../tests/support/home-agenda.ts'
import { readHomeFeed } from './home-feed.server.ts'

const midnight = Date.parse('2026-11-19T03:00:00.000Z')
const events = [agendaEvent('one', '2026-11-19T22:00:00.000Z')]
function cachedAt(storedAt: number) {
  return {
    match: vi.fn(async (_key: string) => Response.json({ events, storedAt })),
    put: vi.fn(async (_key: string, _response: Response) => {}),
  }
}

describe('shared homepage agenda cache', () => {
  it('serves a fresh cache hit without starting a database read', async () => {
    const load = vi.fn(async () => [])
    expect(await readHomeFeed({ cache: cachedAt(midnight), now: () => midnight + 59_000, load })).toMatchObject({ events })
    expect(load).not.toHaveBeenCalled()
  })

  it('serves stale cards immediately and retains one refresh', async () => {
    const cache = cachedAt(midnight)
    const load = vi.fn(async () => events)
    const tasks: Promise<unknown>[] = []
    expect(await readHomeFeed({ cache, now: () => midnight + 60_000, load, retain: (task) => { tasks.push(task) } })).toMatchObject({ events })
    await Promise.all(tasks)
    expect(load).toHaveBeenCalledOnce()
    expect(cache.put).toHaveBeenCalledOnce()
  })

  it('uses an agenda-only cache key and changes it at Buenos Aires midnight', async () => {
    const cache = cachedAt(midnight - 2_000)
    await readHomeFeed({ cache, now: () => midnight - 1 })
    await readHomeFeed({ cache, now: () => midnight })
    expect(cache.match.mock.calls.map(([key]) => key)).toEqual([
      'https://baeventos.com/__cache/home-agenda-slots-1/2026-11-18',
      'https://baeventos.com/__cache/home-agenda-slots-1/2026-11-19',
    ])
  })

  it('awaits a cold or expired read for SSR', async () => {
    const load = vi.fn(async () => events)
    for (const cache of [undefined, cachedAt(midnight)]) {
      expect(await readHomeFeed({ cache, now: () => midnight + 360_000, load })).toMatchObject({ events })
    }
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('does not cache a failed read as a successful empty feed', async () => {
    const cache = { match: vi.fn(async () => undefined), put: vi.fn() }
    await expect(readHomeFeed({ cache, load: async () => { throw new Error('offline') } })).rejects.toThrow('offline')
    expect(cache.put).not.toHaveBeenCalled()
  })
})
