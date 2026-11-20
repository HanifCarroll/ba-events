import { readFileSync } from 'node:fs'
import { load } from 'cheerio'
import { describe, expect, it } from 'vitest'
import { caption, cardKicker, cover, eventLine, footerHandle, heldText, skipText, slackPreview, tooFewText } from './copy.ts'
import { baInstant } from './format.ts'
import { runWindow } from './formats.ts'
import { framesHtml } from './html.ts'
import type { PostEvent } from './select.ts'

const approved = readFileSync(new URL('./copy.md', import.meta.url), 'utf8')
const section = (heading: string) => approved.split(/^## /m).find(block => block.startsWith(heading))!
const fill = (template: string, values: Record<string, string>) =>
  template.replace(/\{([^{}]+)\}/g, (placeholder, key: string) => values[key] ?? placeholder)
const captionSections = (heading: string, spanish: string, english: string) =>
  fill(section(heading).split('\n```\n')[1]!, { N: spanish, N_en: english }).split('\n\n')
const slackSection = section('Slack preview message')
const [, draftTemplate, , musicTemplate] = slackSection.split('\n```\n')
const slackDraft = (name: string, dates: string, publish: string, body: string) => {
  expect(slackSection).toContain(`"${name}"`)
  return fill(draftTemplate!.replace('{Weekday} at {HH:MM}', publish), {
    'Format name': name, dates, 'caption, or "Stories have no caption." for Hoy': body,
  })
}

const post = (date: string, time: string, title: string, handle: string | null, barrio: string, price: string | null, venue = 'Sala', via = false): PostEvent =>
  ({ id: title, date, startsAt: '', title, time, description: null, venue, barrio, price, handle, via })

const weekend: PostEvent[] = [
  post('2026-11-20', '21:00', 'Trío del Patio', 'patio_ejemplo', 'San Cristóbal', '$15.000'),
  post('2026-11-21', '11:00 a 16:30', 'Cine en el Patio', 'cine_ejemplo', 'Saavedra', 'Gratis'),
  post('2026-11-21', '21:30', 'Canciones en el Taller', 'taller_ejemplo', 'Villa General Mitre', 'A la gorra'),
  post('2026-11-22', '14:00', 'Feria del Andén', null, 'Parque Patricios', 'Gratis', 'Sala del Andén'),
  post('2026-11-22', '17:00', 'Taller de Papel', 'papel_ejemplo', 'Almagro', 'Gratis'),
  post('2026-11-22', '20:00', 'Dúo de la Plaza', null, 'Parque Patricios', null, 'Sala del Andén'),
]

describe('Este finde', () => {
  it('lists each event in order with its ticket terms and closes in both languages', () => {
    const lines = caption('finde', weekend)?.split('\n\n')
    const [intro, , ...closing] = captionSections('2. Este finde', 'Seis', 'Six')
    expect(lines?.[0]).toBe(intro)
    expect(lines?.slice(1, -2)).toEqual([
      'Viernes 20, 21:00. Trío del Patio en @patio_ejemplo, San Cristóbal. $15.000.',
      'Sábado 21, 11:00 a 16:30. Cine en el Patio en @cine_ejemplo, Saavedra. Gratis.',
      'Sábado 21, 21:30. Canciones en el Taller en @taller_ejemplo, Villa General Mitre. A la gorra.',
      'Domingo 22, 14:00. Feria del Andén en Sala del Andén, Parque Patricios. Gratis.',
      'Domingo 22, 17:00. Taller de Papel en @papel_ejemplo, Almagro. Gratis.',
      'Domingo 22, 20:00. Dúo de la Plaza en Sala del Andén, Parque Patricios.',
    ])
    expect(lines?.slice(-2)).toEqual(closing)
  })

  it('formats the dates and pick count on the cover and cards', () => {
    const window = runWindow('finde', '2026-11-20')
    expect(cover('finde', window, weekend.length)).toEqual({ kicker: '20 al 22 de noviembre', headline: ['Este finde', 'en Buenos Aires'], body: 'Seis planes independientes para elegir.' })
    expect(cardKicker('finde', weekend[1]!)).toBe('Sábado 21 · 11:00 a 16:30')
  })
})

describe('Gratis esta semana', () => {
  it('counts five free picks in both languages and leaves prices out of the event lines', () => {
    const free = weekend.slice(0, 5).map(event => ({ ...event, price: 'Gratis' }))
    const sections = caption('gratis', free)!.split('\n\n')
    const [intro, , ...closing] = captionSections('3. Gratis esta semana', 'Cinco', 'Five')
    expect(sections[0]).toBe(intro)
    const events = sections.slice(1, -2)
    expect(events).toHaveLength(5)
    expect(events[0]).toBe('Viernes 20, 21:00. Trío del Patio en @patio_ejemplo, San Cristóbal.')
    expect(events.join('\n')).not.toContain('Gratis')
    expect(sections.slice(-2)).toEqual(closing)
    const window = runWindow('gratis', '2026-11-30')
    expect(cover('gratis', window, free.length)).toEqual({ kicker: '30 de noviembre al 6 de diciembre', headline: ['Gratis', 'esta semana'], body: 'Cinco planes gratis en Buenos Aires para elegir.' })
  })
})

it('renders the approved closing copy on the last carousel and Hoy frames', () => {
  const assets = { fontsDir: '/fonts', heroPhoto: '/hero.jpg' }
  for (const { format, day, events, heading, fields } of [
    { format: 'finde', day: '2026-11-20', events: weekend, heading: '- **Closing slide** (carousels):', fields: 4 },
    { format: 'hoy', day: '2026-11-22', events: weekend.slice(-3), heading: '**Closing frame**', fields: 3 },
  ] as const) {
    const section = approved.split(`${heading}\n`)[1]?.split('\n\n')[0] ?? ''
    const lines = Array.from(section.matchAll(/^\s*- \w+: "(.+)"$/gm), ([, text]) => text)
    expect(lines, heading).toHaveLength(fields)
    const $ = load(framesHtml(format, runWindow(format, day), events, assets))
    const closing = $('body').children().last()
    const rendered = closing.find('.serif, .serif + div, .btn, .foot span')
      .map((_, node) => $(node).text().trim()).get().filter(Boolean)
    expect(rendered, format).toEqual(lines)
  }
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
    })
    expect(cardKicker('hoy', weekend[0]!)).toBe('Hoy · 21:00')
    expect(caption('hoy', weekend)).toBeNull()
  })
})

describe('Slack', () => {
  it('tells operators when the post goes out and how to approve or skip it', () => {
    const window = runWindow('finde', '2026-11-20')
    expect(slackPreview('finde', window, 'CAPTION', false)).toBe(slackDraft('Este finde carousel', 'November 20 to 22', 'Thursday at 12:00', 'CAPTION'))
    expect(slackPreview('hoy', runWindow('hoy', '2026-11-18'), null, false)).toBe(slackDraft('Hoy story', 'November 18', 'Wednesday at 17:00', 'Stories have no caption.'))
    expect(slackPreview('finde', window, 'C', true)).toContain('It goes out Thursday at 12:00 unless you react ❌.')
  })

  it('gives the skip reasons', () => {
    expect(skipText({ kind: 'rejected' })).toBe('Skipped: you reacted ❌')
    expect(skipText({ kind: 'no-approval', by: baInstant('2026-11-18', 17) })).toBe('Skipped: no ✅ by 17:00')
    expect(skipText({ kind: 'too-few', count: 3 })).toBe('Skipped: only 3 events qualified')
    expect(skipText({ kind: 'late', by: baInstant('2026-11-18', 19) })).toBe('Skipped: not published by 19:00')
    expect(heldText('Cine en el Patio')).toBe('Held: Cine en el Patio was cancelled. Ask Hermes to regenerate it.')
    expect(heldText('Cine en el Patio', 'over')).toBe('Held: Cine en el Patio has already happened. Ask Hermes to regenerate it.')
    expect(slackSection).toContain(`"${heldText('{title}')}"`)
    expect(slackSection).toContain(`"${heldText('{title}', 'over')}"`)
    expect(slackSection).toContain('"not published by {HH:MM}"')
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
    const music = fill(musicTemplate!, { title: 'Intención', artist: 'Sapajou' })
    expect(slackPreview('reel', window, 'CAPTION', false, { title: 'Intención', artist: 'Sapajou' })).toBe(
      `${slackDraft('Este finde Reel', 'November 20 to 22', 'Friday at 12:00', 'CAPTION')}\n\n${music}`)
  })
})
