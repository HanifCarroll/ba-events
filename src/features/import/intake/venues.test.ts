import { afterEach, describe, expect, it, vi } from 'vitest'
import { Effect } from 'effect'
import type { IntakeStore, VenueRow } from './store.ts'
import { ImportOperationError } from '../core/effect-utils.ts'
import type { NominatimResult } from '../core/nominatim.ts'
import { decodeVenueRequest, type Geocode, groupHeldByVenue, resolveIntakeVenueEffect, type VenueRequest } from './venues.ts'
import { addressKey } from './venue-address.ts'

function fakeDb(venues: VenueRow[], options: { similar?: Record<string, number>; failReads?: boolean } = {}) {
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = []
  const outage = () => Effect.fail(new ImportOperationError({ operation: 'venue-test', message: 'database unavailable' }))
  const db = {
    allVenues: () => options.failReads ? outage() : Effect.succeed(venues.map(row => ({ ...row }))),
    similarVenues: (name, threshold) => options.failReads ? outage() : Effect.succeed(venues.map(row => ({ ...row,
      similarity: row.name.toLowerCase() === name.toLowerCase() ? 1 : options.similar?.[row.id] ?? 0,
    })).filter(row => row.similarity >= threshold).sort((a, b) => b.similarity - a.similarity)),
    completeVenue: (id, fill) => Effect.sync(() => {
      const row = venues.find(row => row.id === id)
      if (!row || Object.keys(fill).some(key => row[key as keyof typeof fill] !== null)) return []
      return [Object.assign(row, fill)]
    }),
    correctVenueNeighborhood: (id, from, to) => Effect.sync(() => {
      const row = venues.find(row => row.id === id && row.neighborhood === from)
      return row ? [Object.assign(row, { neighborhood: to })] : []
    }),
    venueRow: id => Effect.sync(() => venues.find(row => row.id === id)!),
    createVenue: input => Effect.sync(() => {
      inserts.push({ table: 'venues', row: input })
      const row = { id: `venue-${venues.length + 1}`, address: null, neighborhood: null, ...input }
      venues.push(row)
      return row
    }),
    recordVenueEvidence: row => Effect.sync(() => { inserts.push({ table: 'venue_review_queue', row }) }),
  } satisfies Partial<IntakeStore>
  return { db: db as unknown as IntakeStore, inserts, venues }
}
// By default the synthetic geocoder finds the request's own street and number (Av. Ficticia 1234).
const geocoded = (state: string, suburb?: string, road = 'Avenida Ficticia', house_number = '1234', neighbourhood?: string) => () => Effect.succeed({
  lat: '0', lon: '0', display_name: 'synthetic', address: { road, house_number: house_number || undefined, state, suburb, neighbourhood, country_code: 'ar' } } as NominatimResult)
const request = (overrides: Partial<VenueRequest> = {}): VenueRequest => decodeVenueRequest({
  name: 'Sala Sintética', address: 'Av. Ficticia 1234, CABA', neighborhood: 'Almagro',
  evidence: [{ url: 'https://example.org/sala', confirms: 'name, address and barrio on the official site' }], ...overrides })
const run = (db: IntakeStore, input: VenueRequest, geocode: Geocode = geocoded('Ciudad Autónoma de Buenos Aires', 'Almagro')) =>
  Effect.runPromise(resolveIntakeVenueEffect(db, input, { geocode }))

describe('intake venue resolution', () => {
  afterEach(() => { vi.unstubAllGlobals() })
  it('normalizes street prefixes and suffixes into one address key', () => {
    expect(addressKey('Av. Ficticia 1234, CABA')).toBe('avenida ficticia 1234')
    expect(addressKey('Avenida Ficticia 1234')).toBe('avenida ficticia 1234')
    expect(addressKey('Ficticia sin número')).toBeNull()
    expect(addressKey('3 de Febrero 1378')).toBe('3 de febrero 1378')
    expect(addressKey('Av. 9 de Julio 1000')).toBe('avenida 9 de julio 1000')
    for (const street of ['3 de Febrero', 'Av. 9 de Julio', '25 de Mayo, CABA', '1378', 'Av. 9 de Julio - CABA']) expect(addressKey(street)).toBeNull()
    for (const variant of ['Av. Corrientes 1530 - CABA', 'Av. Corrientes N° 1530', 'Avenida Corrientes Nº 1530, C.A.B.A.',
      'Av. Corrientes nro. 1530, C1043AAB', 'Avda. Corrientes n. 1530, Ciudad de Buenos Aires', 'AV. CORRIENTES 1530 Buenos Aires, Argentina',
      'Av. Corrientes 1530, Ciudad Autónoma de Buenos Aires', '1530 Avenida Corrientes, San Nicolás, CABA, C1042',
      '1530 Av. Corrientes, Buenos Aires, Cdad. Autónoma de Buenos Aires, C1071']) expect(addressKey(variant)).toBe('avenida corrientes 1530')
    expect(addressKey('Corrientes 1530')).toBe('corrientes 1530')
    expect(addressKey('Pje. 3 de Febrero Nº 1378 - CABA')).toBe('3 de febrero 1378')
    expect(addressKey('Av. Corrientes 1530 piso 2')).toBe('avenida corrientes 1530')
    expect(addressKey('Av.Sarmiento 2715')).not.toBe(addressKey('Sarmiento 2715'))
    for (const spelling of ['Av.Sarmiento 2715', 'Avenida Presidente Sarmiento 2715']) {
      expect(addressKey('Av. Sarmiento 2715')).toBe(addressKey(spelling))
    }
    expect(addressKey('Av. Roque Sáenz Peña 943')).toBe(addressKey('Diagonal Norte 943'))
  })
  it('rejects a name that is only a city or postal code', async () => {
    const { db, inserts } = fakeDb([])
    for (const name of ['Buenos Aires, Argentina', 'C1437EFA, Argentina', 'CABA']) expect(await run(db, request({ name }))).toMatchObject({ outcome: 'rejected' })
    expect(inserts).toHaveLength(0)
  })
  it('creates a clean venue when the source name ends with a delimiter', async () => {
    const { db, venues } = fakeDb([])
    expect(await run(db, request({ name: 'Sala Norte-Sur —' }))).toMatchObject({ outcome: 'created' })
    expect(venues[0].name).toBe('Sala Norte-Sur')
  })
  it('accepts a park or business named like a barrio, since its address has a house number', async () => {
    for (const name of ['Parque Chacabuco', 'La Boca']) {
      const { db } = fakeDb([])
      expect(await run(db, request({ name })), name).toMatchObject({ outcome: 'created' })
    }
  })
  it('rejects a street whose only number is part of its name', async () => {
    const { db, inserts } = fakeDb([])
    expect(await run(db, request({ address: '3 de Febrero' }))).toMatchObject({ outcome: 'rejected', reasons: [expect.stringContaining('house number')] })
    expect(await run(db, request({ address: 'Av. 9 de Julio' }))).toMatchObject({ outcome: 'rejected' })
    expect(inserts).toHaveLength(0)
    expect(await run(db, request({ address: '3 de Febrero 1378' }), geocoded('Ciudad Autónoma de Buenos Aires', 'Almagro', '3 de Febrero', '1378')))
      .toMatchObject({ outcome: 'created' })
  })
  it('requires evidence with public HTTPS URLs and rejects unknown fields', () => {
    expect(() => request({ evidence: [] })).toThrow()
    expect(() => request({ evidence: [{ url: 'http://example.org', confirms: 'name' }] })).toThrow('HTTPS')
    expect(() => decodeVenueRequest({ ...request(), extra: true })).toThrow()
  })
  it('creates a venue once, records its evidence, and returns the same venue on a repeat', async () => {
    const { db, inserts } = fakeDb([])
    const first = await run(db, request())
    expect(first).toMatchObject({ outcome: 'created', venue: { name: 'Sala Sintética', neighborhood: 'Almagro', address: 'Av. Ficticia 1234, CABA' } })
    const log = inserts.find(item => item.table === 'venue_review_queue')!.row
    expect(log).toMatchObject({ source: 'instagram-intake', status: 'approved', final_venue_id: first.outcome === 'created' && first.venue.id })
    expect(JSON.parse(log.notes as string).evidence[0].url).toBe('https://example.org/sala')
    const second = await run(db, request())
    expect(second).toMatchObject({ outcome: 'existing', venue: { id: first.outcome === 'created' && first.venue.id } })
    expect(inserts.filter(item => item.table === 'venues')).toHaveLength(1)
  })
  it('reuses one venue whose name differs only by accents, case and spacing', async () => {
    const { db, inserts } = fakeDb([{ id: 'v1', name: 'SALA  sintetica', address: 'Avenida Ficticia 1234', neighborhood: 'Almagro' }])
    expect(await run(db, request())).toMatchObject({ outcome: 'existing', venue: { id: 'v1' } })
    expect(inserts).toHaveLength(0)
  })
  it('never reuses a different room or branch, even with a high similarity score', async () => {
    const room = fakeDb([{ id: 'r2', name: 'Sala Sintética 2', address: 'Ficticia 1234', neighborhood: 'Almagro' }], { similar: { r2: 0.9 } })
    expect(await run(room.db, request({ name: 'Sala Sintética 1' }))).toMatchObject({ outcome: 'ambiguous', candidates: [{ id: 'r2' }] })
    const branch = fakeDb([{ id: 'b1', name: 'Humboldt | Niceto Club', address: null, neighborhood: null }])
    expect(await run(branch.db, request({ name: 'Niceto Club' }))).toMatchObject({ outcome: 'ambiguous', candidates: [{ id: 'b1', why: 'possible alias' }] })
    expect([...room.inserts, ...branch.inserts]).toHaveLength(0)
  })
  it('fills an existing venue\'s empty address and barrio instead of creating a duplicate', async () => {
    const { db, inserts, venues } = fakeDb([{ id: 'v1', name: 'Sala Sintética', address: null, neighborhood: null }])
    expect(await run(db, request())).toMatchObject({ outcome: 'existing', venue: { id: 'v1', address: 'Av. Ficticia 1234, CABA', neighborhood: 'Almagro' }, completed: ['address', 'neighborhood'] })
    expect(inserts.map(item => item.table)).toEqual(['venue_review_queue'])
    expect(await run(db, request())).toMatchObject({ outcome: 'existing', venue: { id: 'v1' } })
    expect(inserts).toHaveLength(1)
    expect(venues).toHaveLength(1)
  })
  it('holds when several venues share the name', async () => {
    const { db, inserts } = fakeDb([
      { id: 'a1', name: 'Sala Sintética', address: null, neighborhood: 'Almagro' },
      { id: 'a2', name: 'SALA SINTÉTICA', address: 'Ficticia 1234', neighborhood: 'Almagro' }])
    expect(await run(db, request())).toMatchObject({ outcome: 'ambiguous', candidates: [{ id: 'a1' }, { id: 'a2' }] })
    expect(inserts).toHaveLength(0)
  })
  describe('distinct_from', () => {
    const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`
    const museum = { name: 'Museo Sintético Saavedra', address: 'Av. Ficticia 1234', neighborhood: 'Saavedra' }
    const why = 'Different place: a plaza in another barrio, per its official site'
    it('creates the venue when every lookalike is listed with a reason, and keeps the reasons', async () => {
      const { db, inserts } = fakeDb([{ id: id(1), name: 'Saavedra', address: null, neighborhood: null },
        { id: id(2), name: 'Teatro Sintetico', address: 'Otra 10', neighborhood: 'Boedo' }], { similar: { [id(2)]: 0.7 } })
      const input = request({ ...museum, name: 'Museo Sintético Saavedra Teatro', distinct_from: [{ venue_id: id(1), reason: why }, { venue_id: id(2), reason: why }] })
      expect(await run(db, input, geocoded('Ciudad Autónoma de Buenos Aires', 'Saavedra'))).toMatchObject({ outcome: 'created', distinct_from: [{ venue_id: id(1) }, { venue_id: id(2) }] })
      expect(JSON.parse(inserts.find(item => item.table === 'venue_review_queue')!.row.notes as string).distinct_from).toHaveLength(2)
      // Repeating the request finds the venue it created instead of creating another.
      expect(await run(db, input, geocoded('Ciudad Autónoma de Buenos Aires', 'Saavedra'))).toMatchObject({ outcome: 'existing' })
    })
    it('checks every lookalike, not just the top five', async () => {
      const lookalikes = Array.from({ length: 7 }, (_, n) => ({ id: id(n + 1), name: `Museo Sintético Saavedra ${'x'.repeat(n + 1)}`, address: null, neighborhood: null }))
      const scores = Object.fromEntries(lookalikes.map((venue, n) => [venue.id, 0.84 - n * 0.02]))
      const sixListed = fakeDb(structuredClone(lookalikes), { similar: scores })
      const listed = (count: number) => lookalikes.slice(0, count).map(venue => ({ venue_id: venue.id, reason: why }))
      expect(await run(sixListed.db, request({ ...museum, distinct_from: listed(6) }))).toMatchObject({ outcome: 'ambiguous' })
      expect(sixListed.inserts).toHaveLength(0)
      expect(await run(fakeDb(structuredClone(lookalikes), { similar: scores }).db, request({ ...museum, distinct_from: listed(7) }),
        geocoded('Ciudad Autónoma de Buenos Aires', 'Saavedra'))).toMatchObject({ outcome: 'created' })
    })
    it('stays ambiguous for an unlisted candidate, an empty reason, the same name, or the same street and number', async () => {
      const alias = () => fakeDb([{ id: id(1), name: 'Saavedra', address: null, neighborhood: null },
        { id: id(2), name: 'Saavedra Club', address: null, neighborhood: null }])
      expect(await run(alias().db, request({ ...museum, distinct_from: [{ venue_id: id(1), reason: why }] }))).toMatchObject({ outcome: 'ambiguous' })
      expect(() => request({ ...museum, distinct_from: [{ venue_id: id(1), reason: '' }] })).toThrow()
      expect(await run(alias().db, request({ ...museum, distinct_from: [{ venue_id: id(1), reason: why }, { venue_id: id(2), reason: '          ' }] }))).toMatchObject({ outcome: 'ambiguous' })
      const sameName = fakeDb([{ id: id(3), name: 'MUSEO SINTETICO  SAAVEDRA', address: 'Lejana 99', neighborhood: 'Boedo' }])
      expect(await run(sameName.db, request({ ...museum, distinct_from: [{ venue_id: id(3), reason: why }] }))).toMatchObject({ outcome: 'ambiguous' })
      // Also similar by name, but at the same street and number: never overridable.
      const sameAddress = fakeDb([{ id: id(4), name: 'Saavedra', address: 'Av. Ficticia 1234', neighborhood: 'Saavedra' }])
      expect(await run(sameAddress.db, request({ ...museum, distinct_from: [{ venue_id: id(4), reason: why }] }))).toMatchObject({ outcome: 'ambiguous' })
      for (const variant of ['Av. Corrientes 1530 - CABA', 'Av. Corrientes N° 1530', 'Av. Corrientes nro. 1530, C1043AAB', 'Avenida Corrientes Nº 1530, C.A.B.A.', '1530 Avenida Corrientes, CABA, C1042']) {
        const messy = fakeDb([{ id: id(7), name: 'Saavedra', address: variant, neighborhood: null }])
        expect(await run(messy.db, request({ ...museum, address: 'Av. Corrientes 1530', distinct_from: [{ venue_id: id(7), reason: why }] })))
          .toMatchObject({ outcome: 'ambiguous', candidates: [{ id: id(7) }] })
        expect(messy.inserts).toHaveLength(0)
      }
      const twins = fakeDb([{ id: id(5), name: 'Museo Sintético Saavedra', address: null, neighborhood: null }, { id: id(6), name: 'museo sintetico saavedra', address: null, neighborhood: null }])
      expect(await run(twins.db, request({ ...museum, distinct_from: [{ venue_id: id(5), reason: why }, { venue_id: id(6), reason: why }] }))).toMatchObject({ outcome: 'ambiguous' })
      expect([...sameName.inserts, ...sameAddress.inserts, ...twins.inserts]).toHaveLength(0)
    })
  })
  it('holds a same-name venue whose barrio conflicts instead of giving it an address elsewhere', async () => {
    const stated = fakeDb([{ id: 'v1', name: 'Sala Sintética', address: null, neighborhood: 'Boedo' }])
    expect(await run(stated.db, request())).toMatchObject({ outcome: 'ambiguous', candidates: [{ id: 'v1', why: 'same name, different barrio' }] })
    const derived = fakeDb([{ id: 'v1', name: 'Sala Sintética', address: null, neighborhood: 'Boedo' }])
    expect(await run(derived.db, request({ neighborhood: null }))).toMatchObject({ outcome: 'ambiguous', candidates: [{ id: 'v1' }] })
    expect([...stated.inserts, ...derived.inserts]).toHaveLength(0)
    expect(stated.venues[0].address).toBeNull()
  })
  it('corrects a stored barrio at the same street and number when the geocoder confirms the new one, and records the old value', async () => {
    const cambalache = () => fakeDb([{ id: 'cs', name: 'Club Social Sintético', address: 'Defensa 1179', neighborhood: 'Almagro' }])
    const sanTelmo = geocoded('Ciudad Autónoma de Buenos Aires', 'San Telmo', 'Defensa', '1179')
    const ask = (overrides: Partial<VenueRequest> = {}) => request({ name: 'Club Social Sintético', address: 'Defensa 1179, CABA', neighborhood: 'San Telmo', ...overrides })
    const fixed = cambalache()
    expect(await run(fixed.db, ask(), sanTelmo)).toMatchObject({ outcome: 'existing', match: 'same name and address',
      venue: { id: 'cs', neighborhood: 'San Telmo' }, corrected: { neighborhood: { from: 'Almagro', to: 'San Telmo' } } })
    expect(fixed.inserts).toEqual([expect.objectContaining({ table: 'venue_review_queue',
      row: expect.objectContaining({ notes: expect.stringContaining('corrected neighborhood from Almagro to San Telmo') }) })])
    // A rerun finds the corrected venue as it is.
    expect(await run(fixed.db, ask(), sanTelmo)).toMatchObject({ outcome: 'existing', match: 'same name' })

    // The geocoder disagrees, can't confirm the number, or is down: nothing changes.
    const cases = [[geocoded('Ciudad Autónoma de Buenos Aires', 'Monserrat', 'Defensa', '1179'), 'ambiguous'],
      [geocoded('Ciudad Autónoma de Buenos Aires', 'San Telmo', 'Defensa', ''), 'rejected'], [() => Effect.fail('timeout'), 'rejected']] as const
    for (const [geocode, outcome] of cases) {
      const held = cambalache()
      expect(await run(held.db, ask(), geocode)).toMatchObject({ outcome })
      expect(held.venues[0].neighborhood).toBe('Almagro')
      expect(held.inserts).toHaveLength(0)
    }
    // Only an official barrio in `suburb` confirms: an Abasto neighbourhood (aliased to Balvanera elsewhere) never corrects Almagro.
    const abasto = fakeDb([{ id: 'ab', name: 'Sala Abasto', address: 'Avenida Corrientes 3200', neighborhood: 'Almagro' }])
    const abastoGeocode = () => Effect.succeed({ lat: '0', lon: '0', display_name: 'synthetic', address: { road: 'Avenida Corrientes', house_number: '3200',
      neighbourhood: 'Abasto', suburb: 'Almagro', state: 'Ciudad Autónoma de Buenos Aires', country_code: 'ar' } } as NominatimResult)
    expect(await run(abasto.db, request({ name: 'Sala Abasto', address: 'Av. Corrientes 3200', neighborhood: 'Balvanera' }), abastoGeocode))
      .toMatchObject({ outcome: 'ambiguous', reasons: [expect.stringMatching(/Nominatim.*Almagro.*Balvanera/)] })
    expect(abasto.venues[0].neighborhood).toBe('Almagro')
    expect(abasto.inserts).toHaveLength(0)
    // A different number keeps today's behavior.
    const elsewhere = cambalache()
    expect(await run(elsewhere.db, ask({ address: 'Defensa 1200' }), geocoded('Ciudad Autónoma de Buenos Aires', 'San Telmo', 'Defensa', '1200')))
      .toMatchObject({ outcome: 'ambiguous', candidates: [{ id: 'cs', why: 'same name, different address' }] })
    expect(elsewhere.venues[0].neighborhood).toBe('Almagro')
  })
  it('flags Biri Biri against BIRIBIRI CLUB SOCIAL as a possible alias instead of creating a duplicate', async () => {
    const { db, inserts } = fakeDb([{ id: 'bb', name: 'BIRIBIRI CLUB SOCIAL', address: 'Malabia 1171', neighborhood: null }])
    expect(await run(db, request({ name: 'Biri Biri', address: 'Malabia 1175', neighborhood: 'Villa Crespo' }))).toMatchObject({
      outcome: 'ambiguous', candidates: [{ id: 'bb', why: 'possible alias' }] })
    expect(inserts).toHaveLength(0)
  })
  it('does not fill an existing venue from an address outside the city', async () => {
    const { db, venues } = fakeDb([{ id: 'v1', name: 'Sala Sintética', address: null, neighborhood: null }])
    expect(await run(db, request(), geocoded('Buenos Aires', 'Olivos'))).toMatchObject({ outcome: 'rejected' })
    expect(venues[0].address).toBeNull()
  })
  it('holds review-band names, same name elsewhere, and other venues at the same address', async () => {
    const band = fakeDb([{ id: 'v1', name: 'Sala Sint', address: null, neighborhood: 'Almagro' }], { similar: { v1: 0.7 } })
    expect(await run(band.db, request())).toMatchObject({ outcome: 'ambiguous', candidates: [{ id: 'v1' }] })
    const moved = fakeDb([{ id: 'v2', name: 'Sala Sintética', address: 'Otra Calle 99', neighborhood: 'Boedo' }])
    expect(await run(moved.db, request())).toMatchObject({ outcome: 'ambiguous', candidates: [{ id: 'v2', why: 'same name, different address' }] })
    const shared = fakeDb([{ id: 'v3', name: 'Centro Cultural Ficticio', address: 'Avenida Ficticia 1234', neighborhood: 'Almagro' }])
    expect(await run(shared.db, request())).toMatchObject({ outcome: 'ambiguous', candidates: [{ id: 'v3', why: 'same address' }] })
    expect([...band.inserts, ...moved.inserts, ...shared.inserts]).toHaveLength(0)
  })
  it.each([
    ['Corrientes 3781', 'Av. Corrientes 3781'],
    ['Av. Corrientes 3781', 'Corrientes 3781'],
    ['Rivadavia Av. 4732', 'Rivadavia 4732'],
    ['Rivadavia 4732', 'Rivadavia Av. 4732'],
    ['Av. Roque Sáenz Peña 943', 'Roque Sáenz Peña 943'],
    ['Av. Roque Sáenz Peña 943', 'Diagonal Norte 943'],
  ])('holds a different name at %s when the catalog has %s', async (address, stored) => {
    const id = '00000000-0000-4000-8000-000000000001'
    const { db, inserts } = fakeDb([{ id, name: 'Centro Cultural Ficticio', address: stored, neighborhood: 'Almagro' }])
    const [road, height] = address.split(/ (?=\d+$)/)
    const geocode = geocoded('Ciudad Autónoma de Buenos Aires', 'Almagro', road, height)
    expect(await run(db, request({ address, distinct_from: [{ venue_id: id, reason: 'The recorded name is different' }] }), geocode))
      .toMatchObject({ outcome: 'ambiguous', candidates: [{ id, why: 'same address' }] })
    expect(inserts).toHaveLength(0)
  })
  it.each(['Av. Sarmiento 2715', 'Sarmiento Av. 2715'])('does not flag %s and plain Sarmiento as the same catalog address', async address => {
    const { db } = fakeDb([{ id: 'v1', name: 'Centro Cultural Ficticio', address: 'Sarmiento 2715', neighborhood: 'Balvanera' }])
    expect(await run(db, request({ address, neighborhood: 'Palermo' }),
      geocoded('Ciudad Autónoma de Buenos Aires', 'Palermo', 'Avenida Presidente Sarmiento', '2715')))
      .toMatchObject({ outcome: 'created', venue: { neighborhood: 'Palermo' } })
  })
  it('rejects addresses outside the city and invalid barrios, and derives a missing barrio', async () => {
    const { db, inserts } = fakeDb([])
    expect(await run(db, request(), geocoded('Buenos Aires', 'Vicente López'))).toMatchObject({ outcome: 'rejected' })
    expect(await run(db, request({ neighborhood: 'Olivos' }))).toMatchObject({ outcome: 'rejected' })
    expect(await run(db, request({ neighborhood: 'Villa' }))).toMatchObject({ outcome: 'rejected' })
    expect(await run(db, request({ neighborhood: null }), () => Effect.succeed(null))).toMatchObject({ outcome: 'rejected' })
    expect(inserts).toHaveLength(0)
    expect(await run(db, request({ neighborhood: null }))).toMatchObject({ outcome: 'created', venue: { neighborhood: 'Almagro' } })
  })
  it('recovers a city address whose house number the plain search read as a province postcode', async () => {
    // Shaped like Nominatim's answers for "Godoy Cruz 1631": plain → the street in Pilar (postcode 1631), biased → Palermo.
    const pilar = { lat: '-34.45', lon: '-58.91', display_name: 'Godoy Cruz, Pilar, Buenos Aires, B1631, Argentina',
      address: { road: 'Godoy Cruz', town: 'Pilar', state: 'Buenos Aires', postcode: 'B1631', country_code: 'ar' }, extratags: null }
    const palermo = { lat: '-34.58', lon: '-58.43', display_name: '1631, Godoy Cruz, Palermo, Buenos Aires, Ciudad Autónoma de Buenos Aires, Argentina',
      address: { house_number: '1631', road: 'Godoy Cruz', suburb: 'Palermo', state: 'Ciudad Autónoma de Buenos Aires', country_code: 'ar' }, extratags: null }
    const fetch = vi.fn(async (url: string) => new Response(JSON.stringify([new URL(url).searchParams.has('viewbox') ? palermo : pilar]), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    const { db } = fakeDb([])
    // No geocode override: the command's default searchNominatimEffect makes both requests.
    expect(await Effect.runPromise(resolveIntakeVenueEffect(db, request({ name: 'Strummer Sintético', address: 'Godoy Cruz 1631', neighborhood: null }))))
      .toMatchObject({ outcome: 'created', venue: { neighborhood: 'Palermo' }, warnings: [] })
    expect(fetch.mock.calls.map(call => new URL(call[0]).searchParams.get('viewbox'))).toEqual([null, '-58.5315,-34.5265,-58.3350,-34.7056'])
  })
  describe('numbered CABA addresses and USIG fallback', () => {
    function providers(osm: NominatimResult['address'], normalized: unknown[] | (() => Response) = [], barrio = '') {
      const fetch = vi.fn(async (raw: string) => {
        const url = new URL(raw)
        if (url.hostname === 'nominatim.openstreetmap.org') return Response.json([{ lat: '0', lon: '0', display_name: 'synthetic', address: osm }])
        if (url.hostname === 'servicios.usig.buenosaires.gob.ar' && url.pathname === '/normalizar') {
          return typeof normalized === 'function' ? normalized() : Response.json({ direccionesNormalizadas: normalized })
        }
        if (url.hostname === 'ws.usig.buenosaires.gob.ar' && url.pathname === '/datos_utiles') return Response.json({ barrio })
        throw new Error(`Unexpected geocoder ${raw}`)
      })
      vi.stubGlobal('fetch', fetch)
      return () => fetch.mock.calls.map(([url]) => new URL(url))
    }
    const inCaba = { state: 'Ciudad Autónoma de Buenos Aires', country_code: 'ar' }
    const province = { state: 'Buenos Aires', country_code: 'ar' }
    const usig = (nombre_calle: string, altura: number, cod_partido = 'caba', cod_calle = 101) => ({ nombre_calle, altura, cod_partido, cod_calle })
    const resolve = (address: string, neighborhood: VenueRequest['neighborhood'] = null, confirms?: string) => {
      const { db, inserts } = fakeDb([])
      const evidence = confirms ? [{ url: 'https://example.org/sala', confirms }] : undefined
      return { result: Effect.runPromise(resolveIntakeVenueEffect(db, request({ address, neighborhood, ...(evidence && { evidence }) }))), inserts }
    }
    const brandsen = { ...province, road: 'Avenida Roque Sáenz Peña', house_number: '943', town: 'Brandsen' }
    const diagonal = 'SAENZ PEÑA, ROQUE, PRES. DIAGONAL NORTE AV.'
    const otherRoad = { ...province, road: 'Avenida 58', house_number: '2715' }

    it('holds the exact Brandsen namesake without CABA in the address or evidence', async () => {
      const urls = providers(brandsen, [usig(diagonal, 943)], 'San Nicolas')
      const { result, inserts } = resolve('Av. Roque Sáenz Peña 943', 'San Nicolás')
      expect(await result).toMatchObject({ outcome: 'ambiguous', reasons: [expect.stringContaining('Brandsen')] })
      expect(inserts).toHaveLength(0)
      expect(urls().map(url => url.pathname)).toEqual(['/search'])
    })

    it.each([
      ['Av. Belgrano 1234', 'Avenida Belgrano', 'La web confirma Av. Belgrano 1234'],
      ['Belgrano 1234', 'Belgrano', 'La sala queda en Belgrano 1234'],
      ['Palermo 1234', 'Palermo', 'El sitio da la dirección Palermo n.º 1234'],
    ])('does not use street words from %s as evidence of the city', async (address, road, confirms) => {
      const urls = providers({ ...province, road, house_number: '1234', town: 'Brandsen' }, [usig(road, 1234)], 'Monserrat')
      const { result, inserts } = resolve(address, null, confirms)
      expect(await result).toMatchObject({ outcome: 'ambiguous', reasons: [expect.stringContaining('Brandsen')] })
      expect(inserts).toHaveLength(0)
      expect(urls().map(url => url.pathname)).toEqual(['/search'])
    })

    it.each([
      ['Av. Roque Sáenz Peña 943, CABA', undefined],
      ['Av. Roque Sáenz Peña 943, Capital Federal', undefined],
      ['Av. Roque Sáenz Peña 943, Ciudad de Buenos Aires', undefined],
      ['Av. Roque Sáenz Peña 943, San Nicolás', undefined],
      ['Av. Roque Sáenz Peña 943', 'Sala en el barrio de San Nicolás'],
      ['Av. Roque Sáenz Peña 943', 'Sala en San Nicolás, CABA'],
      ['Av. Roque Sáenz Peña 943', 'Av. Roque Sáenz Peña 943, San Nicolás, C.A.B.A.'],
      ['Av. Roque Sáenz Peña 943', 'La sala queda en la Ciudad Autónoma de Buenos Aires'],
    ] as const)('can confirm %s when the address or evidence identifies the city', async (address, evidence) => {
      const urls = providers(brandsen, [usig(diagonal, 943)], 'San Nicolas')
      expect(await resolve(address, null, evidence).result).toMatchObject({ outcome: 'created', venue: { address, neighborhood: 'San Nicolás' } })
      expect(urls()[1].searchParams.get('direccion')).toBe('Av. Roque Sáenz Peña 943, CABA')
    })

    it('does not replace an explicit Provincia locality even if other evidence says CABA', async () => {
      const urls = providers(brandsen, [usig(diagonal, 943)], 'San Nicolas')
      const { result, inserts } = resolve('Av. Roque Sáenz Peña 943, Brandsen', null, 'Sala en CABA')
      expect(await result).toMatchObject({ outcome: 'ambiguous', reasons: [expect.stringContaining('Brandsen')] })
      expect(inserts).toHaveLength(0)
      expect(urls().map(url => url.pathname)).toEqual(['/search'])
    })

    it('does not confirm an avenue with a same-named plain street', async () => {
      const urls = providers({ ...inCaba, road: 'Maipú', house_number: '1200', suburb: 'Retiro' }, [usig('MAIPU', 1200)], 'Retiro')
      const { result, inserts } = resolve('Av. Maipú 1200', 'Retiro')
      expect(await result).toMatchObject({ outcome: 'rejected' })
      expect(inserts).toHaveLength(0)
      expect(urls().map(url => url.pathname)).toEqual(['/search', '/search', '/normalizar'])
    })

    it('holds when USIG returns multiple distinct CABA street codes for the same key', async () => {
      const urls = providers(otherRoad, [usig('SARMIENTO AV.', 2715), usig('SARMIENTO AV.', 2715, 'caba', 102)], 'Palermo')
      const { result, inserts } = resolve('Av. Sarmiento 2715', 'Palermo')
      expect(await result).toMatchObject({ outcome: 'ambiguous', reasons: [expect.stringContaining('more than one CABA street')] })
      expect(inserts).toHaveLength(0)
      expect(urls().at(-1)?.pathname).toBe('/normalizar')
    })

    it.each([
      ['timeout', () => { throw new DOMException('timed out', 'TimeoutError') }],
      ['HTTP error', () => new Response(null, { status: 503 })],
      ['bad JSON', () => new Response('not JSON')],
      ['oversized JSON', () => Response.json({ direccionesNormalizadas: [usig('SARMIENTO AV.', 2715)], padding: 'x'.repeat(256 * 1024) })],
    ] as const)('does not write on USIG %s without an exact Nominatim match', async (_name, response) => {
      const urls = providers({ ...inCaba, road: 'Avenida Presidente Sarmiento', suburb: 'Palermo' }, response, 'Palermo')
      const { result, inserts } = resolve('Av. Sarmiento 2715', 'Palermo')
      expect(await result).toMatchObject({ outcome: 'rejected', reasons: [expect.stringContaining('could not confirm')] })
      expect(inserts).toHaveLength(0)
      expect(urls().at(-1)?.pathname).toBe('/normalizar')
    })

    it('holds without writing when the stated barrio conflicts with USIG', async () => {
      providers(otherRoad, [usig('SARMIENTO AV.', 2715)], 'Palermo')
      const { result, inserts } = resolve('Av. Sarmiento 2715', 'Balvanera')
      expect(await result).toMatchObject({ outcome: 'ambiguous', reasons: [expect.stringMatching(/Palermo.*Balvanera/)] })
      expect(inserts).toHaveLength(0)
    })

    it('holds when USIG finds the exact address in both CABA and Provincia without an explicit locality', async () => {
      const urls = providers({ ...province, road: 'Avenida 58', house_number: '943' }, [
        usig('ROQUE SAENZ PEÑA AV.', 943, 'brandsen'), usig(diagonal, 943),
      ], 'San Nicolás')
      const address = 'Av. Roque Sáenz Peña 943'
      const { result, inserts } = resolve(address, 'San Nicolás')
      expect(await result).toMatchObject({ outcome: 'ambiguous', reasons: [expect.stringMatching(/CABA.*Provincia/)] })
      expect(inserts).toHaveLength(0)
      expect(urls().at(-1)?.pathname).toBe('/normalizar')

      expect(await resolve(`${address}, CABA`).result).toMatchObject({ outcome: 'created', venue: { neighborhood: 'San Nicolás' } })
      expect(await resolve(address, null, 'La sala queda en el barrio de San Nicolás').result)
        .toMatchObject({ outcome: 'created', venue: { neighborhood: 'San Nicolás' } })
    })

    it.each([
      ['Av. Sarmiento 2715', { ...province, road: 'Avenida 58', house_number: '2715' }, 'SARMIENTO AV.', 2715, 'Palermo', 'Palermo'],
      ['Av. Rivadavia 1499', { ...province, road: 'Rivadavia', postcode: '1499' }, 'RIVADAVIA AV.', 1499, 'San Nicolas', 'San Nicolás'],
    ] as const)('recovers %s only with a matching CABA street and height', async (address, osm, street, number, reported, neighborhood) => {
      const urls = providers(osm, [usig(street, number + 1, 'brandsen'), usig(street, number)], reported)
      const { result, inserts } = resolve(address)
      expect(await result).toMatchObject({ outcome: 'created', venue: { address, neighborhood }, warnings: [] })
      expect(inserts[1].row.notes).toContain('"neighborhood_method":"usig"')
      const [normalized, area] = urls().slice(-2)
      expect(normalized.searchParams.get('direccion')).toBe(address)
      expect([...area.searchParams]).toEqual([['calle', street], ['altura', String(number)]])
    })

    it.each([
      ['Sarmiento 2715', 'Sarmiento', '2715', 'Balvanera'],
      ['Diagonal Norte 943', 'Avenida Presidente Roque Sáenz Peña', '943', 'San Nicolás'],
      ['Av. Raúl Scalabrini Ortiz 343', 'Avenida Raúl Scalabrini Ortiz', '343', 'Villa Crespo'],
      ['Chacabuco 875', 'Chacabuco', '875', 'San Telmo'],
    ])('keeps an exact city result for %s without consulting USIG', async (address, road, house_number, suburb) => {
      const urls = providers({ ...inCaba, road, house_number, suburb })
      expect(await resolve(address).result).toMatchObject({ outcome: 'created', venue: { neighborhood: suburb }, warnings: [] })
      expect(urls().map(url => url.hostname)).toEqual(['nominatim.openstreetmap.org'])
    })

    it.each([
      ['Av. Maipú 1200, Vicente López', 'Avenida Maipú', undefined],
    ])('never swaps an explicitly qualified suburb for a CABA namesake: %s', async (address, road, house_number) => {
      const urls = providers({ ...province, road, house_number })
      const { result, inserts } = resolve(address, 'San Nicolás')
      expect(await result).toMatchObject({ outcome: 'rejected', reasons: [expect.stringContaining('outside the city')] })
      expect(inserts).toHaveLength(0)
      expect(urls().every(url => url.searchParams.get('q') === `${address} Buenos Aires Argentina`)).toBe(true)
    })

    it('rejects a fuzzy street, a different height, and a province result even with a stated barrio', async () => {
      const canonical = 'SAENZ PEÑA, ROQUE, PRES. DIAGONAL NORTE AV.'
      const urls = providers({ ...province, road: 'Avenida Roque Sáenz Peña', house_number: '943' }, [
        usig('OTRA AV.', 943), usig(canonical, 944), usig(canonical, 943, 'brandsen'),
      ], 'San Nicolás')
      const { result, inserts } = resolve('Av. Roque Sáenz Peña 943, CABA', 'San Nicolás')
      expect(await result).toMatchObject({ outcome: 'rejected', reasons: [expect.stringContaining('outside the city')] })
      expect(inserts).toHaveLength(0)
      expect(urls().map(url => url.pathname)).toEqual(['/search', '/normalizar'])
    })
  })

  it('holds an exact suburban street and number even when a city street of the same name exists', async () => {
    const geocode = vi.fn((_query: string, options?: { cityBias?: boolean }) => (options?.cityBias
      ? geocoded('Ciudad Autónoma de Buenos Aires', 'Recoleta', 'Avenida Santa Fe', '1234')
      : geocoded('Buenos Aires', 'Martínez', 'Avenida Santa Fe', '1234'))())
    const { db, inserts } = fakeDb([])
    expect(await run(db, request({ address: 'Av. Santa Fe 1234', neighborhood: null }), geocode))
      .toMatchObject({ outcome: 'ambiguous', reasons: [expect.stringContaining('outside the city of Buenos Aires')] })
    expect(geocode).toHaveBeenCalledTimes(1)
    expect(inserts).toHaveLength(0)
  })
  it('holds an exact suburban result on the biased retry before looking for a CABA namesake', async () => {
    const geocode: Geocode = (_query, options) => geocoded('Buenos Aires', 'Martínez', 'Avenida Santa Fe', options?.cityBias ? '1234' : '')()
    const cityLookup = vi.fn(() => Effect.succeed('Recoleta' as const))
    const { db, inserts } = fakeDb([])
    const result = await Effect.runPromise(resolveIntakeVenueEffect(db, request({ address: 'Av. Santa Fe 1234', neighborhood: null }),
      { geocode, cityLookup }))
    expect(result).toMatchObject({ outcome: 'ambiguous', reasons: [expect.stringContaining('outside the city')] })
    expect(cityLookup).not.toHaveBeenCalled()
    expect(inserts).toHaveLength(0)
  })
  it('rejects an address the city-biased search still places outside the city, as with a supplied locality', async () => {
    const geocode = vi.fn(() => geocoded('Buenos Aires', 'Martínez', 'Avenida Santa Fe', '')())
    expect(await run(fakeDb([]).db, request({ address: 'Av. Santa Fe 1234, Martínez' }), geocode))
      .toMatchObject({ outcome: 'rejected', reasons: [expect.stringContaining('outside the city')] })
    expect(geocode).toHaveBeenCalledTimes(2)
    expect(geocode).toHaveBeenLastCalledWith('Av. Santa Fe 1234, Martínez', { cityBias: true })
  })
  it('does not treat a city street without the requested house number as confirmation', async () => {
    const geocode = vi.fn((_query: string, options?: { cityBias?: boolean }) => (options?.cityBias
      ? geocoded('Ciudad Autónoma de Buenos Aires', 'Almagro', 'Avenida Ficticia', '') : () => Effect.succeed(null))())
    const { db, inserts } = fakeDb([])
    for (const neighborhood of [null, 'Almagro']) {
      expect(await run(db, request({ neighborhood }), geocode)).toMatchObject({ outcome: 'rejected', reasons: [expect.stringContaining('could not confirm')] })
    }
    expect(inserts).toHaveLength(0)
    expect(geocode).toHaveBeenCalledTimes(4)
  })
  it('rejects a geocoder outage without writing', async () => {
    const { db, inserts } = fakeDb([])
    expect(await run(db, request(), () => Effect.fail('timeout'))).toMatchObject({ outcome: 'rejected' })
    expect(inserts).toHaveLength(0)
  })
  it.each([
    { address: 'Av. Ficticia 1234, CABA', neighborhood: 'Almagro' },
    { address: 'Av. Ficticia 1234, Almagro', neighborhood: null },
    { address: 'Av. Ficticia 1234, Almagro', neighborhood: 'Boedo' },
  ])('holds a stated barrio contradicted by the exact Nominatim suburb: %j', async (input) => {
    const { db, inserts } = fakeDb([])
    expect(await run(db, request(input), geocoded('Ciudad Autónoma de Buenos Aires', 'Boedo')))
      .toMatchObject({ outcome: 'ambiguous', reasons: [expect.stringMatching(/Nominatim.*Boedo.*Almagro/)] })
    expect(inserts).toHaveLength(0)
  })
  it('keeps the stated barrio when only the informal Nominatim neighbourhood disagrees', async () => {
    const geocode = geocoded('Ciudad Autónoma de Buenos Aires', 'Almagro', undefined, undefined, 'Boedo')
    expect(await run(fakeDb([]).db, request(), geocode))
      .toMatchObject({ outcome: 'created', venue: { neighborhood: 'Almagro' }, warnings: [expect.stringContaining('Boedo')] })
  })
  it('fails on a database outage instead of creating a possible duplicate', async () => {
    const { db, inserts } = fakeDb([], { failReads: true })
    await expect(run(db, request())).rejects.toThrow('database unavailable')
    expect(inserts).toHaveLength(0)
  })
})

describe('held venue backlog', () => {
  const payload = (overrides: Record<string, unknown>) => ({ name: 'Synthetic', date: '2026-11-20', time: null, venue_name: 'Sala Sintética', venue_id: null, issues: [], ...overrides })
  const row = (id: string, overrides: Record<string, unknown> = {}) => ({ id, revision: 1, updated_at: '2026-11-14T12:00:00Z', payload: payload(overrides) as never })
  const plan = (candidate_id: string, action: string, reasons: string[], receipt: unknown = null) => ({ candidate_id, revision: 1, action, reasons, receipt, created_at: '2026-11-14T12:00:00Z' })
  it('groups future unpublished candidates by venue and marks venue-only holds', () => {
    const groups = groupHeldByVenue([
      row('a', { date: '2026-11-21' }), row('b', { venue_name: 'SALA sintética' }), row('past', { date: '2026-11-01' }),
      row('published', { venue_id: 'v1', venue_name: 'Otra' }), row('ready', { venue_id: 'v2', venue_name: 'Lista' }),
      row('olivos', { venue_name: 'Bar Olivos', issues: ['Verified outside supported CABA geography: Olivos'] }),
      row('conflict', { venue_name: 'Bar Olivos' }),
    ], [
      plan('a', 'held', ['Venue must be resolved before publishing']), plan('b', 'held', ['Venue must be resolved before publishing']),
      plan('published', 'create', [], { event_id: 'e' }), plan('ready', 'create', []),
      plan('olivos', 'held', ['Venue must be resolved before publishing', 'Verified outside supported CABA geography: Olivos']),
      plan('conflict', 'held', ['Venue must be resolved before publishing', 'Conflicting times in flyer']),
    ], '2026-11-14')
    expect(groups.map(group => [group.venue_name, group.venue_only, group.candidates.map(item => item.id)])).toEqual([
      ['Sala Sintética', 2, ['b', 'a']], ['Bar Olivos', 0, ['olivos', 'conflict']],
    ])
  })
})
