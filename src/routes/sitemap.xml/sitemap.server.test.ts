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
    ['already-ended', '2026-11-27T11:59:59.999Z', 'scheduled', 'in'],
    ['past-status', later, 'past', 'in'],
    ['canceled', later, 'canceled', 'in'],
    ['postponed', later, 'postponed', 'in'],
    ['out-of-scope', later, 'scheduled', 'out'],
    ['unjudged', later, 'scheduled', null],
    ['in-review', later, 'pending_review', 'in'],
  ] as const
  await fixture.db.batch(rows.map(([id, start, status, scope]) => fixture.db.prepare(`
    INSERT INTO events (id, name, source, starts_at, status, scope, updated_at, image_url)
    VALUES (?, 'Synthetic event', 'luma', ?, ?, ?, ?, 'https://example.test/flyer.png')
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
      'https://baeventos.com/agenda/hoy',
      'https://baeventos.com/agenda/fin-de-semana',
      'https://baeventos.com/agenda/esta-semana',
      'https://baeventos.com/agenda/gratis',
    ])
    expect(Array.from(xml.matchAll(/<lastmod>(.*?)<\/lastmod>/g), match => match[1])).toEqual([
      modified, modified, modified, modified, modified,
    ])
  })

  it('uses the Agenda cutoffs for date-only, doors-only, and timed events', async () => {
    const rows = [
      ['today-tba', '2026-11-27T03:00:00.000Z', null, null, 1, 0],
      ['today-doors', '2026-11-27T03:00:00.000Z', null, '2026-11-28T00:00:00.000Z', 1, 0],
      ['yesterday-tba', '2026-11-26T03:00:00.000Z', null, null, 1, 0],
      ['yesterday-doors', '2026-11-26T03:00:00.000Z', null, '2026-11-27T00:00:00.000Z', 1, 0],
      ['running', '2026-11-26T20:00:00.000Z', '2026-11-28T20:00:00.000Z', null, 0, 0],
      ['finished', '2026-11-26T20:00:00.000Z', '2026-11-27T14:00:00.000Z', null, 0, 0],
      ['starts-in-one-hour', '2026-11-27T16:00:00.000Z', null, null, 0, 0],
      ['started-two-hours-ago', '2026-11-27T13:00:00.000Z', null, null, 0, 0],
      ['started-three-hours-ago', '2026-11-27T12:00:00.000Z', null, null, 0, 0],
      ['all-day-today', '2026-11-27T03:00:00.000Z', null, null, 0, 1],
    ] as const
    await fixture.db.batch(rows.map(row => fixture.db.prepare(`INSERT INTO events
      (id, starts_at, ends_at, doors_at, time_tba, is_all_day, name, source, status, scope)
      VALUES (?, ?, ?, ?, ?, ?, 'Synthetic cutoff event', 'luma', 'scheduled', 'in')`).bind(...row)))
    try {
      const xml = await (await fetchSitemap()).text()
      for (const id of ['today-tba', 'today-doors', 'running', 'starts-in-one-hour', 'started-two-hours-ago', 'all-day-today']) {
        expect(xml).toContain(`/events/${id}</loc>`)
      }
      for (const id of ['yesterday-tba', 'yesterday-doors', 'finished', 'started-three-hours-ago']) {
        expect(xml).not.toContain(`/events/${id}</loc>`)
      }
    } finally {
      await fixture.db.prepare('DELETE FROM events WHERE id IN (SELECT value FROM json_each(?))')
        .bind(JSON.stringify(rows.map(([id]) => id))).run()
    }
  })
})
