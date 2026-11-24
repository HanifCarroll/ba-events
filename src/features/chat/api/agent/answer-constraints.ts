import type { ChatEventPayload } from '#shared/lib/types.ts'
import { normalizeText } from '#shared/lib/utils/normalize-text.ts'

const OTHER_OPTIONS = /\b(?:alternatives|(?:an|one) alternative|alternative options?|(?:other|more) options?|another option|something else|what else(?: is on| is there)?|opciones alternativas?|alternativas?|otras? opciones?|algo (?:distinto|diferente|mas$)|que mas hay)\b/i

export function asksForAlternatives(text: string): boolean {
  return OTHER_OPTIONS.test(normalizeText(text.replace(/"[^"]*"|“[^”]*”|«[^»]*»/g, '')))
}

/** Remove the pagination instruction, not a preference like "alternative rock". */
export function withoutAlternatives(text: string | undefined): string | undefined {
  if (!text || !asksForAlternatives(text)) return text
  return normalizeText(text)
    .replace(/^\s*(?:show me(?: a few| some)?|show|give me(?: a few| some)?|muestrame(?: algunas)?|mostrame(?: algunas)?|dame(?: algunas)?)\s+/i, '')
    .replace(new RegExp(OTHER_OPTIONS.source, 'gi'), '')
    .replace(/\s+/g, ' ').trim() || undefined
}

const CLOCK = /\b(?:[01]?\d|2[0-3])[:.]\d{2}\b|\b\d{1,2}(?::\d{2})?\s*(?:[ap]\.?\s*m\b\.?|hs?\b)|(?<=\bat |\baround |\ba las? |\bsobre las? )\d{1,2}(?![\d,.:])\b|\b(?:midnight|noon|medianoche|mediod[ií]a)\b/gi
const START = /\b(?:starts?|begins?|kicks? off|doors? open|arranca|empieza|comienza|abren las puertas)\s+(?:at|around|by|before|after|in the|a las?|sobre las?|por la|despu[eé]s de)\b/i
const LISTING = /^(?:(?:the|its) (?:listing|description|source) (?:says|lists|mentions|notes)|according to (?:the|its) (?:listing|description|source)|(?:la descripci[oó]n|la publicaci[oó]n|el anuncio|la ficha) (?:dice|indica|menciona)|seg[uú]n (?:la descripci[oó]n|la publicaci[oó]n|el anuncio|la ficha))\b/i

/** For unknown-time cards, only permit a clock time from an attributed source clause. */
export function hasUnsupportedTime(text: string, events: ChatEventPayload[]): boolean {
  const uncertain = events.filter(event => event.time_tba)
  if (!uncertain.length) return false
  return text.split(/(?<=[.!?])\s+|[;\n]+/).some(clause => {
    const clocks = [...clause.matchAll(CLOCK)].map(([time]) => normalizeText(time))
    if (!clocks.length && !START.test(clause)) return false
    if (!LISTING.test(clause.trim()) || !clocks.length) return true
    return !uncertain.some(event => {
      const description = event.description_en || event.description_es
        ? [event.description_en, event.description_es]
        : [event.description_display_en, event.description_display_es, event.description_summary_en, event.description_summary_es]
      const listed = description.flatMap(value => [...(value ?? '').matchAll(CLOCK)].map(([time]) => normalizeText(time)))
      return clocks.every(time => listed.includes(time))
    })
  })
}
