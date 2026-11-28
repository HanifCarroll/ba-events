import { expect, it } from 'vitest'
import { homeWindow } from '#features/events/lib/home-feed.ts'
import type { AgendaListing } from '#shared/lib/db/event-reads-d1.server.ts'
import { agendaEvent } from '../../../../tests/support/home-agenda.ts'
import { barriosBySlug, currentPlaceEvents, eventsForBarrioIndex, placeSlug, rankBarrios, selectBarrio, venuesBySlug, type DiscoveryVenue } from './place-pages.ts'

const venue = (id: string, name: string, created_at: string): DiscoveryVenue => ({
  id, name, created_at, address: null, neighborhood: 'Villa Crespo', website: null, instagram_handle: null,
})

it('generates stable readable barrio slugs, including accents', () => {
  expect(placeSlug('  VILLA CRESPO  ')).toBe('villa-crespo')
  expect(barriosBySlug.get('villa-ortuzar')).toBe('Villa Ortúzar')
  expect(barriosBySlug.size).toBe(48)
})

it('assigns the oldest same-name venue the plain slug and gives later records an immutable suffix', () => {
  const a = venue('11111111-1111-4111-8111-111111111111', 'La Tangente', '2025-01-01')
  const b = venue('22222222-2222-4222-8222-222222222222', 'La Tángente!', '2026-01-01')
  const c = venue('33333333-3333-4333-8333-333333333333', 'La Tangente', '2026-07-01')
  for (const rows of [[a, b], [b, a], [c, b, a]]) {
    const slugs = venuesBySlug(rows)
    expect(slugs.get('la-tangente')).toBe(a)
    expect(slugs.get('la-tangente--22222222-2222-4222-8222-222222222222')).toBe(b)
  }
})

const now = new Date('2026-11-27T15:00:00.000Z')
const snapshot = (events: AgendaListing[]) => ({ asOf: +now, window: homeWindow(now), events })
const event = (id: string, starts_at: string, details: Partial<AgendaListing> = {}): AgendaListing => ({
  ...agendaEvent(id, starts_at, { venue_neighborhood: 'Almagro', venue_id: `venue-${id}` }),
  details: { source: 'luma', updated_at: starts_at, ticket_url: null, description_es: null }, ...details,
})

it('selects a barrio by confirmed venue neighborhood and uses local midnight for today and the seven-day window', () => {
  const rows = [
    event('last-today', '2026-11-28T02:59:59.999Z'),
    event('first-tomorrow', '2026-11-28T03:00:00.000Z'),
    event('last-this-week', '2026-12-04T02:59:59.999Z'),
    event('first-next-week', '2026-12-04T03:00:00.000Z'),
    event('hidden', '2026-11-27T20:00:00.000Z', { location_hidden: true }),
    event('location-tba', '2026-11-27T20:00:00.000Z', { location_tba: true }),
    event('other-barrio', '2026-11-27T20:00:00.000Z', { venue_neighborhood: 'Palermo' }),
    event('unknown-barrio', '2026-11-27T20:00:00.000Z', { venue_neighborhood: null }),
    event('ended', '2026-11-27T13:00:00.000Z', { ends_at: '2026-11-27T14:00:00.000Z' }),
  ]
  const { today, current, next } = selectBarrio(snapshot(rows), 'Almagro')
  expect(today.map(event => event.id)).toEqual(['last-today'])
  expect(current.map(event => event.id)).toEqual(['last-today', 'first-tomorrow', 'last-this-week'])
  expect(next?.id).toBe('first-next-week')
})

it('ranks other barrios by weekly card count, breaking ties alphabetically and omitting the current barrio', () => {
  const starts = '2026-11-27T20:00:00.000Z'
  const rows = [
    event('palermo', starts, { venue_neighborhood: 'Palermo' }),
    event('local', starts),
    event('villa-1', starts, { venue_neighborhood: 'Villa Crespo' }),
    event('boedo', starts, { venue_neighborhood: 'Boedo' }),
    event('villa-2', starts, { venue_neighborhood: 'Villa Crespo' }),
    event('private', starts, { venue_neighborhood: 'Palermo', location_hidden: true }),
  ]
  expect(rankBarrios(rows, 'Almagro')).toEqual(['Villa Crespo', 'Boedo', 'Palermo'])
})

it('shows date-only and running events in places but excludes ended or unconfirmed events and venues without a barrio from the index', () => {
  const rows = [
    event('tba-with-doors', '2026-11-27T03:00:00.000Z', { time_tba: true, doors_at: '2026-11-28T00:00:00.000Z' }),
    event('running', '2026-11-27T13:00:00.000Z', { ends_at: '2026-11-27T21:00:00.000Z', venue_neighborhood: 'Palermo' }),
    event('ended', '2026-11-27T13:00:00.000Z', { ends_at: '2026-11-27T14:00:00.000Z', venue_neighborhood: 'Recoleta' }),
    event('venue-outside-index', '2026-11-27T21:00:00.000Z', { venue_neighborhood: null }),
    event('venue-hidden', '2026-11-27T21:00:00.000Z', { venue_neighborhood: 'Boedo', location_hidden: true }),
    event('venue-tba', '2026-11-27T21:00:00.000Z', { venue_neighborhood: 'Caballito', location_tba: true }),
  ]
  expect(currentPlaceEvents(snapshot(rows)).map(event => event.id)).toEqual(['tba-with-doors', 'running', 'venue-outside-index'])
  expect(rankBarrios(eventsForBarrioIndex(snapshot(rows)))).toEqual(['Almagro', 'Palermo'])
})
