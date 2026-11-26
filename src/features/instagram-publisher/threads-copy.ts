import { addDays, baInstant, baLocal, displayTitle, hhmm } from './format.ts'
import type { FormatKey } from './formats.ts'
import type { PostEvent } from './select.ts'

export type ThreadsFormat = Exclude<FormatKey, 'reel'>
export const isThreadsFormat = (format: FormatKey): format is ThreadsFormat => format !== 'reel'

export function threadsWindow(format: ThreadsFormat, from: string) {
  switch (format) {
    case 'hoy': return { publishAt: baInstant(from, 11, 30), cutoff: baInstant(from, 17) }
    case 'finde': return { publishAt: baInstant(addDays(from, -1), 12), cutoff: baInstant(from, 12) }
    case 'gratis': return { publishAt: baInstant(from, 12), cutoff: baInstant(addDays(from, 1), 12) }
  }
}

const words = {
  hoy: { min: 2, intro: (n: number) => `Hoy en Buenos Aires, ${n} planes de cultura independiente:`, link: 'Toda la agenda de hoy: baeventos.com' },
  finde: { min: 3, intro: (n: number) => `Este finde en Buenos Aires: ${n} planes de cultura independiente.`, link: 'Horarios, precios y direcciones: baeventos.com' },
  gratis: { min: 3, intro: (n: number) => `Gratis esta semana en Buenos Aires: ${n} planes.`, link: 'Lista completa: baeventos.com' },
}
const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const plain = (text: string) => text.replace(/\p{RGI_Emoji}/gv, '')
  .replace(/#(?=[\p{L}\p{N}_])/gu, '')
  .replace(/(?<![\p{L}\p{M}\p{N}_])@+(?=[\p{L}\p{N}_])/gu, '')
  .replace(/\s+/g, ' ').trim()
const venueKey = (name: string) => name.normalize('NFD').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

function withoutVenue(title: string, venue: string) {
  const key = venueKey(venue)
  for (const dash of title.matchAll(/\s+[-–]\s+/gu)) {
    const afterDash = dash.index + dash[0].length
    if (key && venueKey(title.slice(afterDash)) === key) return displayTitle(title.slice(0, dash.index))
  }
  return title
}

function eventLine(format: ThreadsFormat, event: PostEvent, shorten: boolean) {
  const local = baLocal(event.startsAt)
  const time = `${format === 'hoy' ? '' : `${days[local.weekday]} `}${hhmm(local)}`
  const venue = plain(displayTitle(event.venue, false))
  const title = withoutVenue(plain(event.title), venue)
  const chars = [...title]
  const label = shorten && chars.length > 40 ? `${chars.slice(0, 39).join('').trimEnd()}…` : title
  const price = format !== 'gratis' && event.price ? ` · ${event.price}` : ''
  return `${time} · ${label} · ${venue}, ${plain(event.barrio)}${price}`
}

/** Returns null if the minimum can't fit without cutting more than the copy rules allow. */
export function threadsText(format: ThreadsFormat, events: PostEvent[]): string | null {
  const { min, intro, link } = words[format]
  if (events.length < min) return null
  const picks = [...events].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
  const build = (shorten: boolean) => `${intro(picks.length)}\n\n${picks.map(event => eventLine(format, event, shorten)).join('\n')}\n\n${link}`
  const fits = (text: string) => [...text].length <= 500
  while (true) {
    const text = build(false)
    if (fits(text)) return text
    if (picks.length === min) break
    const byDay = new Map<string, number>()
    for (const event of picks) byDay.set(event.date, (byDay.get(event.date) ?? 0) + 1)
    const most = Math.max(...byDay.values())
    if (most === 1) break
    picks.splice(picks.findLastIndex(event => byDay.get(event.date) === most), 1)
  }
  while (true) {
    const text = build(true)
    if (fits(text)) return text
    if (picks.length === min) return null
    picks.pop()
  }
}

export function threadsPreview(text: string, slot: Date, mode: boolean | 'review-hold' = false, sharedApproval = true) {
  const time = hhmm(baLocal(slot))
  const gate = mode === 'review-hold' ? 'puede publicarse automáticamente si pasa la revisión; reaccioná ✅ para aprobar esta versión o ❌ para omitirla'
    : mode ? `se publica solo a las ${time} salvo que reacciones ❌`
      : `se publica con ${sharedApproval ? 'el mismo ✅' : 'un ✅ en este mensaje'}, ${time}`
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  // Slack only decodes &amp;, &lt;, and &gt;. Quote a code block for literal styling delimiters;
  // split any embedded triple backticks with a zero-width space so they cannot close the block.
  const quote = /[*_~`]/u.test(escaped)
    ? `>>> \`\`\`\n${escaped.replace(/`(?=``)/g, '`\u200b')}\n\`\`\``
    : escaped.split('\n').map(line => `> ${line}`).join('\n')
  return `\n\nThreads (${gate}):\n${quote}`
}

export const threadsPreviousRevision = 'Threads ya se publicó con la versión anterior.'

export const threadsReplies = {
  published: (permalink: string) => `Threads: publicado ${permalink}`,
  cutoff: (by: Date) => `Threads: omitido, no se publicó antes de las ${hhmm(baLocal(by))}.`,
  rejected: 'Threads: omitido, reaccionaste ❌.',
  held: (title: string) => `Threads: retenido, ${title} cambió (se canceló, ya pasó o salió de la agenda).`,
  failed: (reason: string) => `Threads: falló (${reason}). Hermes lo revisa.`,
}
