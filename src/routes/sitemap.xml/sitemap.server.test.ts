import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { freshD1 } from '../../../tests/support/d1.ts'
import { useCloudflareBindings } from '#shared/lib/db/search-bindings.server.ts'
import { GET } from './+server.ts'

const now = new Date('2026-11-27T15:00:00.000Z')
const later = '2026-11-28T23:00:00.000Z'
const modified = '2026-11-26T17:45:42.123Z'
let fixture: Awaited<ReturnType<typeof freshD1>>

beforeAll(async () => {
  fixture = await freshD1()
  useCloudflareBindings({ DB: fixture.db })
  const rows = [
    ['future&live', later, 'scheduled', 'in'],
    ['starts-now', now.toISOString(), 'scheduled', 'in'],
    ['already-started', '2026-11-27T14:59:59.999Z', 'scheduled', 'in'],
    ['past-status', later, 'past', 'in'],
    ['canceled', later, 'canceled', 'in'],
    ['postponed', later, 'postponed', 'in'],
    ['out-of-scope', later, 'scheduled', 'out'],
    ['unjudged', later, 'scheduled', null],
    ['in-review', later, 'pending_review', 'in'],
  ] as const
  await fixture.db.batch(rows.map(([id, start, status, scope]) => fixture.db.prepare(`
    INSERT INTO events (id, name, source, starts_at, status, scope, updated_at)
    VALUES (?, 'Synthetic event', 'luma', ?, ?, ?, ?)
  `).bind(id, start, status, scope, modified)))
}, 60_000)

afterAll(async () => {
  useCloudflareBindings({})
  await fixture?.dispose()
})

async function fetchSitemap() {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)
  try {
    return await GET()
  } finally {
    vi.useRealTimers()
  }
}

describe('GET /sitemap.xml', () => {
  it('returns XML with only future scheduled, in-scope event URLs and their catalog revision dates', async () => {
    const response = await fetchSitemap()
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/xml; charset=utf-8')
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=0, s-maxage=3600')
    const xml = await response.text()
    expect(Array.from(xml.matchAll(/<loc>(.*?)<\/loc>/g), match => match[1])).toEqual([
      'https://baeventos.com',
      'https://baeventos.com/mcp',
      'https://baeventos.com/events/starts-now',
      'https://baeventos.com/events/future&amp;live',
    ])
    expect(Array.from(xml.matchAll(/<lastmod>(.*?)<\/lastmod>/g), match => match[1])).toEqual([modified, modified])
  })
})
