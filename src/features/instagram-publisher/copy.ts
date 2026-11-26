/** Every word the posts and the Slack messages use, built from copy.md (committed next to this file). */
import { WEEKDAYS_EN, baLocal, dateRange, englishDates, hhmm, longDate, weekdayDay } from './format.ts'
import { FORMATS, type FormatKey, type RunWindow } from './formats.ts'
import type { PostEvent } from './select.ts'

/** The carousels' closing slide. The body names what the post is saved for. */
export const CLOSING = {
  headline: '¿A cuál vas?',
  body: { finde: 'Contanos en los comentarios y guardá el post para el finde.', gratis: 'Contanos en los comentarios y guardá el post para la semana.' },
  lead: 'Todos los planes, gratis y sin registrarte:',
  button: 'baeventos.com',
  footer: 'Link en la bio',
} as const

export const REEL_CLOSING = { headline: 'Encontrá más planes', button: 'baeventos.com', footer: 'Link en la bio' } as const

export const HOY_CLOSING = {
  headline: 'Más planes para hoy',
  body: 'Buscá por día, barrio o presupuesto en baeventos.com. Gratis y sin registrarte.',
  footer: 'baeventos.com',
} as const

/** The site's address, on the right of a Hoy event frame's footer. */
export const SITE = 'baeventos.com'

/** A cover's words. Gratis has two headline lines, the first set much larger. The Reel's cover has no footer. */
export interface Cover { kicker: string; headline: [string, string] | [string]; footer: string | null }

export function cover(format: FormatKey, window: RunWindow, count: number): Cover {
  const range = dateRange(window.from, window.to)
  switch (format) {
    case 'hoy': return { kicker: `Hoy · ${longDate(window.from)}`, headline: [`${count} planes para esta noche`], footer: SITE }
    case 'finde': return { kicker: range, headline: [`${count} planes independientes para este finde`], footer: 'Deslizá →' }
    case 'gratis': return { kicker: range, headline: ['Gratis', `${count} planes esta semana`], footer: 'Deslizá →' }
    case 'reel': return { kicker: range, headline: [`${count} planes para este finde en Buenos Aires`], footer: null }
  }
}

/** The card kicker: "Hoy · 21:00" in a story, "Viernes 20 · 21:00" in a carousel or the Reel. CSS sets it in caps. */
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
export function caption(format: FormatKey, window: RunWindow, events: PostEvent[], credit: string | null = null): string | null {
  if (format === 'hoy') return null
  const free = format === 'gratis'
  const range = dateRange(window.from, window.to)
  return [
    `Qué hacer ${free ? 'gratis en Buenos Aires esta semana' : 'este finde en Buenos Aires'}: ${events.length} planes de cultura independiente, ${range}.`,
    ...events.map(event => eventLine(format, event)),
    `Guardá este post para ${free ? 'la semana' : 'el finde'} y mandáselo a quien te acompañe.`,
    'Más planes en baeventos.com (link en la bio).',
    ...(format === 'reel' && credit ? [credit] : []),
    `#BuenosAires #CulturaIndependiente ${free ? '#EntradaGratis' : '#AgendaCultural'}`,
  ].join('\n\n')
}

/** `track` names the Reel's music: the message ends with `Music: "{title}" by {artist}.` */
export function slackPreview(format: FormatKey, window: RunWindow, captionText: string | null, mode: boolean | 'review-hold' | 'closed', track?: { title: string; artist: string }): string {
  const at = baLocal(window.publishAt)
  const when = `${WEEKDAYS_EN[at.weekday]} at ${hhmm(at)}`
  const gate = mode === 'closed' ? 'Instagram is no longer waiting for approval.'
    : mode === 'review-hold' ? 'Review is blocking automatic publishing for now. It can still publish automatically if the review passes. React ✅ to approve this version or ❌ to skip it.'
      : mode ? `It goes out ${when} unless you react ❌.` : `It goes out ${when} once you react ✅. React ❌ to skip it.`
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

/** Human-readable summary for the CLI dry run, not a Slack notification. */
export function tooFewText(format: FormatKey, window: RunWindow, count: number): string {
  return `Instagram draft: ${FORMATS[format].slackName} for ${englishDates(window.from, window.to)}. ${skipText({ kind: 'too-few', count })}`
}

export const postedText = (permalink: string) => `Posted: ${permalink}`
export const skippedMentionsText = (handles: string[]) => `Skipped Instagram mentions (no exact username match): ${Array.from(new Set(handles), handle => `@${handle}`).join(', ')}.`
