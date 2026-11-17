/** Golden tests: the live weekend post (templates ba-p2) and copy.md's templates, filled in. */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CLOSING, HOY_CLOSING, caption, cardKicker, cover, eventLine, footerHandle, skipText, slackPreview, tooFewText } from './copy.ts'
import { baInstant } from './format.ts'
import { runWindow } from './formats.ts'
import type { PostEvent } from './select.ts'

const copyMd = readFileSync(new URL('./copy.md', import.meta.url), 'utf8')

const post = (date: string, time: string, title: string, handle: string | null, barrio: string, price: string | null, venue = 'Sala', via = false): PostEvent =>
  ({ id: title, date, startsAt: '', title, time, description: null, venue, barrio, price, handle, via })

// The live weekend carousel's events, as the catalog would give them.
const weekend: PostEvent[] = [
  post('2026-11-20', '21:00', 'Demián Ornstein Trío', 'gelsomina_cultural', 'San Cristóbal', '$15.000'),
  post('2026-11-21', '11:00 a 16:30', '24 horas por el Cine Argentino', 'salalucida', 'Saavedra', 'Gratis'),
  post('2026-11-21', '19:30', 'Ponerse de pie', 'saviacultural', 'Villa Crespo', null),
  post('2026-11-21', '20:00', 'Mandatos', 'laba.arg', 'Chacarita', null),
  post('2026-11-21', '21:30', 'Mantecas', 'cafe.artigas', 'Villa General Mitre', 'A la gorra'),
  post('2026-11-22', '20:00', 'Dear Munro', null, 'Parque Patricios', null, 'Planta Inclán'),
]

describe('Este finde', () => {
  it('builds the caption from copy.md', () => {
    expect(caption('finde', weekend)).toBe(`Seis planes independientes para este finde en Buenos Aires:

Viernes 20, 21:00. Demián Ornstein Trío en @gelsomina_cultural, San Cristóbal. $15.000.
Sábado 21, 11:00 a 16:30. 24 horas por el Cine Argentino en @salalucida, Saavedra. Gratis.
Sábado 21, 19:30. Ponerse de pie en @saviacultural, Villa Crespo.
Sábado 21, 20:00. Mandatos en @laba.arg, Chacarita.
Sábado 21, 21:30. Mantecas en @cafe.artigas, Villa General Mitre. A la gorra.
Domingo 22, 20:00. Dear Munro en Planta Inclán, Parque Patricios.

Más planes en baeventos.com (link en la bio).

Six independent events this weekend in Buenos Aires. More at baeventos.com.`)
  })

  it('matches the live cover and card text', () => {
    const window = runWindow('finde', '2026-11-20')
    expect(cover('finde', window, 6)).toEqual({ kicker: '20 al 22 de noviembre', headline: ['Este finde', 'en Buenos Aires'], body: 'Seis planes independientes para elegir.', english: null })
    expect(cardKicker('finde', weekend[1]!)).toBe('Sábado 21 · 11:00 a 16:30')
  })
})

describe('Gratis esta semana', () => {
  it('leaves the price out of each line', () => {
    const free = weekend.slice(0, 5).map(event => ({ ...event, price: 'Gratis' }))
    const text = caption('gratis', free)!
    expect(text.split('\n')[0]).toBe('Cinco planes gratis esta semana en Buenos Aires:')
    expect(text).toContain('\nViernes 20, 21:00. Demián Ornstein Trío en @gelsomina_cultural, San Cristóbal.\n')
    expect(text.endsWith('Five free events this week in Buenos Aires. More at baeventos.com.')).toBe(true)
    const window = runWindow('gratis', '2026-11-30')
    expect(cover('gratis', window, 5)).toEqual({ kicker: '30 de noviembre al 6 de diciembre', headline: ['Gratis', 'esta semana'], body: 'Cinco planes gratis en Buenos Aires para elegir.', english: null })
  })
})

describe('a handle that is the posting account, not the venue', () => {
  const feja = post('2026-11-27', '19:30', 'Festival de Jazz FEJA 2026', 'vamos_gratis', 'Recoleta', 'Gratis', 'Facultad de Derecho (UBA)', true)
  const troilo = post('2026-11-27', '18:00', 'Troilo inédito', 'instituto.iiet', 'Monserrat', '$5.000', 'La Vidriera', true)

  it('names the venue and credits the account with "Vía"', () => {
    expect(eventLine('finde', troilo)).toBe('Viernes 27, 18:00. Troilo inédito en La Vidriera, Monserrat. $5.000. Vía @instituto.iiet.')
    expect(eventLine('gratis', feja)).toBe('Viernes 27, 19:30. Festival de Jazz FEJA 2026 en Facultad de Derecho (UBA), Recoleta. Vía @vamos_gratis.')
    expect(eventLine('finde', { ...troilo, price: null })).toBe('Viernes 27, 18:00. Troilo inédito en La Vidriera, Monserrat. Vía @instituto.iiet.')
  })

  it('writes "Vía @handle" in the footer, and "@handle" for the venue\'s own account', () => {
    expect(footerHandle(feja)).toBe('Vía @vamos_gratis')
    expect(footerHandle(weekend[0]!)).toBe('@gelsomina_cultural')
    expect(footerHandle(weekend[5]!)).toBe('')
  })
})

describe('Hoy', () => {
  it('has a cover, cards, and no caption', () => {
    const window = runWindow('hoy', '2026-11-18')
    expect(cover('hoy', window, 3)).toEqual({
      kicker: 'Miércoles 18 de noviembre',
      headline: ['Hoy en Buenos Aires'],
      body: 'Tres planes para esta noche.',
      english: 'Tonight in Buenos Aires: three independent events.',
    })
    expect(cardKicker('hoy', weekend[0]!)).toBe('Hoy · 21:00')
    expect(caption('hoy', weekend)).toBeNull()
  })
})

describe('Slack', () => {
  it('previews with the copy.md message', () => {
    const window = runWindow('finde', '2026-11-20')
    expect(slackPreview('finde', window, 'CAPTION', false)).toBe('Instagram draft: Este finde carousel for November 20 to 22. It goes out Thursday at 12:00 once you react ✅. React ❌ to skip it.\n\nCAPTION')
    expect(slackPreview('hoy', runWindow('hoy', '2026-11-18'), null, false)).toBe('Instagram draft: Hoy story for November 18. It goes out Wednesday at 17:00 once you react ✅. React ❌ to skip it.\n\nStories have no caption.')
    expect(slackPreview('finde', window, 'C', true)).toContain('It goes out Thursday at 12:00 unless you react ❌.')
  })

  it('gives the skip reasons', () => {
    expect(skipText({ kind: 'rejected' })).toBe('Skipped: you reacted ❌')
    expect(skipText({ kind: 'no-approval', by: baInstant('2026-11-18', 17) })).toBe('Skipped: no ✅ by 17:00')
    expect(skipText({ kind: 'too-few', count: 3 })).toBe('Skipped: only 3 events qualified')
    expect(tooFewText('gratis', runWindow('gratis', '2026-11-23'), 3)).toBe('Instagram draft: Gratis esta semana carousel for November 23 to 29. Skipped: only 3 events qualified')
  })
})

describe('copy.md', () => {
  it('contains every fixed string the code uses', () => {
    for (const text of [...Object.values(CLOSING), ...Object.values(HOY_CLOSING), 'Hoy en Buenos Aires', 'Este finde', 'en Buenos Aires',
      'esta semana', 'Más planes en baeventos.com (link en la bio).', 'independent events this weekend in Buenos Aires. More at baeventos.com.',
      'free events this week in Buenos Aires. More at baeventos.com.', 'planes independientes para elegir.', 'planes gratis en Buenos Aires para elegir.',
      'planes para esta noche.', 'Stories have no caption.', 'once you react ✅. React ❌ to skip it.', '"you reacted ❌"', 'Deslizá →',
      'Hoy story', 'Este finde carousel', 'Gratis esta semana carousel', 'Posted: {permalink}',
      '"{Weekday} {d}, {time}. {Title} en {Venue}, {Barrio}. {Price}. Vía @{handle}."', '"Vía @{handle}" instead of "@{handle}"']) {
      expect(copyMd).toContain(text)
    }
    expect(eventLine('finde', weekend[0]!)).toMatch(/^\{?Viernes 20, 21:00\. /)
  })
})
