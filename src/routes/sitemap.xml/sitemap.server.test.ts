import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { freshD1 } from '../../../tests/support/d1.ts'
import { loadAboutPage } from '#features/discovery/api/about-page.server.ts'
import { loadBarrioIndex, loadVenuePage } from '#features/discovery/api/place-page.server.ts'
import { useCloudflareBindings } from '#shared/lib/db/search-bindings.server.ts'
import { GET } from './+server.ts'

const now = new Date('2026-11-27T15:00:00.000Z')
const later = '2026-11-28T23:00:00.000Z'
const modified = '2026-11-26T17:45:42.123Z'
let fixture: Awaited<ReturnType<typeof freshD1>>

beforeAll(async () => {
  fixture = await freshD1()
  useCloudflareBindings({ DB: fixture.db })
  await fixture.db.batch([
    fixture.db.prepare("INSERT INTO venues (id, name, neighborhood) VALUES ('fixture-venue', 'Sala Proof', 'Almagro')"),
    fixture.db.prepare("INSERT INTO venues (id, name, neighborhood) VALUES ('fixture-closed', 'Sala sin eventos', 'Villa Crespo')"),
  ])
  await fixture.db.batch(Array.from({ length: 12 }, (_, i) => fixture.db.prepare(`INSERT INTO instagram_sources
    (username, authority, qualification, enabled) VALUES (?, 'venue', 'synthetic', ?)`).bind(`fixture_${i}`, i < 11 ? 1 : 0)))
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
    INSERT INTO events (id, name, source, starts_at, status, scope, updated_at, image_url, venue_id)
    VALUES (?, 'Synthetic event', 'luma', ?, ?, ?, ?, 'https://example.test/flyer.png', ?)
  `).bind(id, start, status, scope, modified, id === 'canceled' ? 'fixture-closed' : id === 'future&live' ? 'fixture-venue' : null)))
}, 60_000)

afterAll(async () => {
  useCloudflareBindings({})
  await fixture?.dispose()
})

async function onFixtureDate<T>(load: () => Promise<T>) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)
  try {
    return await load()
  } finally {
    vi.useRealTimers()
  }
}

describe('GET /sitemap.xml', () => {
  it('returns XML with only future scheduled, in-scope event URLs and their catalog revision dates', async () => {
    const response = await onFixtureDate(GET)
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/xml; charset=utf-8')
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=0, s-maxage=3600')
    const xml = await response.text()
    const urls = Array.from(xml.matchAll(/<loc>(.*?)<\/loc>/g), match => match[1])
    expect(urls.slice(0, 19)).toEqual([
      'https://baeventos.com',
      'https://baeventos.com/mcp',
      'https://baeventos.com/events/starts-now',
      'https://baeventos.com/events/future&amp;live',
      'https://baeventos.com/agenda/hoy',
      'https://baeventos.com/agenda/fin-de-semana',
      'https://baeventos.com/agenda/esta-semana',
      'https://baeventos.com/agenda/gratis',
      'https://baeventos.com/agenda/teatro',
      'https://baeventos.com/agenda/musica-en-vivo',
      'https://baeventos.com/agenda/ferias',
      'https://baeventos.com/agenda/muestras',
      'https://baeventos.com/agenda/poesia',
      'https://baeventos.com/agenda/tango',
      'https://baeventos.com/en/things-to-do-this-weekend',
      'https://baeventos.com/en/free-events-this-week',
      'https://baeventos.com/que-es-ba-eventos',
      'https://baeventos.com/en/about',
      'https://baeventos.com/agenda/barrios',
    ])
    const barrios = urls.filter(loc => loc.includes('/agenda/barrio/'))
    expect(barrios).toHaveLength(48)
    expect(barrios).toContain('https://baeventos.com/agenda/barrio/villa-crespo')
    expect(urls.filter(loc => loc.includes('/lugares/'))).toEqual(['https://baeventos.com/lugares/sala-proof'])
    expect(Array.from(xml.matchAll(/<lastmod>(.*?)<\/lastmod>/g), match => match[1])).toEqual([
      modified, modified, modified, modified, modified, modified, modified, modified, modified,
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
      const xml = await (await onFixtureDate(GET)).text()
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

  it('agrees across the barrio index, venue route, and sitemap for current occurrences', async () => {
    const places = [
      ['fixture-doors', 'Sala Puertas', 'Boedo'],
      ['fixture-running', 'Sala Activa', 'Palermo'],
      ['fixture-ended', 'Sala Terminada', 'Recoleta'],
    ] as const
    await fixture.db.batch(places.map(place => fixture.db.prepare('INSERT INTO venues (id, name, neighborhood) VALUES (?, ?, ?)').bind(...place)))
    await fixture.db.batch([
      ['fixture-doors', '2026-11-27T03:00:00.000Z', null, 1, '2026-11-28T00:00:00.000Z'],
      ['fixture-running', '2026-11-27T13:00:00.000Z', '2026-11-27T21:00:00.000Z', 0, null],
      ['fixture-ended', '2026-11-27T13:00:00.000Z', '2026-11-27T14:00:00.000Z', 0, null],
    ].map(([venue, start, end, tba, doors]) => fixture.db.prepare(`INSERT INTO events
      (id, venue_id, name, source, starts_at, ends_at, time_tba, doors_at, status, scope, image_url)
      VALUES (?, ?, 'Synthetic place event', 'luma', ?, ?, ?, ?, 'scheduled', 'in', 'https://example.test/place.png')`)
      .bind(`event-${venue}`, venue, start, end, tba, doors)))
    try {
      await onFixtureDate(async () => {
        const index = await loadBarrioIndex(() => {}, false)
        expect(index.links.map(link => link.name)).toEqual(['Almagro', 'Boedo', 'Palermo'])
        for (const [slug, id] of [['sala-puertas', 'fixture-doors'], ['sala-activa', 'fixture-running']]) {
          const page = await loadVenuePage(slug, () => {}, false)
          expect(page.sections.flatMap(section => section.cards.map(card => card.id))).toEqual([`event-${id}`])
        }
        await expect(loadVenuePage('sala-terminada', () => {}, false)).rejects.toMatchObject({ status: 404,
          body: { message: 'No hay eventos próximos en este lugar.' } })
        const xml = await (await GET()).text()
        expect(xml).toContain('/lugares/sala-puertas</loc>')
        expect(xml).toContain('/lugares/sala-activa</loc>')
        expect(xml).not.toContain('/lugares/sala-terminada</loc>')
      })
    } finally {
      await fixture.db.batch(places.map(([id]) => fixture.db.prepare('DELETE FROM events WHERE id = ?').bind(`event-${id}`)))
      await fixture.db.batch(places.map(([id]) => fixture.db.prepare('DELETE FROM venues WHERE id = ?').bind(id)))
    }
  })

  it('uses the live enabled-source count and the review month in the about copy', async () => {
    const about = await loadAboutPage('/en/about', () => {}, false)
    expect(about.lang).toBe('en')
    expect(about.updated).toBe('Updated November 2026')
    expect(about.blocks.join(' ')).toContain('more than 10 accounts')
    expect(about.blocks.join(' ')).not.toMatch(/{{|\[HANIF:|Passline/)
  })

  it('returns a venue page for an eligible event and a 404 for a venue with only canceled events', async () => {
    const venue = await onFixtureDate(() => loadVenuePage('sala-proof', () => {}, false))
    expect(venue.sections.flatMap(section => section.cards.map(card => card.id))).toEqual(['future&live'])
    await expect(onFixtureDate(() => loadVenuePage('sala-sin-eventos', () => {}, false))).rejects.toMatchObject({ status: 404 })
  })
})
