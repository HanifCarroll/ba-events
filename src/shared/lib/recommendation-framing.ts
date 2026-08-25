export interface RecommendationFraming {
  acknowledgement: string
  nextStep: string
}

export interface RecommendationResponse {
  framing: RecommendationFraming
  reasons: string[]
}

const MAX_LINE = 240
const MAX_REASON = 180
const URL = /(?:https?:\/\/|www\.)/i
const MARKER = /^(ACK|NEXT)\s*:/i
const REASON_MARKER = /^REASON_(\d+)\s*:/i
const BULLET = /^(?:[-*•]|\d+[.)])\s*/
const DIGIT = /\d/
const CURRENCY = /[$€£¥]|\b(?:ARS|USD)\b/i
const CONTROL = /[\u0000-\u001F\u007F]/

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
  return value.replace(/[ \t]+/g, ' ').trim()
}

function containsReturnedName(value: string, events: ReadonlyArray<{ name: string }>, venueNames: string[]): boolean {
  const lower = value.toLocaleLowerCase()
  return [...events.map((event) => event.name), ...venueNames]
    .filter((name) => name.trim().length > 0)
    .some((name) => lower.includes(name.toLocaleLowerCase()))
}

function validLine(value: string, events: ReadonlyArray<{ name: string }>, venueNames: string[]): boolean {
  return value.length > 0 && value.length <= MAX_LINE && !CONTROL.test(value) && !URL.test(value) && !DIGIT.test(value) && !CURRENCY.test(value) && !BULLET.test(value) && !containsReturnedName(value, events, venueNames)
}

export function isValidRecommendationReason(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_REASON && !CONTROL.test(value) && !URL.test(value) && !CURRENCY.test(value) && !BULLET.test(value)
}

function normalizeRecommendationReason(value: string): string | null {
  const cleaned = cleanLine(value)
  if (!cleaned || cleaned.length > MAX_LINE || CONTROL.test(cleaned) || URL.test(cleaned) || CURRENCY.test(cleaned) || BULLET.test(cleaned)) return null
  if (cleaned.length <= MAX_REASON) return cleaned
  const shortened = cleaned.slice(0, MAX_REASON - 1).replace(/\s+\S*$/, '').trim()
  return `${shortened || cleaned.slice(0, MAX_REASON - 1)}…`
}

function extractFramingLines(lines: string[], events: ReadonlyArray<{ name: string }>, venueNames: string[]): RecommendationFraming | null {
  if (lines.length !== 2 || !lines.every((line) => MARKER.test(line))) return null
  const ack = lines.filter((line) => /^ACK\s*:/i.test(line))
  const next = lines.filter((line) => /^NEXT\s*:/i.test(line))
  if (ack.length !== 1 || next.length !== 1 || lines.some((line) => CONTROL.test(line))) return null
  const acknowledgement = cleanLine(ack[0].replace(/^ACK\s*:\s*/i, ''))
  const nextStep = cleanLine(next[0].replace(/^NEXT\s*:\s*/i, ''))
  return validLine(acknowledgement, events, venueNames) && validLine(nextStep, events, venueNames)
    ? { acknowledgement, nextStep }
    : null
}

/** Extracts the two final-step framing lines; everything else is rejected. */
export function extractRecommendationFraming(
  text: string,
  events: ReadonlyArray<{ name: string }>,
  venueNames: string[] = [],
): RecommendationFraming | null {
  return extractFramingLines(text.replace(/\r\n?/g, '\n').split('\n').filter((line) => line.trim()), events, venueNames)
}

/** Parses exact ACK/NEXT markers plus one uniquely keyed REASON_n per event. */
export function extractRecommendationResponse(
  text: string,
  events: ReadonlyArray<{ name: string }>,
  venueNames: string[] = [],
): RecommendationResponse | null {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((line) => line.trim())
  if (lines.length !== events.length + 2) return null
  const framing = extractFramingLines(lines.filter((line) => MARKER.test(line)), events, venueNames)
  if (!framing) return null

  const reasons = new Map<number, string>()
  for (const line of lines.filter((candidate) => !MARKER.test(candidate))) {
    const marker = line.match(REASON_MARKER)
    if (!marker || CONTROL.test(line)) return null
    const ordinal = Number(marker[1])
    const reason = normalizeRecommendationReason(line.replace(REASON_MARKER, ''))
    if (ordinal < 1 || ordinal > events.length || reasons.has(ordinal) || !reason) return null
    reasons.set(ordinal, reason)
  }
  if (reasons.size !== events.length) return null
  return { framing, reasons: events.map((_, index) => reasons.get(index + 1)!) }
}

/** Parses exactly one deterministic reason per supplied event, for pick follow-ups. */
export function extractRecommendationReasons(text: string, events: ReadonlyArray<{ name: string }>, venueNames: string[] = []): string[] | null {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((line) => line.trim())
  if (lines.length !== events.length) return null
  const reasons: string[] = []
  for (const [index, line] of lines.entries()) {
    const marker = line.match(REASON_MARKER)
    if (!marker || Number(marker[1]) !== index + 1 || CONTROL.test(line)) return null
    const reason = normalizeRecommendationReason(line.replace(REASON_MARKER, ''))
    if (!reason) return null
    reasons.push(reason)
  }
  return reasons
}

export function removeFramingMarkers(value: string): string {
  const lines = value.replace(/\r\n?/g, '\n').split('\n')
  return lines.length === 2 && lines.every((line) => MARKER.test(line)) ? '' : value.trim()
}
