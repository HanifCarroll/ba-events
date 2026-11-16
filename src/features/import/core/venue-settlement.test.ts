import { describe, expect, it } from 'vitest'
import { isAreaOnlyVenueName } from './venue-settlement.ts'

describe('isAreaOnlyVenueName', () => {
  it('rejects a city, region, barrio, or postal code standing in for a venue', () => {
    for (const name of ['Buenos Aires, Argentina', 'C1437EFA C1437EFA, Argentina', 'Buenos Aires, Ciudad Autónoma de Buenos Aires',
      'Caballito', 'belgrano', 'Palermo, Buenos Aires', 'MICROCENTRO.', 'Comuna 15', 'C1426BMI, Ciudad Autónoma de Buenos Aires', 'Caba'])
      expect(isAreaOnlyVenueName(name), name).toBe(true)
  })

  it('keeps real venues and street addresses, including ones named after a place', () => {
    for (const name of ['Teatro Buenos Aires', 'Club de Pescadores Buenos Aires', 'Espacio de Vinos Caballito', 'Constitución 3257',
      'Av. Corrientes 1530', 'Estadio Cubierto Malvinas Argentinas', 'Torre Banco Macro', '', null])
      expect(isAreaOnlyVenueName(name), String(name)).toBe(false)
  })
})
