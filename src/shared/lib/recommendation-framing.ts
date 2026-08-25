import type { CanonicalChatEventPayload } from './types.ts'

export interface RecommendationFraming {
  acknowledgement: string
  nextStep: string
}

const MAX_LINE = 240
const URL = /(?:https?:\/\/|www\.)/i
const MARKER = /^(ACK|NEXT)\s*:/i
const BULLET = /^(?:[-*•]|\d+[.)])\s*/

export function warmRecommendationFallback(locale: 'en' | 'es', count: number): RecommendationFraming {
  return locale === 'es'
    ? {
        acknowledgement: count === 1 ? 'Encontré una opción que puede servirte.' : `Encontré ${count} opciones para vos.`,
        nextStep: '¿Querés que te ayude con más detalles o indicaciones?',
      }
    : {
        acknowledgement: count === 1 ? 'I found an option that could work for you.' : `I found ${count} options for you.`,
        nextStep: 'Would you like help with more details or directions?',
      }
}

function cleanLine(value: string): string {
  return value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/[ \t]+/g, ' ').trim()
}

function containsReturnedName(value: string, events: CanonicalChatEventPayload[], venueNames: string[]): boolean {
  const lower = value.toLocaleLowerCase()
  return [...events.map((event) => event.name), ...venueNames]
    .filter((name) => name.trim().length > 0)
    .some((name) => lower.includes(name.toLocaleLowerCase()))
}

function validLine(value: string, events: CanonicalChatEventPayload[], venueNames: string[]): boolean {
  return value.length > 0 && value.length <= MAX_LINE && !URL.test(value) && !BULLET.test(value) && !containsReturnedName(value, events, venueNames)
}

/** Extracts the two final-step framing lines; everything else is rejected. */
export function extractRecommendationFraming(
  text: string,
  events: CanonicalChatEventPayload[],
  venueNames: string[] = [],
): RecommendationFraming | null {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const ack = lines.filter((line) => /^ACK\s*:/i.test(line))
  const next = lines.filter((line) => /^NEXT\s*:/i.test(line))
  if (lines.length !== 2 || ack.length !== 1 || next.length !== 1 || lines.some((line) => !MARKER.test(line))) return null
  const acknowledgement = cleanLine(ack[0].replace(/^ACK\s*:\s*/i, ''))
  const nextStep = cleanLine(next[0].replace(/^NEXT\s*:\s*/i, ''))
  return validLine(acknowledgement, events, venueNames) && validLine(nextStep, events, venueNames)
    ? { acknowledgement, nextStep }
    : null
}
