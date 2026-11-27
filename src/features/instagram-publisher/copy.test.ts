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
const field = (block: string, name: string) => {
  const line = block.split('\n').find(line => new RegExp(`^- ${name}[:,]`).test(line.trimStart()))!
  return Array.from(line.matchAll(/"([^"]+)"/g), ([, text]) => text!)
}
const fill = (template: string, values: Record<string, string>) =>
  template.replace(/\{([^{}]+)\}/g, (placeholder, key: string) => values[key] ?? placeholder)
const captionSections = (heading: string, values: Record<string, string>) =>
  fill(section(heading).split('\n```\n')[1]!, values).split('\n\n')
const approvedCover = (heading: string, values: Record<string, string>) => {
  const block = section(heading).split('**Cover')[1]!.split('\n\n')[0]!
  return {
    kicker: fill(field(block, 'Kicker')[0]!, values),
    headline: field(block, 'Headline').map(line => fill(line, values)),
    footer: block.includes('- Footer:') ? field(block, 'Footer')[0]! : null,
  }
}
const slackSection = section('Slack preview message')
const [, draftTemplate, , musicTemplate] = slackSection.split('\n```\n')
const slackDraft = (name: string, dates: string, publish: string, body: string) => {
  expect(slackSection).toContain(`"${name}"`)
  return fill(draftTemplate!.replace('{Weekday} at {HH:MM}', publish), {
    'Format name': name, dates, 'caption, or "Stories have no caption." for Hoy': body,
  })
}

const post = (date: string, time: string, title: string, handle: string | null, barrio: string, price: string | null, venue = 'Sala', via = false): PostEvent =>
  ({ id: title, date, startsAt: '', title, time, description: null, venue, barrio, price, handle, artworkRef: null, via })

const weekend: PostEvent[] = [
  post('2026-11-20', '21:00', 'Trío del Patio', 'patio.ejemplo', 'San Cristóbal', '$15.000'),
  post('2026-11-21', '11:00 a 16:30', 'Cine en el Patio', 'cine_ejemplo', 'Saavedra', 'Gratis'),
  post('2026-11-21', '21:30', 'Canciones en el Taller', 'taller_ejemplo', 'Villa General Mitre', 'A la gorra'),
  post('2026-11-22', '14:00', 'Feria del Andén', null, 'Parque Patricios', 'Gratis', 'Sala del Andén'),
  post('2026-11-22', '17:00', 'Taller de Papel', 'papel_ejemplo', 'Almagro', 'Gratis'),
  post('2026-11-22', '20:00', 'Dúo de la Plaza', null, 'Parque Patricios', null, 'Sala del Andén'),
]

describe('Este finde', () => {
  const window = runWindow('finde', '2026-11-20')

  it('opens with the search hook, lists each event in order with its ticket terms, and closes with the save ask, the link, and three hashtags', () => {
    const lines = caption('finde', window, weekend)?.split('\n\n')
    const [intro, , ...closing] = captionSections('2. Este finde', { N: '6', 'date range': '20 al 22 de noviembre' })
    expect(closing).toHaveLength(3)
    expect(lines?.[0]).toBe(intro)
    expect(lines?.slice(1, -3)).toEqual([
      'Viernes 20, 21:00. Trío del Patio en @patio.ejemplo, San Cristóbal. $15.000.',
      'Sábado 21, 11:00 a 16:30. Cine en el Patio en @cine_ejemplo, Saavedra. Gratis.',
      'Sábado 21, 21:30. Canciones en el Taller en @taller_ejemplo, Villa General Mitre. A la gorra.',
      'Domingo 22, 14:00. Feria del Andén en Sala del Andén, Parque Patricios. Gratis.',
      'Domingo 22, 17:00. Taller de Papel en @papel_ejemplo, Almagro. Gratis.',
      'Domingo 22, 20:00. Dúo de la Plaza en Sala del Andén, Parque Patricios.',
    ])
    expect(lines?.slice(-3)).toEqual(closing)
  })

  it('formats the dates and pick count on the cover and cards', () => {
    expect(cover('finde', window, weekend.length)).toEqual(approvedCover('2. Este finde', {
      'date range Friday to Sunday': '20 al 22 de noviembre', N: '6',
    }))
    expect(cardKicker('finde', weekend[1]!)).toBe('Sábado 21 · 11:00 a 16:30')
  })
})

describe('Gratis esta semana', () => {
  it('counts five free picks and leaves prices out of the event lines', () => {
    const window = runWindow('gratis', '2026-11-30')
    const free = weekend.slice(0, 5).map(event => ({ ...event, price: 'Gratis' }))
    const sections = caption('gratis', window, free)!.split('\n\n')
    const [intro, , ...closing] = captionSections('3. Gratis esta semana', { N: '5', 'date range': '30 de noviembre al 6 de diciembre' })
    expect(sections[0]).toBe(intro)
    const events = sections.slice(1, -3)
    expect(events).toHaveLength(5)
    expect(events[0]).toBe('Viernes 20, 21:00. Trío del Patio en @patio.ejemplo, San Cristóbal.')
    expect(events.join('\n')).not.toContain('Gratis')
    expect(sections.slice(-3)).toEqual(closing)
    const expected = approvedCover('3. Gratis esta semana', { 'date range Monday to Sunday': '30 de noviembre al 6 de diciembre', N: '5' })
    expect(expected.headline).toEqual(['Gratis', '5 planes esta semana'])
    expect(cover('gratis', window, free.length)).toEqual(expected)
  })
})

it('writes no English in any caption', () => {
  expect(approved).toContain('The English caption line is removed')
  for (const format of ['finde', 'gratis', 'reel'] as const) {
    const text = caption(format, runWindow(format, format === 'gratis' ? '2026-11-23' : '2026-11-20'), weekend, 'Música: "Intención" de Sapajou.')!
    expect(text).not.toMatch(/\b(events?|this week|weekend|More at|free)\b/i)
  }
})

it('renders the approved closing copy on the last carousel and Hoy frames', () => {
  const assets = { fontsDir: '/fonts', logo: '/logo.svg' }
  for (const { format, day, events, heading, other, fields } of [
    { format: 'finde', day: '2026-11-20', events: weekend, heading: '- **Closing slide** (carousels):', other: 'Body (Gratis)', fields: 5 },
    { format: 'gratis', day: '2026-11-23', events: weekend, heading: '- **Closing slide** (carousels):', other: 'Body (Este finde)', fields: 5 },
    { format: 'hoy', day: '2026-11-22', events: weekend.slice(-3), heading: '**Closing frame**', other: '', fields: 3 },
  ] as const) {
    const section = approved.split(`${heading}\n`)[1]?.split(/\n\n|\n- \*\*/)[0] ?? ''
    const lines = Array.from(section.matchAll(/^\s*- ([^:"]+): "(.+)"$/gm)).filter(([, name]) => name !== other).map(([, , text]) => text)
    expect(lines, heading).toHaveLength(fields)
    const $ = load(framesHtml(format, runWindow(format, day), events, assets))
    const closing = $('.s').last()
    expect(closing.find('[data-role]').map((_, node) => $(node).text().trim()).get(), format).toEqual(lines)
  }
})

describe('a handle that is the posting account, not the venue', () => {
  const festival = post('2026-11-27', '19:30', 'Festival del Puente', 'agenda.ejemplo', 'Recoleta', 'Gratis', 'Sala del Puente', true)
  const tango = post('2026-11-27', '18:00', 'Tango del Andén', 'tango.ejemplo', 'Monserrat', '$5.000', 'Sala del Andén', true)
  const shared = section('Shared pieces')

  it('names the venue and credits the full dotted account with "Vía"', () => {
    const [template] = field(shared, 'Caption line')
    const withoutPrice = template!.replace('{Price}. ', '')
    const fields = (event: PostEvent) => ({
      Weekday: 'Viernes', d: '27', time: event.time, Title: event.title, Venue: event.venue,
      Barrio: event.barrio, Price: event.price ?? '', handle: event.handle!,
    })
    expect(eventLine('finde', tango)).toBe(fill(template!, fields(tango)))
    expect(eventLine('gratis', festival)).toBe(fill(withoutPrice, fields(festival)))
    expect(eventLine('finde', { ...tango, price: null })).toBe(fill(withoutPrice, fields(tango)))
  })

  it('writes "Vía @handle" in the footer, and "@handle" for the venue\'s own account', () => {
    const [curator, venue] = field(shared, 'Card and frame footer')
    expect(footerHandle(festival)).toBe(fill(curator!, { handle: 'agenda.ejemplo' }))
    expect(footerHandle(weekend[0]!)).toBe(fill(venue!, { handle: 'patio.ejemplo' }))
    expect(footerHandle(weekend[5]!)).toBe('')
  })
})

describe('Hoy', () => {
  it('has a cover, cards, and no caption', () => {
    const window = runWindow('hoy', '2026-11-18')
    expect(cover('hoy', window, 3)).toEqual(approvedCover('1. Hoy', {
      Weekday: 'Miércoles', d: '18', mes: 'noviembre', N: '3',
    }))
    expect(cardKicker('hoy', weekend[0]!)).toBe('Hoy · 21:00')
    expect(caption('hoy', window, weekend)).toBeNull()
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

  it('uses the carousel caption word for word, with a credit line between "Más planes" and the hashtags when the track has one', () => {
    const finde = caption('finde', runWindow('finde', '2026-11-20'), weekend)!
    expect(caption('reel', window, weekend)).toBe(finde)
    const credited = caption('reel', window, weekend, 'Música: "Intención" de Sapajou (auboutdufil.com), CC BY 3.0.')!
    expect(credited).toBe(finde.replace('Más planes en baeventos.com (link en la bio).\n\n#',
      'Más planes en baeventos.com (link en la bio).\n\nMúsica: "Intención" de Sapajou (auboutdufil.com), CC BY 3.0.\n\n#'))
  })

  it('has its own cover headline and no footer', () => {
    const block = section('4. Este finde Reel')
    expect(cover('reel', window, 6)).toEqual({
      kicker: '20 al 22 de noviembre',
      headline: [fill(field(block.split('**Cover card**')[1]!, 'Headline')[0]!, { N: '6' })],
      footer: null,
    })
    expect(cardKicker('reel', weekend[1]!)).toBe('Sábado 21 · 11:00 a 16:30')
  })

  it('previews with the Reel name, Friday 12:00, and the track line last', () => {
    const music = fill(musicTemplate!, { title: 'Intención', artist: 'Sapajou' })
    expect(slackPreview('reel', window, 'CAPTION', false, { title: 'Intención', artist: 'Sapajou' })).toBe(
      `${slackDraft('Este finde Reel', 'November 20 to 22', 'Friday at 12:00', 'CAPTION')}\n\n${music}`)
  })
})
