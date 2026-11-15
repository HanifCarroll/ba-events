import { afterEach, describe, expect, it, vi } from 'vitest'
import { Effect } from 'effect'
import { searchNominatimEffect } from './nominatim.ts'

// The response Nominatim returned on 2026-11-15 for Teatro Empire's address, trimmed: note `"extratags": null`.
const empire = [{
  place_id: 19136583, lat: '-34.6105202', lon: '-58.3938625',
  display_name: '1934, Hipólito Yrigoyen, Balvanera, Buenos Aires, Comuna 3, Ciudad Autónoma de Buenos Aires, 1079, Argentina',
  address: { house_number: '1934', road: 'Hipólito Yrigoyen', suburb: 'Balvanera', city: 'Buenos Aires', state_district: 'Comuna 3',
    state: 'Ciudad Autónoma de Buenos Aires', 'ISO3166-2-lvl4': 'AR-C', postcode: '1079', country: 'Argentina', country_code: 'ar' },
  extratags: null,
}]
const respond = (body: unknown) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })))

describe('searchNominatimEffect', () => {
  afterEach(() => { vi.unstubAllGlobals() })
  it('keeps the state and country of a result whose extratags are null', async () => {
    respond(empire)
    const result = await Effect.runPromise(searchNominatimEffect('Hipólito Yrigoyen 1934'))
    expect(result?.address.state).toBe('Ciudad Autónoma de Buenos Aires')
    expect(result?.address.country_code).toBe('ar')
  })
  it('keeps the state and country when only a partial result can be read', async () => {
    respond([{ ...empire[0], place_id: 'not-a-number' }])
    const result = await Effect.runPromise(searchNominatimEffect('Hipólito Yrigoyen 1934'))
    expect(result?.address.state).toBe('Ciudad Autónoma de Buenos Aires')
    expect(result?.address.country_code).toBe('ar')
    expect(result?.address.suburb).toBe('Balvanera')
  })
})
