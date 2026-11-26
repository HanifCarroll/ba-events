import { describe, expect, it } from 'vitest'
import { captionLabelsFlyerDoors, citesClock } from './clock-evidence.ts'

describe('intake clock roles', () => {
  it.each(['Ingreso a las 21', 'Puertas:21', 'Ingreso 21h', 'Abrimos las puertas a las 21h', 'Apertura\n21:00'])('cites %s as entry, never as a start', excerpt => {
    expect(citesClock(excerpt, '21:00', excerpt, 1, 'doors')).toBe(true)
    expect(citesClock(excerpt, '21:00', excerpt, 1, 'start')).toBe(false)
  })

  it.each(['aprox.', 'aproximadamente', 'cerca de las', 'alrededor de las', 'más o menos'])('rejects the approximate clock even if the quote cuts %s', qualifier => {
    const caption = `Ingreso 20h. El show comienza ${qualifier} 21:45.\nShow confirmado: 22:00.`
    expect(citesClock('21:45', '21:45', caption, 1, 'start')).toBe(false)
    expect(citesClock('22:00', '22:00', caption, 1, 'start')).toBe(true)
  })

  it('does not count an approximate repeat as a second separately stated clock', () => {
    const excerpt = 'Ingreso a las 21. A las 21:00 (aprox.) comienza el show.'
    expect(citesClock(excerpt, '21:00', excerpt, 2, 'doors')).toBe(false)
    const both = 'Ingreso a las 21. Show: 21:00.'
    expect(citesClock(both, '21:00', both, 2, 'doors')).toBe(true)
  })

  it.each([
    'Los horarios de los flyers son de ingreso.',
    'Los horarios que figuran en los flyers corresponden al ingreso.',
    'El horario del afiche es el de apertura.',
    'El horario publicado en la placa es de puertas.',
  ])('recognizes explicit flyer attribution: %s', caption => {
    expect(captionLabelsFlyerDoors(caption)).toBe(true)
  })
  it('does not infer entry just because a caption mentions flyers and doors', () => {
    expect(captionLabelsFlyerDoors('El horario del flyer es del show. Puertas abren antes.')).toBe(false)
  })
})
