import type { ChatEventPayload } from '#shared/lib/types.ts'
import { normalizeText } from '#shared/lib/utils/normalize-text.ts'

export const ALTERNATIVES_PROMPT = {
  en: 'show me a few alternative options',
  es: 'muéstrame algunas opciones alternativas',
} as const

// Full utterances only: an extra neighborhood, date, genre, or task goes to the planner.
const BARE_ALTERNATIVES = /^(?:(?:can you |could you )?(?:show(?: me)?|give me) |is there |(?:mostrame|muestrame|dame|ver) )?(?:(?:any |some )?(?:other|more) options|another option|alternatives|something else|what else(?: is on| is there)?|mas opciones|otras opciones|otra opcion|alternativas|algo (?:distinto|diferente|mas)|que mas hay)(?: please| por favor)?$/

export function asksForAlternatives(text: string): boolean {
  const normalized = normalizeText(text)
  return normalized === ALTERNATIVES_PROMPT.en || normalized === normalizeText(ALTERNATIVES_PROMPT.es) || BARE_ALTERNATIVES.test(normalized)
}

const CLOCK = /\b\d{1,2}(?::\d{2})?\s*(?:[ap]\.?\s*m\b\.?|hs?\b)|\b(?:[01]?\d|2[0-3])[:.]\d{2}\b|(?<=\bat |\baround |\ba las? |\bsobre las? )\d{1,2}(?![\d,.:])\b|\b(?:midnight|noon|medianoche|mediod[ií]a)\b/gi
const START = /\b(?:starts?|begins?|kicks? off|doors? open|arranca|empieza|comienza|abren las puertas)\s+(?:at|around|by|before|after|in the|a las?|sobre las?|por la|despu[eé]s de)\b/i
const LISTING = /\b(?:(?:the|its) (?:listing|description|source) (?:says|lists|mentions|notes)|according to (?:the|its) (?:listing|description|source)|(?:la descripci[oó]n|la publicaci[oó]n|el anuncio|la ficha) (?:dice|indica|menciona)|seg[uú]n (?:la descripci[oó]n|la publicaci[oó]n|el anuncio|la ficha))\b/i
const LABEL = /\b(?:(doors?|puertas?|apertura de sala)|(start(?:s|ing)?|begins?|kick off|inicio|arranca|empieza|comienza)|(ends?|ending|fin|termina|finaliza))\b/g

type ClockClaim = { time: string; label: 'doors' | 'start' | 'end' | 'unspecified'; index: number }

function clockKey(value: string): string {
  const text = value.toLowerCase()
  if (/^(midnight|medianoche)$/.test(text)) return '00:00'
  if (/^(noon|mediod[ií]a)$/.test(text)) return '12:00'
  const clock = /^(\d{1,2})(?:[:.](\d{2}))?\s*(?:([ap])\.?\s*m\.?|hs?)?$/.exec(text)
  if (!clock) return text
  const hour = Number(clock[1])
  const hours = clock[3] && hour >= 1 && hour <= 12 ? hour % 12 + (clock[3] === 'p' ? 12 : 0) : hour
  return `${String(hours).padStart(2, '0')}:${clock[2] ?? '00'}`
}

function clockClaims(text: string): ClockClaim[] {
  let previousEnd = 0
  return [...text.matchAll(CLOCK)].map<ClockClaim>(match => {
    // A new time gets its own label; a doors claim cannot support a start claim.
    const label = [...normalizeText(text.slice(previousEnd, match.index)).matchAll(LABEL)].at(-1)
    previousEnd = match.index + match[0].length
    return { time: clockKey(match[0]), index: match.index,
      label: label?.[1] ? 'doors' : label?.[2] ? 'start' : label?.[3] ? 'end' : 'unspecified' }
  })
}

function supportsTime(text: string, claim: ClockClaim, event: ChatEventPayload): boolean {
  if (!LISTING.test(text.slice(0, claim.index))) return false
  const descriptions = event.description_en || event.description_es
    ? [event.description_en, event.description_es]
    : [event.description_display_en, event.description_display_es, event.description_summary_en, event.description_summary_es]
  return descriptions.some(description => clockClaims(description ?? '').some(source => source.time === claim.time && source.label === claim.label))
}

/** A recommendation reason has exactly one server-selected subject. */
export function hasUnsupportedTime(text: string, event: ChatEventPayload): boolean {
  if (!event.time_tba) return false
  const claims = clockClaims(text)
  return claims.length ? claims.some(claim => !supportsTime(text, claim, event)) : START.test(text)
}

const sentences = {
  en: new Intl.Segmenter('en', { granularity: 'sentence' }),
  es: new Intl.Segmenter('es', { granularity: 'sentence' }),
}

const IMPLICIT_EVENT_TIME = /^(?:it(?:s)?\b|the (?:show|event|doors?)\b|doors?\b|at\b|(?:el evento|el show|las puertas|a las?)\b)/i

function mentionIndex(text: string, name: string): number {
  return name ? ` ${text} `.lastIndexOf(` ${name} `) : -1
}

/** Check each sentence against its named event, or the current unambiguous subject. */
export function neutralizeUnsupportedTimes(text: string, events: ChatEventPayload[], locale: 'en' | 'es', preview: boolean, focus?: ChatEventPayload): string {
  if (!events.some(event => event.time_tba)) return text
  const named = [...new Map(events.map(event => [event.id, { event, name: normalizeText(event.name) }])).values()]
  let subject = focus ?? (named.length === 1 ? named[0].event : undefined)
  const fallback = locale === 'es' ? 'La publicación no confirma la hora de inicio.' : 'The listing doesn’t confirm a start time.'
  return [...sentences[locale].segment(text)].map(({ segment }) => {
    const sentence = normalizeText(segment)
    const mentioned = named.filter(({ name }) => mentionIndex(sentence, name) >= 0)
    const subjectAt = (index: number) => {
      const prefix = normalizeText(segment.slice(0, index))
      const latest = mentioned.map(item => ({ ...item, index: mentionIndex(prefix, item.name) }))
        .filter(item => item.index >= 0).sort((a, b) => b.index - a.index || b.name.length - a.name.length)[0]
      return latest?.event ?? (mentioned.length === 1 ? mentioned[0].event : mentioned.length ? undefined : subject)
    }
    const start = segment.search(START)
    // A bare clock in an unrelated sentence (for example, transit hours) is
    // not a claim about the previous event just because it follows one.
    const concernsEvent = mentioned.length > 0 || start >= 0 || LISTING.test(segment) || IMPLICIT_EVENT_TIME.test(segment.trim())
    const claims = concernsEvent ? clockClaims(segment) : []
    const unsupported = claims.length ? claims.some(claim => {
      const event = subjectAt(claim.index)
      return event?.time_tba && !supportsTime(segment, claim, event)
    }) : start >= 0 && subjectAt(start)?.time_tba
    if (mentioned.length) subject = subjectAt(segment.length)
    return unsupported ? preview ? '' : `${fallback}${segment.match(/\s*$/)?.[0] ?? ''}` : segment
  }).join('').trim()
}
