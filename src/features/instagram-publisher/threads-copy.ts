import { addDays, baInstant, baLocal, hhmm } from './format.ts'
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
const plain = (text: string) => text.replace(/\p{RGI_Emoji}/gv, '').replace(/#(?=[\p{L}\p{N}_])/gu, '').replace(/\s+/g, ' ').trim()

function eventLine(format: ThreadsFormat, event: PostEvent, shorten: boolean) {
  const local = baLocal(event.startsAt)
  const time = `${format === 'hoy' ? '' : `${days[local.weekday]} `}${hhmm(local)}`
  const title = plain(event.title)
  const chars = [...title]
  const label = shorten && chars.length > 40 ? `${chars.slice(0, 39).join('').trimEnd()}…` : title
  const price = format !== 'gratis' && event.price ? ` · ${event.price}` : ''
  return `${time} · ${label} · ${plain(event.venue)}, ${plain(event.barrio)}${price}`
}

/** Returns null if the minimum can't fit without cutting more than the copy rules allow. */
export function threadsText(format: ThreadsFormat, events: PostEvent[]): string | null {
  const { min, intro, link } = words[format]
  if (events.length < min) return null
  const build = (n: number, shorten: boolean) => `${intro(n)}\n\n${events.slice(0, n).map(event => eventLine(format, event, shorten)).join('\n')}\n\n${link}`
  const fits = (text: string) => [...text].length <= 500
  for (let n = events.length; n >= min; n--) {
    const text = build(n, false)
    if (fits(text)) return text
  }
  const text = build(min, true)
  return fits(text) ? text : null
}

export function threadsPreview(text: string, slot: Date) {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `\n\nThreads (se publica con el mismo ✅, ${hhmm(baLocal(slot))}):\n${escaped.split('\n').map(line => `> ${line}`).join('\n')}`
}

export const threadsReplies = {
  published: (permalink: string) => `Threads: publicado ${permalink}`,
  cutoff: (by: Date) => `Threads: omitido, no se publicó antes de las ${hhmm(baLocal(by))}.`,
  rejected: 'Threads: omitido, reaccionaste ❌.',
  held: (title: string) => `Threads: retenido, ${title} se canceló o ya pasó.`,
  failed: (reason: string) => `Threads: falló (${reason}). Hermes lo revisa.`,
}
