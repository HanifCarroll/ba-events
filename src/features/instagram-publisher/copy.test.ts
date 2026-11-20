import { describe, expect, it } from 'vitest'
import { caption, cardKicker, cover, eventLine, footerHandle, heldText, skipText, slackPreview, tooFewText } from './copy.ts'
import { baInstant } from './format.ts'
import { runWindow } from './formats.ts'
import type { PostEvent } from './select.ts'

const post = (date: string, time: string, title: string, handle: string | null, barrio: string, price: string | null, venue = 'Sala', via = false): PostEvent =>
  ({ id: title, date, startsAt: '', title, time, description: null, venue, barrio, price, handle, via })

const weekend: PostEvent[] = [
  post('2026-11-20', '21:00', 'Trío del Patio', 'patio_ejemplo', 'San Cristóbal', '$15.000'),
  post('2026-11-21', '11:00 a 16:30', 'Cine en el Patio', 'cine_ejemplo', 'Saavedra', 'Gratis'),
  post('2026-11-21', '21:30', 'Canciones en el Taller', 'taller_ejemplo', 'Villa General Mitre', 'A la gorra'),
  post('2026-11-22', '20:00', 'Dúo de la Plaza', null, 'Parque Patricios', null, 'Sala del Andén'),
]

describe('Este finde', () => {
  it('lists each event in order with its ticket terms and closes in both languages', () => {
    const lines = caption('finde', weekend)?.split('\n\n')
    expect(lines?.[0]).toBe('Cuatro planes independientes para este finde en Buenos Aires:')
    expect(lines?.slice(1, -2)).toEqual([
      'Viernes 20, 21:00. Trío del Patio en @patio_ejemplo, San Cristóbal. $15.000.',
      'Sábado 21, 11:00 a 16:30. Cine en el Patio en @cine_ejemplo, Saavedra. Gratis.',
      'Sábado 21, 21:30. Canciones en el Taller en @taller_ejemplo, Villa General Mitre. A la gorra.',
      'Domingo 22, 20:00. Dúo de la Plaza en Sala del Andén, Parque Patricios.',
    ])
    expect(lines?.slice(-2)).toEqual([
      'Más planes en baeventos.com (link en la bio).',
      'Four independent events this weekend in Buenos Aires. More at baeventos.com.',
    ])
  })

  it('formats the dates and pick count on the cover and cards', () => {
    const window = runWindow('finde', '2026-11-20')
    expect(cover('finde', window, weekend.length)).toEqual({ kicker: '20 al 22 de noviembre', headline: ['Este finde', 'en Buenos Aires'], body: 'Cuatro planes independientes para elegir.' })
    expect(cardKicker('finde', weekend[1]!)).toBe('Sábado 21 · 11:00 a 16:30')
  })
})

describe('Gratis esta semana', () => {
  it('leaves the price out of each line', () => {
    const free = weekend.map(event => ({ ...event, price: 'Gratis' }))
    const text = caption('gratis', free)!
    expect(text.split('\n')[0]).toBe('Cuatro planes gratis esta semana en Buenos Aires:')
    expect(text).toContain('\nViernes 20, 21:00. Trío del Patio en @patio_ejemplo, San Cristóbal.\n')
    expect(text.endsWith('Four free events this week in Buenos Aires. More at baeventos.com.')).toBe(true)
    const window = runWindow('gratis', '2026-11-30')
    expect(cover('gratis', window, free.length)).toEqual({ kicker: '30 de noviembre al 6 de diciembre', headline: ['Gratis', 'esta semana'], body: 'Cuatro planes gratis en Buenos Aires para elegir.' })
  })
})

describe('a handle that is the posting account, not the venue', () => {
  const festival = post('2026-11-27', '19:30', 'Festival del Puente', 'agenda_ejemplo', 'Recoleta', 'Gratis', 'Sala del Puente', true)
  const tango = post('2026-11-27', '18:00', 'Tango del Andén', 'tango_ejemplo', 'Monserrat', '$5.000', 'Sala del Andén', true)

  it('names the venue and credits the account with "Vía"', () => {
    expect(eventLine('finde', tango)).toBe('Viernes 27, 18:00. Tango del Andén en Sala del Andén, Monserrat. $5.000. Vía @tango_ejemplo.')
    expect(eventLine('gratis', festival)).toBe('Viernes 27, 19:30. Festival del Puente en Sala del Puente, Recoleta. Vía @agenda_ejemplo.')
    expect(eventLine('finde', { ...tango, price: null })).toBe('Viernes 27, 18:00. Tango del Andén en Sala del Andén, Monserrat. Vía @tango_ejemplo.')
  })

  it('writes "Vía @handle" in the footer, and "@handle" for the venue\'s own account', () => {
    expect(footerHandle(festival)).toBe('Vía @agenda_ejemplo')
    expect(footerHandle(weekend[0]!)).toBe('@patio_ejemplo')
    expect(footerHandle(weekend[3]!)).toBe('')
  })
})

describe('Hoy', () => {
  it('has a cover, cards, and no caption', () => {
    const window = runWindow('hoy', '2026-11-18')
    expect(cover('hoy', window, 3)).toEqual({
      kicker: 'Miércoles 18 de noviembre',
      headline: ['Hoy en Buenos Aires'],
      body: 'Tres planes para esta noche.',
    })
    expect(cardKicker('hoy', weekend[0]!)).toBe('Hoy · 21:00')
    expect(caption('hoy', weekend)).toBeNull()
  })
})

describe('Slack', () => {
  it('tells operators when the post goes out and how to approve or skip it', () => {
    const window = runWindow('finde', '2026-11-20')
    expect(slackPreview('finde', window, 'CAPTION', false)).toBe('Instagram draft: Este finde carousel for November 20 to 22. It goes out Thursday at 12:00 once you react ✅. React ❌ to skip it.\n\nCAPTION')
    expect(slackPreview('hoy', runWindow('hoy', '2026-11-18'), null, false)).toBe('Instagram draft: Hoy story for November 18. It goes out Wednesday at 17:00 once you react ✅. React ❌ to skip it.\n\nStories have no caption.')
    expect(slackPreview('finde', window, 'C', true)).toContain('It goes out Thursday at 12:00 unless you react ❌.')
  })

  it('gives the skip reasons', () => {
    expect(skipText({ kind: 'rejected' })).toBe('Skipped: you reacted ❌')
    expect(skipText({ kind: 'no-approval', by: baInstant('2026-11-18', 17) })).toBe('Skipped: no ✅ by 17:00')
    expect(skipText({ kind: 'too-few', count: 3 })).toBe('Skipped: only 3 events qualified')
    expect(skipText({ kind: 'late', by: baInstant('2026-11-18', 19) })).toBe('Skipped: not published by 19:00')
    expect(heldText('Cine en el Patio')).toBe('Held: Cine en el Patio was cancelled. Ask Hermes to regenerate it.')
    expect(heldText('Cine en el Patio', 'over')).toBe('Held: Cine en el Patio has already happened. Ask Hermes to regenerate it.')
    expect(tooFewText('gratis', runWindow('gratis', '2026-11-23'), 3)).toBe('Instagram draft: Gratis esta semana carousel for November 23 to 29. Skipped: only 3 events qualified')
  })
})

describe('Este finde Reel', () => {
  const window = runWindow('reel', '2026-11-20')

  it('uses the carousel caption word for word, with a credit line after "Más planes" when the track has one', () => {
    expect(caption('reel', weekend)).toBe(caption('finde', weekend))
    const credited = caption('reel', weekend, 'Música: "Intención" de Sapajou (auboutdufil.com), CC BY 3.0.')!
    expect(credited).toBe(caption('finde', weekend)!.replace('Más planes en baeventos.com (link en la bio).\n\n',
      'Más planes en baeventos.com (link en la bio).\n\nMúsica: "Intención" de Sapajou (auboutdufil.com), CC BY 3.0.\n\n'))
  })

  it('previews with the Reel name, Friday 12:00, and the track line last', () => {
    expect(slackPreview('reel', window, 'CAPTION', false, { title: 'Intención', artist: 'Sapajou' })).toBe(
      'Instagram draft: Este finde Reel for November 20 to 22. It goes out Friday at 12:00 once you react ✅. React ❌ to skip it.\n\nCAPTION\n\nMusic: "Intención" by Sapajou.')
  })
})
