export interface RecommendationFraming {
  acknowledgement: string
  nextStep: string
}

const MAX_LINE = 240
const URL = /(?:https?:\/\/|www\.)/i
const MARKER = /^(ACK|NEXT)\s*:/i
const BULLET = /^(?:[-*•]|\d+[.)])\s*/
const DIGIT = /\d/
const CURRENCY = /[$€£¥]|\b(?:ARS|USD)\b/i

export function warmRecommendationFallback(locale: 'en' | 'es', count: number): RecommendationFraming {
  if (locale === 'es') {
    return count === 1
      ? {
          acknowledgement: 'Encontré una opción que puede ir bien para este plan.',
          nextStep: '¿Querés que te cuente más o te ayudo con indicaciones?',
        }
      : {
          acknowledgement: `Encontré ${count} opciones que pueden ir bien para este plan.`,
          nextStep: '¿Querés que te cuente más de alguna o te ayudo a elegir?',
        }
  }
  return count === 1
    ? {
        acknowledgement: 'I found an option that could work well for this.',
        nextStep: 'Want details on it, or should I help with directions?',
      }
    : {
        acknowledgement: `I found ${count} options that could work well for this.`,
        nextStep: 'Want details on one, or should I help you narrow it down?',
      }
}

function cleanLine(value: string): string {
  return value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/[ \t]+/g, ' ').trim()
}

function containsReturnedName(value: string, events: ReadonlyArray<{ name: string }>, venueNames: string[]): boolean {
  const lower = value.toLocaleLowerCase()
  return [...events.map((event) => event.name), ...venueNames]
    .filter((name) => name.trim().length > 0)
    .some((name) => lower.includes(name.toLocaleLowerCase()))
}

function validLine(value: string, events: ReadonlyArray<{ name: string }>, venueNames: string[]): boolean {
  return value.length > 0 && value.length <= MAX_LINE && !URL.test(value) && !DIGIT.test(value) && !CURRENCY.test(value) && !BULLET.test(value) && !containsReturnedName(value, events, venueNames)
}

/** Extracts the two final-step framing lines; everything else is rejected. */
export function extractRecommendationFraming(
  text: string,
  events: ReadonlyArray<{ name: string }>,
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

export function removeFramingMarkers(value: string): string {
  const lines = value.replace(/\r\n?/g, '\n').split('\n')
  return lines.length === 2 && lines.every((line) => MARKER.test(line)) ? '' : value.trim()
}
