import { describe, expect, it } from 'vitest'
import type { CatalogStore, VenueReviewWrite } from './catalog-store.ts'
import { areaOnlyVenueName, getVenueIdFromResults, settleVenue, settleVenues, venueSettlementKey } from './venue-settlement.ts'
import { venueNameKey } from './venue-identity.ts'

describe('areaOnlyVenueName', () => {
  it('sorts a city, region, or postal code from a barrio', () => {
    for (const name of ['Buenos Aires, Argentina', 'C1437EFA C1437EFA, Argentina', 'Buenos Aires, Ciudad Autónoma de Buenos Aires',
      'Caba', 'CABA', 'Comuna 15', 'Argentina']) expect(areaOnlyVenueName(name), name).toBe('city')
    for (const name of ['Caballito', 'belgrano', 'Palermo, Buenos Aires', 'MICROCENTRO.', 'C1426BMI, Ciudad Autónoma de Buenos Aires Palermo', 'La Boca'])
      expect(areaOnlyVenueName(name), name).toBe('barrio')
  })

  it('keeps real venues, street addresses, and barrios named after a park', () => {
    for (const name of ['Teatro Buenos Aires', 'Club de Pescadores Buenos Aires', 'Espacio de Vinos Caballito', 'Constitución 3257',
      'Av. Corrientes 1530', 'Estadio Cubierto Malvinas Argentinas', 'Torre Banco Macro', 'Parque Avellaneda', 'Parque Chacabuco',
      'Parque Patricios', '', null])
      expect(areaOnlyVenueName(name), String(name)).toBeNull()
  })
})

function venuesTable(
  seed: Array<{ id: string; name: string; address: string | null; neighborhood?: string | null; created_at?: string; events?: number }> = [],
  similar: Record<string, { name: string; similarity: number }> = {},
) {
  const defaults = { neighborhood: null, created_at: '2026-01-01T00:00:00Z', events: 0 }
  const rows = seed.map(row => ({ ...defaults, ...row }))
  const queued: VenueReviewWrite[] = []
  let created = 0
  const client = {
    venuesNamed: async (name: string) => rows.filter(row => venueNameKey(row.name) === venueNameKey(name))
      .map(({ events, ...venue }) => ({ ...venue, event_count: events })),
    similarVenue: async (name: string) => similar[name] ? { id: 'unused', ...similar[name] } : null,
    createVenue: async (input: Parameters<CatalogStore['createVenue']>[0]) => {
      const venue = { ...defaults, ...input, id: `created-${++created}` }
      rows.push(venue)
      return venue
    },
    queueVenueReview: async (row: VenueReviewWrite) => { queued.push(row) },
  }
  return { client: client as unknown as CatalogStore, rows, queued }
}

describe('settleVenue with an area-only name', () => {
  it('never matches or creates a city-only name', async () => {
    const { client, rows } = venuesTable([{ id: 'fake', name: 'Buenos Aires, Argentina', address: 'Av. Ficticia 1234' }])
    expect(await settleVenue(client, { name: 'Buenos Aires, Argentina', address: 'Av. Ficticia 1234' }, { source: 'luma' })).toMatchObject({ venueId: null, action: 'skipped' })
    expect(rows).toHaveLength(1)
  })

  it('skips a barrio name without its own street address, even when a same-name venue has one', async () => {
    const { client, rows } = venuesTable([{ id: 'la-boca-bar', name: 'La Boca', address: 'Av. Ficticia 1234', neighborhood: 'La Boca' }])
    expect(await settleVenue(client, { name: 'La Boca' }, { source: 'meetup' })).toMatchObject({ venueId: null, action: 'skipped' })
    expect(await settleVenue(client, { name: 'La Boca', coordinates: { lat: -34.63, lng: -58.36 } }, { source: 'meetup' })).toMatchObject({ venueId: null, action: 'skipped' })
    expect(rows).toHaveLength(1)
  })

  it('reuses a barrio-named venue only at the same street and number', async () => {
    const { client } = venuesTable([{ id: 'la-boca-bar', name: 'La Boca', address: 'Av. Ficticia 1234, CABA', neighborhood: 'La Boca' }])
    expect(await settleVenue(client, { name: 'La Boca', address: 'Avenida Ficticia N° 1234' }, { source: 'meetup' })).toMatchObject({ venueId: 'la-boca-bar', action: 'matched' })
  })

  it('creates a new venue for a barrio name at another numbered address instead of reusing the old one', async () => {
    const { client } = venuesTable([{ id: 'bucket', name: 'San Telmo', address: 'Bolívar 624', neighborhood: 'San Telmo' }])
    expect(await settleVenue(client, { name: 'San Telmo', address: 'Defensa 1200', neighborhood: 'San Telmo' }, { source: 'meetup' }))
      .toMatchObject({ action: 'auto-created' })
  })
})

describe('barrio-named venues across imports', () => {
  const A = { name: 'San Telmo', address: 'Bolívar 624', neighborhood: 'San Telmo' }
  const B = { name: 'San Telmo' }
  const C = { name: 'San Telmo', address: 'Defensa 1200', neighborhood: 'San Telmo' }

  it('successive imports: A creates its venue, B gets none, C does not get A\u2019s', async () => {
    const { client, rows } = venuesTable()
    const a = await settleVenues(client, [A], { source: 'meetup' })
    const aId = getVenueIdFromResults(a.results, A.name, A.address)
    expect(aId).toBe('created-1')
    expect(rows[0]).toMatchObject({ name: 'San Telmo', address: 'Bolívar 624' })

    const b = await settleVenues(client, [B], { source: 'meetup' })
    expect(getVenueIdFromResults(b.results, B.name)).toBeNull()

    const c = await settleVenues(client, [C], { source: 'meetup' })
    const cId = getVenueIdFromResults(c.results, C.name, C.address)
    expect(cId).not.toBeNull()
    expect(cId).not.toBe(aId)

    // A again reuses its own venue.
    expect(getVenueIdFromResults((await settleVenues(client, [A], { source: 'meetup' })).results, A.name, A.address)).toBe(aId)
  })

  it('one mixed batch: each event gets the result for its own location', async () => {
    const { client, rows } = venuesTable()
    const { results } = await settleVenues(client, [A, B, C], { source: 'meetup' })
    const aId = getVenueIdFromResults(results, A.name, A.address)
    const cId = getVenueIdFromResults(results, C.name, C.address)
    expect(aId).not.toBeNull()
    expect(getVenueIdFromResults(results, B.name)).toBeNull()
    expect(getVenueIdFromResults(results, B.name, null)).toBeNull()
    expect(cId).not.toBeNull()
    expect(cId).not.toBe(aId)
    expect(rows.map((row) => row.address).sort()).toEqual(['Bolívar 624', 'Defensa 1200'])
  }, 10_000)

  it('keys every venue name by name plus street and number', () => {
    expect(venueSettlementKey('Teatro Sintético', 'Av. Ficticia 1234')).toBe(venueSettlementKey('Teatro Sintético', 'Ficticia 1234, CABA'))
    expect(venueSettlementKey('Teatro Sintético', 'Calle Norte 100')).not.toBe(venueSettlementKey('Teatro Sintético', 'Calle Sur 200'))
    expect(venueSettlementKey('San Telmo', 'Bolívar 624')).not.toBe(venueSettlementKey('San Telmo', 'Defensa 1200'))
    expect(venueSettlementKey('San Telmo', 'Bolívar 624')).toBe(venueSettlementKey('San Telmo', 'Bolivar 624, CABA'))
  })
})

describe('settleVenue with duplicate and lookalike catalog names', () => {
  it('matches a stored name with doubled or non-breaking spaces and a city suffix', async () => {
    const { client } = venuesTable([{ id: 'sala', name: 'Sala\u00a0Sintética  - Buenos Aires', address: 'Av. Ficticia 1234', neighborhood: 'Almagro' }])
    expect(await settleVenue(client, { name: 'SALA SINTETICA' }, { source: 'meetup' })).toMatchObject({ venueId: 'sala', action: 'matched', method: 'exact' })
  })

  it('reuses the copy at the event\u2019s own street and number, else the merge keeper', async () => {
    const { client } = venuesTable([
      { id: 'sala-bare', name: 'Sala Sintética', address: null, events: 9 },
      { id: 'sala-norte', name: 'Sala Sintética', address: 'Calle Norte 100', neighborhood: 'Palermo', events: 1 },
      { id: 'sala-sur', name: 'Sala  Sintética', address: 'Calle Sur 200', neighborhood: 'Boedo', events: 2 },
    ])
    expect(await settleVenue(client, { name: 'Sala Sintética', address: 'Calle Norte 100, CABA' }, { source: 'luma' })).toMatchObject({ venueId: 'sala-norte' })
    expect(await settleVenue(client, { name: 'Sala Sintética', address: 'Av. Sur N° 200' }, { source: 'luma' })).toMatchObject({ venueId: 'sala-sur' })
    expect(await settleVenue(client, { name: 'Sala Sintética' }, { source: 'luma' })).toMatchObject({ venueId: 'sala-sur' })
  })

  it('never attaches an event to a same-name venue at another street and number', async () => {
    const { client, rows } = venuesTable([
      { id: 'sala-norte', name: 'Sala Sintética', address: 'Calle Norte 100', neighborhood: 'Palermo' },
      { id: 'sala-sur', name: 'Sala Sintética', address: 'Calle Sur 200', neighborhood: 'Boedo', events: 5 },
    ], { 'Sala Sintética': { name: 'Sala Sintética', similarity: 1 } })
    const result = await settleVenue(client, { name: 'Sala Sintética', address: 'Calle Oeste 300', neighborhood: 'Flores' }, { source: 'luma' })
    expect(result).toMatchObject({ venueId: 'created-1', action: 'auto-created' })
    expect(rows.at(-1)).toMatchObject({ name: 'Sala Sintética', address: 'Calle Oeste 300' })
  })

  it('gives each event in one batch the same-name venue at its own address, in any order', async () => {
    const seed = [
      { id: 'iglesia-a', name: 'Iglesia Sintética', address: 'Calle Norte 100', neighborhood: 'Palermo' },
      { id: 'iglesia-b', name: 'Iglesia  Sintética', address: 'Calle Sur 200', neighborhood: 'Boedo' },
    ]
    const A = { name: 'Iglesia Sintética', address: 'Calle Norte 100' }
    const B = { name: 'Iglesia Sintética', address: 'Av. Sur N° 200, CABA' }
    for (const batch of [[A, B], [B, A]]) {
      const { results } = await settleVenues(venuesTable(seed).client, batch, { source: 'meetup' })
      expect(getVenueIdFromResults(results, A.name, A.address)).toBe('iglesia-a')
      expect(getVenueIdFromResults(results, B.name, B.address)).toBe('iglesia-b')
    }
  })

  it('creates the venue and queues a low-score lookalike for review instead of attaching it', async () => {
    const { client, rows, queued } = venuesTable([{ id: 'cc', name: 'Centro Sintético', address: 'Calle Norte 100' }],
      { 'Centro Sintético Raíz': { name: 'Centro Sintético', similarity: 0.68 } })
    const result = await settleVenue(client, { name: 'Centro Sintético Raíz', neighborhood: 'Palermo' }, { source: 'meetup' })
    expect(result).toMatchObject({ venueId: 'created-1', action: 'queued-review' })
    expect(rows).toHaveLength(2)
    expect(queued).toEqual([expect.objectContaining({ best_match_venue_id: 'cc', match_confidence: 0.68 })])
  })

  it('auto-uses a close fuzzy match, but not one at another street and number', async () => {
    const seed = [{ id: 'agujero', name: 'El Agujero Sintético', address: 'Calle Norte 100' }]
    const similar = { 'Agujero Sintético': { name: 'El Agujero Sintético', similarity: 0.9 } }
    expect(await settleVenue(venuesTable(seed, similar).client, { name: 'Agujero Sintético', address: 'Calle Norte 100' }, { source: 'luma' }))
      .toMatchObject({ venueId: 'agujero', action: 'matched', method: 'fuzzy' })
    expect(await settleVenue(venuesTable(seed, similar).client, { name: 'Agujero Sintético', address: 'Calle Sur 200', neighborhood: 'Boedo' }, { source: 'luma' }))
      .toMatchObject({ venueId: 'created-1', action: 'auto-created' })
  })

  it('leaves the event unlinked when the venue lookup fails, rather than creating a duplicate', async () => {
    const { client, rows } = venuesTable([{ id: 'sala', name: 'Sala Sintética', address: null }])
    client.venuesNamed = async () => { throw new Error('database unavailable') }
    expect(await settleVenue(client, { name: 'Sala Sintética' }, { source: 'luma' })).toMatchObject({ venueId: null, action: 'skipped' })
    expect(rows).toHaveLength(1)
  })
})
