import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { areaOnlyVenueName, getVenueIdFromResults, settleVenue, settleVenues, venueSettlementKey } from './venue-settlement.ts'

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

/** In-memory `venues` table for the queries settlement makes: name lookups (exact and same-name lists) and inserts. */
function venuesTable(seed: Array<{ id: string; name: string; address: string | null; neighborhood?: string | null }> = []) {
  const rows = seed.map((row) => ({ neighborhood: null, ...row }))
  let created = 0
  const client = {
    from: () => {
      let name: string | null = null
      const matches = () => rows.filter((row) => name !== null && row.name.toLowerCase() === name.toLowerCase())
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        limit: () => builder,
        ilike: (_: string, value: string) => { name = value; return builder },
        single: async () => matches()[0] ? { data: matches()[0], error: null } : { data: null, error: { message: 'none' } },
        then: (resolve: (value: unknown) => void) => resolve({ data: matches(), error: null }),
        insert: (row: { name: string; address: string | null; neighborhood: string | null }) => ({ select: () => ({ single: async () => {
          const venue = { id: `created-${++created}`, name: row.name, address: row.address, neighborhood: row.neighborhood }
          rows.push(venue)
          return { data: venue, error: null }
        } }) }),
      }
      return builder
    },
    rpc: async () => ({ data: [], error: null }),
  }
  return { client: client as unknown as SupabaseClient, rows }
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

  it('keeps keying ordinary venue names by name', () => {
    expect(venueSettlementKey('Teatro Sintético', 'Av. Ficticia 1234')).toBe(venueSettlementKey('Teatro Sintético', null))
    expect(venueSettlementKey('San Telmo', 'Bolívar 624')).not.toBe(venueSettlementKey('San Telmo', 'Defensa 1200'))
    expect(venueSettlementKey('San Telmo', 'Bolívar 624')).toBe(venueSettlementKey('San Telmo', 'Bolivar 624, CABA'))
  })
})
