import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { areaOnlyVenueName, settleVenue } from './venue-settlement.ts'

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

describe('settleVenue with an area-only name', () => {
  /** Venue lookups find `exact` by name (or nothing); creation is recorded. */
  function db(exact: { id: string; name: string; address: string | null; neighborhood: string | null } | null) {
    const created: unknown[] = []
    const builder: Record<string, unknown> = {}
    for (const method of ['select', 'ilike', 'eq', 'limit']) builder[method] = () => builder
    builder.single = async () => ({ data: exact, error: exact ? null : { message: 'none' } })
    builder.insert = (row: unknown) => { created.push(row); return { select: () => ({ single: async () => ({ data: { id: 'created', ...(row as object) }, error: null }) }) } }
    const client = { from: () => builder, rpc: async () => ({ data: [], error: null }) }
    return { client: client as unknown as SupabaseClient, created }
  }

  it('never matches or creates a city-only name', async () => {
    const { client, created } = db({ id: 'fake', name: 'Buenos Aires, Argentina', address: 'Av. Ficticia 1234', neighborhood: null })
    expect(await settleVenue(client, { name: 'Buenos Aires, Argentina', address: 'Av. Ficticia 1234' }, { source: 'luma' })).toMatchObject({ venueId: null, action: 'skipped' })
    expect(created).toHaveLength(0)
  })

  it('skips a lone barrio with no address, coordinates, or addressed venue of that name', async () => {
    const { client, created } = db({ id: 'old', name: 'Caballito', address: null, neighborhood: 'Caballito' })
    expect(await settleVenue(client, { name: 'Caballito' }, { source: 'meetup' })).toMatchObject({ venueId: null, action: 'skipped' })
    expect(created).toHaveLength(0)
  })

  it('reuses an existing venue of exactly that name when it has a street address', async () => {
    const { client } = db({ id: 'la-boca-bar', name: 'La Boca', address: 'Av. Ficticia 1234', neighborhood: 'La Boca' })
    expect(await settleVenue(client, { name: 'La Boca' }, { source: 'meetup' })).toMatchObject({ venueId: 'la-boca-bar', action: 'matched' })
  })
})
