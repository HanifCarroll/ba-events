import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { freshD1 } from '../../../tests/support/d1.ts'
import { loadBarrioIndex, loadBarrioPage, loadVenuePage } from '#features/discovery/api/place-page.server.ts'
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

type FixtureVenue = readonly [id: string, name: string, neighborhood: string]
type FixtureListing = { id: string; venue: string; title: string; start: string }

async function withPlaceListings(venues: readonly FixtureVenue[], listings: FixtureListing[], read: () => Promise<void>) {
  try {
    await fixture.db.batch([
      ...venues.map(venue => fixture.db.prepare('INSERT INTO venues (id, name, neighborhood) VALUES (?, ?, ?)').bind(...venue)),
      ...listings.map(({ id, venue, title, start }) => fixture.db.prepare(`INSERT INTO events
        (id, venue_id, name, starts_at, source, status, scope, image_url)
        VALUES (?, ?, ?, ?, 'luma', 'scheduled', 'in', 'https://example.test/place.png')`).bind(id, venue, title, start)),
    ])
    await onFixtureDate(read)
  } finally {
    await fixture.db.batch(venues.map(([id]) => fixture.db.prepare('DELETE FROM events WHERE venue_id = ?').bind(id)))
    await fixture.db.batch(venues.map(([id]) => fixture.db.prepare('DELETE FROM venues WHERE id = ?').bind(id)))
  }
}

function sitemapVenueUrls(xml: string) {
  return Array.from(xml.matchAll(/<loc>(https:\/\/baeventos\.com\/lugares\/[^<]+)<\/loc>/g), match => match[1]).sort()
}

describe('GET /sitemap.xml', () => {
  it('returns XML with only future scheduled, in-scope event URLs and their catalog revision dates', async () => {
    const response = await onFixtureDate(GET)
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/xml; charset=utf-8')
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=0, s-maxage=3600')
    const xml = await response.text()
    const urls = Array.from(xml.matchAll(/<loc>(.*?)<\/loc>/g), match => match[1])
    expect(urls.slice(0, 15)).toEqual([
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
      'https://baeventos.com/agenda/barrios',
    ])
    const barrios = urls.filter(loc => loc.includes('/agenda/barrio/'))
    expect(barrios).toHaveLength(48)
    expect(barrios).toContain('https://baeventos.com/agenda/barrio/villa-crespo')
    expect(urls.filter(loc => loc.includes('/lugares/'))).toEqual(['https://baeventos.com/lugares/sala-proof'])
    expect(Array.from(xml.matchAll(/<lastmod>(.*?)<\/lastmod>/g), match => match[1])).toEqual([
      modified, modified, modified, modified, modified, modified, modified, modified,
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

  it('lists the day-eight barrio and venue but recommends only the top three weekly barrios', async () => {
    const venues = [
      ['day-eight', 'Sala Día Ocho', 'Flores'],
      ['weekly-caballito', 'Sala Caballito', 'Caballito'],
      ['weekly-palermo', 'Sala Palermo', 'Palermo'],
      ['weekly-recoleta', 'Sala Recoleta', 'Recoleta'],
      ['weekly-boedo', 'Sala Boedo', 'Boedo'],
    ] as const
    const listings = venues.flatMap(([venue], index) => Array.from({ length: [5, 3, 2, 1, 1][index] }, (_, i) => ({
      venue, id: `${venue}-${i + 1}`, title: `Cartelera ${i + 1}`,
      start: new Date(Date.parse(venue === 'day-eight' ? '2026-12-04T03:00:00.000Z' : later) + i * 60_000).toISOString(),
    })))
    await withPlaceListings(venues, listings, async () => {
      const index = await loadBarrioIndex(() => {}, false)
      expect(index.links).toEqual([
        { name: 'Flores', href: '/agenda/barrio/flores' },
        { name: 'Caballito', href: '/agenda/barrio/caballito' },
        { name: 'Palermo', href: '/agenda/barrio/palermo' },
        { name: 'Almagro', href: '/agenda/barrio/almagro' },
        { name: 'Boedo', href: '/agenda/barrio/boedo' },
        { name: 'Recoleta', href: '/agenda/barrio/recoleta' },
      ])
      const barrio = await loadBarrioPage('almagro', () => {}, false)
      const recommendation = barrio.faq.find(entry => entry.question === '¿Hay eventos en otros barrios?')?.answer ?? ''
      expect(Array.from(recommendation.matchAll(/\[([^\]]+)\]\((\/agenda\/barrio\/[^)]+)\)/g), ([, name, href]) => ({ name, href }))).toEqual([
        { name: 'Caballito', href: '/agenda/barrio/caballito' },
        { name: 'Palermo', href: '/agenda/barrio/palermo' },
        { name: 'Boedo', href: '/agenda/barrio/boedo' },
      ])
      const dayEightVenue = await loadVenuePage('sala-dia-ocho', () => {}, false)
      expect(dayEightVenue.sections.flatMap(section => section.cards.map(card => card.id))).toEqual([
        'day-eight-1', 'day-eight-2', 'day-eight-3', 'day-eight-4', 'day-eight-5',
      ])
      const xml = await (await GET()).text()
      expect(sitemapVenueUrls(xml)).toEqual([
        'https://baeventos.com/lugares/sala-boedo',
        'https://baeventos.com/lugares/sala-caballito',
        'https://baeventos.com/lugares/sala-dia-ocho',
        'https://baeventos.com/lugares/sala-palermo',
        'https://baeventos.com/lugares/sala-proof',
        'https://baeventos.com/lugares/sala-recoleta',
      ])
    })
  })

  it('groups duplicate venue slots before taking the first 30 cards in order', async () => {
    const venue = 'fixture-capacity'
    const start = Date.parse(later)
    const distinct = Array.from({ length: 31 }, (_, index) => ({
      venue, id: `slot-${index + 1}`, title: `Función ${index + 1}`, start: new Date(start + index * 3_600_000).toISOString(),
    }))
    const extra = { ...distinct[0], id: 'slot-repeat', start: new Date(start + 30 * 60_000).toISOString() }
    await withPlaceListings([[venue, 'Sala Capacidad', 'Boedo']], [extra, ...distinct.toReversed()], async () => {
      const page = await loadVenuePage('sala-capacidad', () => {}, false)
      const cards = page.sections.flatMap(section => section.cards)
      expect(cards.map(card => card.id)).toEqual(distinct.slice(0, 30).map(listing => listing.id))
      expect(cards[0].slotStarts).toEqual([later, extra.start])
      expect(sitemapVenueUrls(await (await GET()).text())).toEqual([
        'https://baeventos.com/lugares/sala-capacidad', 'https://baeventos.com/lugares/sala-proof',
      ])
    })
  })

  it('returns a venue page for an eligible event and a 404 for a venue with only canceled events', async () => {
    const venue = await onFixtureDate(() => loadVenuePage('sala-proof', () => {}, false))
    expect(venue.sections.flatMap(section => section.cards.map(card => card.id))).toEqual(['future&live'])
    await expect(onFixtureDate(() => loadVenuePage('sala-sin-eventos', () => {}, false))).rejects.toMatchObject({ status: 404 })
  })
})
