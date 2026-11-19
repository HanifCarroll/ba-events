/** Every word the posts and the Slack messages use, built from copy.md (committed next to this file). */
import { WEEKDAYS_EN, baLocal, dateRange, englishDates, hhmm, longDate, numberWord, weekdayDay } from './format.ts'
import { FORMATS, type FormatKey, type RunWindow } from './formats.ts'
import type { PostEvent } from './select.ts'

export const CLOSING = {
  headline: 'Encontrá más planes',
  body: 'Buscá por día, barrio o presupuesto. Gratis y sin registrarte.',
  button: 'baeventos.com',
  footer: 'Link en la bio',
} as const

/** The Reel's own words (copy.md section 4); its closing card reuses CLOSING's headline, button, and footer. */
export const REEL = {
  brand: 'BA Eventos',
  headline: ['Este finde', 'en Buenos Aires'],
} as const

export const HOY_CLOSING = {
  headline: 'Más planes para hoy',
  body: 'Buscá por día, barrio o presupuesto en baeventos.com. Gratis y sin registrarte.',
  footer: 'baeventos.com',
} as const

export interface Cover { kicker: string; headline: [string, string] | [string]; body: string; english: string | null }

export function cover(format: FormatKey, window: RunWindow, count: number): Cover {
  const n = numberWord(count, 'es')
  switch (format) {
    case 'hoy': return {
      kicker: longDate(window.from),
      headline: ['Hoy en Buenos Aires'],
      body: `${n} planes para esta noche.`,
      english: `Tonight in Buenos Aires: ${numberWord(count, 'en').toLowerCase()} independent events.`,
    }
    case 'finde': return { kicker: dateRange(window.from, window.to), headline: ['Este finde', 'en Buenos Aires'], body: `${n} planes independientes para elegir.`, english: null }
    case 'gratis': return { kicker: dateRange(window.from, window.to), headline: ['Gratis', 'esta semana'], body: `${n} planes gratis en Buenos Aires para elegir.`, english: null }
    case 'reel': throw new Error('The Reel has no frame cover; see reel/project.ts')
  }
}

/** The card kicker: "Hoy · 21:00" in a story, "Viernes 20 · 21:00" in a carousel. */
export const cardKicker = (format: FormatKey, event: PostEvent) => `${format === 'hoy' ? 'Hoy' : weekdayDay(event.date)} · ${event.time}`

/** The card footer's tag text: "@handle", or "Vía @handle" when the handle isn't the venue's own account. */
export const footerHandle = (event: Pick<PostEvent, 'handle' | 'via'>) => event.handle ? `${event.via ? 'Vía ' : ''}@${event.handle}` : ''

export function eventLine(format: FormatKey, event: PostEvent): string {
  const where = `${event.handle && !event.via ? `@${event.handle}` : event.venue}, ${event.barrio}.`
  const price = format !== 'gratis' && event.price ? ` ${event.price}.` : ''
  const via = event.handle && event.via ? ` Vía @${event.handle}.` : ''
  return `${weekdayDay(event.date)}, ${event.time}. ${event.title} en ${where}${price}${via}`
}

/** The post caption, or null for a story (stories have no caption). A Reel's is Este finde's, plus its track's credit line. */
export function caption(format: FormatKey, events: PostEvent[], credit: string | null = null): string | null {
  if (format === 'hoy') return null
  const n = events.length
  const lines = events.map(event => eventLine(format, event)).join('\n\n')
  const more = `Más planes en baeventos.com (link en la bio).${format === 'reel' && credit ? `\n\n${credit}` : ''}`
  const [intro, english] = format !== 'gratis'
    ? [`${numberWord(n, 'es')} planes independientes para este finde en Buenos Aires:`, `${numberWord(n, 'en')} independent events this weekend in Buenos Aires. More at baeventos.com.`]
    : [`${numberWord(n, 'es')} planes gratis esta semana en Buenos Aires:`, `${numberWord(n, 'en')} free events this week in Buenos Aires. More at baeventos.com.`]
  return `${intro}\n\n${lines}\n\n${more}\n\n${english}`
}

/** `track` names the Reel's music: the message ends with `Music: "{title}" by {artist}.` */
export function slackPreview(format: FormatKey, window: RunWindow, captionText: string | null, auto: boolean, track?: { title: string; artist: string }): string {
  const at = baLocal(window.publishAt)
  const when = `${WEEKDAYS_EN[at.weekday]} at ${hhmm(at)}`
  // copy.md's line says "once you react ✅", which is untrue in auto mode, so auto mode says what actually happens.
  const gate = auto ? `It goes out ${when} unless you react ❌.` : `It goes out ${when} once you react ✅. React ❌ to skip it.`
  const music = track ? `\n\nMusic: "${track.title}" by ${track.artist}.` : ''
  return `Instagram draft: ${FORMATS[format].slackName} for ${englishDates(window.from, window.to)}. ${gate}\n\n${captionText ?? 'Stories have no caption.'}${music}`
}

export type SkipReason = { kind: 'rejected' } | { kind: 'no-approval'; by: Date } | { kind: 'late'; by: Date } | { kind: 'too-few'; count: number }

export function skipText(reason: SkipReason): string {
  switch (reason.kind) {
    case 'rejected': return 'Skipped: you reacted ❌'
    case 'no-approval': return `Skipped: no ✅ by ${hhmm(baLocal(reason.by))}`
    case 'late': return `Skipped: not published by ${hhmm(baLocal(reason.by))}`
    case 'too-few': return `Skipped: only ${reason.count} events qualified`
  }
}

export const heldEventReason = { cancelled: 'was cancelled', over: 'has already happened', scope: 'is no longer marked in scope' } as const
export const heldText = (title: string, why: keyof typeof heldEventReason = 'cancelled') =>
  `Held: ${title} ${heldEventReason[why]}. Ask Hermes to regenerate it.`

/** The too-few notice is a new top-level message: there is no preview to reply to. */
export function tooFewText(format: FormatKey, window: RunWindow, count: number): string {
  return `Instagram draft: ${FORMATS[format].slackName} for ${englishDates(window.from, window.to)}. ${skipText({ kind: 'too-few', count })}`
}

export const postedText = (permalink: string) => `Posted: ${permalink}`
export const skippedMentionsText = (handles: string[]) => `Skipped Instagram mentions (no exact username match): ${Array.from(new Set(handles), handle => `@${handle}`).join(', ')}.`
