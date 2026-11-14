import { describe, expect, it } from 'vitest'
import { Effect } from 'effect'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { NominatimResult } from '../core/nominatim.ts'
import { addressKey, decodeVenueRequest, type Geocode, groupHeldByVenue, resolveIntakeVenueEffect, type VenueRequest } from './venues.ts'

type Row = { id: string; name: string; address: string | null; neighborhood: string | null }
/** A synthetic venues table behind the few query shapes the matcher and resolver use. */
function fakeDb(venues: Row[], options: { similar?: Record<string, number>; failReads?: boolean } = {}) {
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = []
  const from = (table: string) => {
    const filters: Array<(row: Row) => boolean> = []
    let pending: Record<string, unknown> | null = null
    let patch: Partial<Row> | null = null
    const builder: Record<string, unknown> = {
      update: (values: Partial<Row>) => { patch = values; return builder },
      is: (column: keyof Row, value: null) => { filters.push(row => row[column] === value); return builder },
      select: () => builder, limit: () => builder, order: () => builder, range: () => builder,
      ilike: (column: 'name' | 'address', pattern: string) => {
        const needle = pattern.replaceAll('%', '').toLowerCase()
        filters.push(row => pattern.startsWith('%') ? !!row[column]?.toLowerCase().includes(needle) : row[column]?.toLowerCase() === needle)
        return builder
      },
      eq: (column: 'id', value: string) => { filters.push(row => row[column] === value); return builder },
      insert: (row: Record<string, unknown>) => { pending = row; return builder },
      single: () => {
        if (pending) {
          const row = table === 'venues' ? { id: `venue-${venues.length + 1}`, ...pending } as Row : { id: 'log', ...pending }
          inserts.push({ table, row: pending }); if (table === 'venues') venues.push(row as Row)
          return Promise.resolve({ data: row, error: null })
        }
        const found = venues.filter(row => filters.every(filter => filter(row)))[0]
        return Promise.resolve(found ? { data: found, error: null } : { data: null, error: { message: 'no rows' } })
      },
      then: (resolve: (value: unknown) => void) => patch
        ? resolve({ data: venues.filter(row => filters.every(filter => filter(row))).map(row => Object.assign(row, patch)), error: null })
        : resolve(options.failReads
        ? { data: null, error: { message: 'database unavailable' } }
        : { data: venues.filter(row => filters.every(filter => filter(row))), error: null }),
    }
    return builder
  }
  // Stands in for intake_similar_venues: case-insensitive equality scores 1, other scores come from the test.
  const rpc = (_name: string, args: { p_name: string }) => Promise.resolve(options.failReads ? { data: null, error: { message: 'database unavailable' } } : {
    data: venues.map(row => ({ ...row, similarity: row.name.toLowerCase() === args.p_name.toLowerCase() ? 1 : options.similar?.[row.id] ?? 0 }))
      .filter(row => row.similarity >= 0.6).sort((a, b) => b.similarity - a.similarity), error: null })
  return { db: { from, rpc } as unknown as SupabaseClient, inserts, venues }
}
const geocoded = (state: string, suburb?: string) => () => Effect.succeed({ lat: '0', lon: '0', display_name: 'synthetic',
  address: { state, suburb, country_code: 'ar' } } as NominatimResult)
const request = (overrides: Partial<VenueRequest> = {}): VenueRequest => decodeVenueRequest({
  name: 'Sala Sintética', address: 'Av. Ficticia 1234, CABA', neighborhood: 'Almagro',
  evidence: [{ url: 'https://example.org/sala', confirms: 'name, address and barrio on the official site' }], ...overrides })
const run = (db: SupabaseClient, input: VenueRequest, geocode: Geocode = geocoded('Ciudad Autónoma de Buenos Aires', 'Almagro')) =>
  Effect.runPromise(resolveIntakeVenueEffect(db, input, geocode))

describe('intake venue resolution', () => {
  it('normalizes street prefixes and suffixes into one address key', () => {
    expect(addressKey('Av. Ficticia 1234, CABA')).toBe('ficticia 1234')
    expect(addressKey('Avenida Ficticia 1234')).toBe('ficticia 1234')
    expect(addressKey('Ficticia sin número')).toBeNull()
    expect(addressKey('3 de Febrero 1378')).toBe('3 de febrero 1378')
    expect(addressKey('Av. 9 de Julio 1000')).toBe('9 de julio 1000')
    for (const street of ['3 de Febrero', 'Av. 9 de Julio', '25 de Mayo, CABA', '1378']) expect(addressKey(street)).toBeNull()
  })
  it('rejects a street whose only number is part of its name', async () => {
    const { db, inserts } = fakeDb([])
    expect(await run(db, request({ address: '3 de Febrero' }))).toMatchObject({ outcome: 'rejected', reasons: [expect.stringContaining('house number')] })
    expect(await run(db, request({ address: 'Av. 9 de Julio' }))).toMatchObject({ outcome: 'rejected' })
    expect(inserts).toHaveLength(0)
    expect(await run(db, request({ address: '3 de Febrero 1378' }))).toMatchObject({ outcome: 'created' })
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
    const { db, inserts } = fakeDb([{ id: 'v1', name: 'SALA  sintetica', address: 'Ficticia 1234', neighborhood: 'Almagro' }])
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
    it('stays ambiguous for an unlisted candidate, an empty reason, the same name, or the same street and number', async () => {
      const alias = () => fakeDb([{ id: id(1), name: 'Saavedra', address: null, neighborhood: null },
        { id: id(2), name: 'Saavedra Club', address: null, neighborhood: null }])
      expect(await run(alias().db, request({ ...museum, distinct_from: [{ venue_id: id(1), reason: why }] }))).toMatchObject({ outcome: 'ambiguous' })
      expect(() => request({ ...museum, distinct_from: [{ venue_id: id(1), reason: '' }] })).toThrow()
      expect(await run(alias().db, request({ ...museum, distinct_from: [{ venue_id: id(1), reason: why }, { venue_id: id(2), reason: '          ' }] }))).toMatchObject({ outcome: 'ambiguous' })
      const sameName = fakeDb([{ id: id(3), name: 'MUSEO SINTETICO  SAAVEDRA', address: 'Lejana 99', neighborhood: 'Boedo' }])
      expect(await run(sameName.db, request({ ...museum, distinct_from: [{ venue_id: id(3), reason: why }] }))).toMatchObject({ outcome: 'ambiguous' })
      // Also similar by name, but at the same street and number: never overridable.
      const sameAddress = fakeDb([{ id: id(4), name: 'Saavedra', address: 'Ficticia 1234', neighborhood: 'Saavedra' }])
      expect(await run(sameAddress.db, request({ ...museum, distinct_from: [{ venue_id: id(4), reason: why }] }))).toMatchObject({ outcome: 'ambiguous' })
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
  it('rejects addresses outside the city and invalid barrios, and derives a missing barrio', async () => {
    const { db, inserts } = fakeDb([])
    expect(await run(db, request(), geocoded('Buenos Aires', 'Vicente López'))).toMatchObject({ outcome: 'rejected' })
    expect(await run(db, request({ neighborhood: 'Olivos' }))).toMatchObject({ outcome: 'rejected' })
    expect(await run(db, request({ neighborhood: 'Villa' }))).toMatchObject({ outcome: 'rejected' })
    expect(await run(db, request({ neighborhood: null }), () => Effect.succeed(null))).toMatchObject({ outcome: 'rejected' })
    expect(inserts).toHaveLength(0)
    expect(await run(db, request({ neighborhood: null }))).toMatchObject({ outcome: 'created', venue: { neighborhood: 'Almagro' } })
  })
  it('keeps the stated barrio with a warning when the geocoder is down or disagrees', async () => {
    const down = await run(fakeDb([]).db, request(), () => Effect.fail(new Error('timeout')))
    expect(down).toMatchObject({ outcome: 'created', warnings: [expect.stringContaining('Geocoder unavailable')] })
    const other = await run(fakeDb([]).db, request(), geocoded('Ciudad Autónoma de Buenos Aires', 'Boedo'))
    expect(other).toMatchObject({ outcome: 'created', venue: { neighborhood: 'Almagro' }, warnings: [expect.stringContaining('Boedo')] })
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
