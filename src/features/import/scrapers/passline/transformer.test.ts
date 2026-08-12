import { describe, expect, it } from 'vitest'
import type { PasslineEvent } from './api'
import { transformPasslineEvent } from './transformer'

const baseEvent: PasslineEvent = {
  id: '1',
  nombre: 'Test event',
  lugar: 'Test venue',
  fecha_inicio: '2026-08-15',
  fecha_termino: '2026-08-16',
  hora_inicio: '00:00:00',
  hora_termino: '00:00:00',
  nombre_region: 'Capital Federal',
  nombre_communa: 'C.A.B.A.',
  category_name: 'Music',
  artistas: '',
  precio_min: null,
  url: 'https://www.passline.com/eventos/test',
  miniatura: '',
  recorte: '',
  slug: 'test',
  agotado: '0',
  disponibles: '1',
  promocion: '',
}

describe('Passline transformer', () => {
  it('marks midnight placeholder ranges as time TBA', () => {
    expect(transformPasslineEvent(baseEvent, null).time_tba).toBe(true)
  })

  it('keeps a real source time', () => {
    expect(
      transformPasslineEvent(
        { ...baseEvent, hora_inicio: '23:00:00', hora_termino: '05:00:00' },
        null,
      ).time_tba,
    ).toBe(false)
  })
})
