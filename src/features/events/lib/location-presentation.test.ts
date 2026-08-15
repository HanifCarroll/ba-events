import { describe, expect, it } from 'vitest'
import { getDistinctVenueAddress } from './location-presentation.ts'

describe('getDistinctVenueAddress', () => {
  it('hides an address that duplicates the venue name', () => {
    expect(getDistinctVenueAddress('Av. Paseo Colón 1380', 'Av Paseo Colon 1380')).toBeNull()
  })

  it('keeps a distinct street address', () => {
    expect(getDistinctVenueAddress('Niceto Club', 'Av. Cnel. Niceto Vega 5510')).toBe(
      'Av. Cnel. Niceto Vega 5510',
    )
  })

  it('keeps an address when the venue name is missing', () => {
    expect(getDistinctVenueAddress(null, 'Av. Corrientes 1234')).toBe('Av. Corrientes 1234')
  })
})
