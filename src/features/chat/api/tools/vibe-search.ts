/**
 * Structured vibe scoring for the search_events tool.
 *
 * Semantic embeddings rank by topical similarity but are blind to the
 * structured signals a "vibe" ask is really about: chill/tranqui vs. techno,
 * free vs. paid, date-like, a named neighborhood, a named day. For vibe
 * queries this scorer ranks the hard-filtered candidate set (fetched in full
 * up to VIBE_CANDIDATE_CAP, Supabase's response limit — exhaustive for the
 * current corpus) in memory with deterministic bilingual (en/es) signals
 * plus soft boosts and
 * penalties, and returns FEWER than the requested limit when relevance is
 * poor — the tool must not pad results with weak matches.
 *
 * Routing (in search-events.ts): a query with a vibe signal (chill, techno,
 * energetic, free, date) or a geo/time signal (neighborhood, weekday,
 * today/tonight/tomorrow/weekend) is a vibe query. Everything else keeps the
 * semantic embedding path. No embeddings, no RRF, no LLM retries here.
 *
 * The labeled bilingual evaluation set lives in `evals/search/vibe-golden.ts`.
 */

import { getDay } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'
import { BA_TIMEZONE } from '@/shared/lib/constants'
import { NEIGHBORHOODS } from '@/shared/lib/types'
import type { ChatEventPayload, Neighborhood } from '@/shared/lib/types'
import { formatEventForClaude } from './utils'

// ============================================================================
// INTENT SIGNALS
// ============================================================================

export interface VibeIntent {
  chill: boolean
  energetic: boolean
  techno: boolean
  date: boolean
  free: boolean
  /** Canonical neighborhood name found in the query, if any. */
  neighborhood: Neighborhood | null
  /** 0-6 (JS getDay) weekday explicitly named in the query, if any. */
  dayOfWeek: number | null
  today: boolean
  tomorrow: boolean
  weekend: boolean
}

// Bilingual signal dictionaries. All matching happens on accent-stripped,
// lowercased text, so "tranquilo" / "tranqui" and "miércoles" / "miercoles"
// resolve to the same signal.
const CHILL_SIGNALS = [
  'chill',
  'relax',
  'relaxed',
  'laid back',
  'laid-back',
  'low key',
  'low-key',
  'calm',
  'easygoing',
  'easy-going',
  'cozy',
  'casual',
  'mellow',
  'unwind',
  'quiet',
  'slow',
  'tranqui',
  'tranquilo',
  'tranquila',
  'relajado',
  'relajada',
  'relajo',
  'descontracturado',
  'descontracturada',
  'piola',
  'tranquilidad',
  'calma',
]

const ENERGETIC_SIGNALS = [
  'party',
  'high energy',
  'high-energy',
  'energetic',
  'loud',
  'fiesta',
  'bailar',
  'bailanta',
  'movida',
  'energia',
  'energía',
  'perreo',
  'joda',
]

const TECHNO_SIGNALS = [
  'techno',
  'tech house',
  'house',
  'trance',
  'psytrance',
  'rave',
  'electronica',
  'electrónica',
  'electrónico',
  'underground',
  'minimal',
  'hardstyle',
  'hard techno',
  'drum and bass',
  'dnb',
  'dubstep',
  'edm',
  'dj set',
  'dark',
]

const DATE_SIGNALS = [
  'date',
  'romantic',
  'romance',
  'cita',
  'romantico',
  'romántico',
  'romantica',
  'romántica',
  'pareja',
  'couple',
  'valentine',
  'san valentin',
  'amor',
  'velada',
  'galant',
  'dinner date',
  'first date',
  'plan de pareja',
  'salir con alguien',
]

const FREE_SIGNALS = [
  'free',
  'gratis',
  'gratuito',
  'gratuita',
  'sin costo',
  'sin cargo',
  'no cost',
  'free entry',
  'entrada gratis',
  'entrada gratuita',
  'a la gorra',
  'no pago',
]

// Weekday tokens (normalized) → JS getDay index.
const DAY_TOKENS: Record<string, number> = {
  sunday: 0,
  domingo: 0,
  monday: 1,
  lunes: 1,
  tuesday: 2,
  martes: 2,
  wednesday: 3,
  miercoles: 3,
  thursday: 4,
  jueves: 4,
  friday: 5,
  viernes: 5,
  saturday: 6,
  sabado: 6,
}

const TODAY_TOKENS: Record<string, true> = {
  today: true,
  hoy: true,
  tonight: true,
}

const TOMORROW_TOKENS: Record<string, true> = {
  tomorrow: true,
  manana: true,
}

const WEEKEND_PHRASES = ['weekend', 'fin de semana', 'finde', 'fines de semana']

// Tokens never treated as the distinctive part of a neighborhood name.
const NEIGHBORHOOD_DROP_TOKENS: Record<string, true> = {
  villa: true,
  del: true,
  de: true,
  la: true,
  las: true,
  los: true,
  san: true,
  santa: true,
  general: true,
  nueva: true,
  monte: true,
  parque: true,
  puerto: true,
  velez: true,
}

// Stopwords for the keyword-overlap component. Meaningful intent words
// (free, gratis, chill, techno) and time/geo words (tonight, weekend, day
// names) are deliberately excluded so short vibe queries still produce
// content tokens while pure time/geo queries correctly fall back to
// context-only ranking.
const STOPWORDS: Record<string, true> = {
  the: true, a: true, an: true, and: true, or: true, to: true, for: true,
  of: true, in: true, on: true, at: true, with: true, this: true, that: true,
  it: true, is: true, are: true, was: true, be: true, do: true, does: true,
  did: true, what: true, where: true, when: true, how: true, any: true,
  some: true, there: true, here: true, me: true, my: true, your: true, you: true,
  i: true, we: true, they: true, he: true, she: true, want: true, wanna: true,
  looking: true, look: true, find: true, events: true, event: true, things: true,
  stuff: true, happening: true, going: true, go: true, get: true, got: true,
  place: true, places: true, around: true, near: true, best: true, top: true,
  good: true, great: true, fun: true, ideas: true, idea: true, list: true,
  show: true, see: true, saw: true, know: true, like: true, love: true,
  would: true, will: true, can: true, could: true, should: true, have: true,
  has: true, had: true, plans: true, plan: true, hoy: true, esta: true,
  noche: true, eventos: true, evento: true, cosas: true, para: true, con: true,
  en: true, de: true, el: true, la: true, los: true, las: true, que: true,
  un: true, una: true, por: true, hay: true, quiero: true, busco: true,
  mi: true, algo: true, algun: true, este: true, estos: true, del: true, y: true,
  o: true, al: true, se: true, te: true, lo: true, le: true, su: true,
  sus: true, cual: true, como: true, donde: true, cuando: true, hacer: true,
  hago: true, ver: true, ir: true, salir: true, comer: true, beber: true,
  escuchar: true, musica: true, música: true, planes: true, recomenda: true,
  recomendame: true, sugerime: true, sugeri: true, mostrame: true, muestrame: true,
  decime: true, dime: true, cuales: true, cuanto: true, vale: true, cuesta: true,
  precio: true, precios: true, alguna: true, algunos: true, algunas: true,
  otra: true, otros: true, otras: true, mas: true, menos: true, muy: true,
  bien: true, bueno: true, buena: true, genial: true, copado: true, copada: true,
  fino: true, fina: true, lindo: true, linda: true, pero: true, si: true,
  no: true, ya: true, ahora: true, aca: true, alla: true, toda: true, todo: true,
  todos: true, todas: true, solo: true, mismo: true, misma: true, asi: true,
  despues: true, antes: true, durante: true, entre: true, hasta: true, desde: true,
  sin: true, sobre: true, bajo: true, tambien: true, sabes: true, sabés: true,
  conoces: true, tenes: true, tenés: true, tiene: true, tienen: true,
  podes: true, podés: true, puedo: true, puede: true, pueden: true, gusta: true,
  gustaria: true, encanta: true, interesa: true, buscando: true, buscas: true,
  busca: true, vi: true, viste: true, habia: true, seria: true, podria: true,
  deberia: true, haria: true, recomiendas: true, recomiendan: true, dicen: true,
  dice: true, ofrece: true, ofrecen: true, today: true, tonight: true,
  tomorrow: true, manana: true, weekend: true, finde: true, sunday: true,
  domingo: true, monday: true, lunes: true, tuesday: true, martes: true,
  wednesday: true, miercoles: true, thursday: true, jueves: true, friday: true,
  viernes: true, saturday: true, sabado: true, night: true, dia: true, día: true,
}

// ============================================================================
// TEXT NORMALIZATION
// ============================================================================

/**
 * Normalize text for matching: lowercase, strip diacritics, collapse
 * punctuation and whitespace. "Ortúzar", "ORTUZAR" and "ortuzar" all become
 * "ortuzar".
 */
export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenize(normalized: string): string[] {
  return normalized.split(' ').filter((token) => token.length >= 3)
}

function contentTokens(query: string): string[] {
  return tokenize(normalizeText(query)).filter((token) => !STOPWORDS[token])
}

// ============================================================================
// NEIGHBORHOOD / DAY DETECTION
// ============================================================================

const NORMALIZED_NEIGHBORHOODS: Array<{
  name: Neighborhood
  normalized: string
  keyTokens: string[]
}> = NEIGHBORHOODS.map((name) => {
  const normalized = normalizeText(name)
  return {
    name,
    normalized,
    keyTokens: tokenize(normalized).filter((token) => !NEIGHBORHOOD_DROP_TOKENS[token]),
  }
})

function findNeighborhood(queryTokens: string[]): Neighborhood | null {
  for (const neighborhood of NORMALIZED_NEIGHBORHOODS) {
    // Full-name match: every token of the neighborhood name appears in the query.
    const fullNameTokens = tokenize(neighborhood.normalized)
    if (
      fullNameTokens.length > 0 &&
      fullNameTokens.every((token) => queryTokens.includes(token))
    ) {
      return neighborhood.name
    }
    // Shorthand match: a single distinctive token (e.g. "urquiza", "boca",
    // "madero") is enough when the full name is longer than one token.
    if (
      fullNameTokens.length > 1 &&
      neighborhood.keyTokens.length === 1 &&
      neighborhood.keyTokens[0].length >= 4 &&
      queryTokens.includes(neighborhood.keyTokens[0])
    ) {
      return neighborhood.name
    }
  }
  return null
}

function findDayOfWeek(queryTokens: string[]): number | null {
  for (const token of queryTokens) {
    const day = DAY_TOKENS[token]
    if (day !== undefined) return day
  }
  return null
}

// ============================================================================
// INTENT DETECTION
// ============================================================================

/**
 * Detect whether a query is a vibe search, and which signals it carries.
 * Returns null for non-vibe queries (which keep the semantic path).
 *
 * A query is a vibe query when it carries any bilingual vibe signal — chill,
 * energetic/party, techno, free, date-like — OR a geo/time signal (a named
 * neighborhood, weekday, today/tonight/tomorrow/weekend).
 */
export function detectVibeIntent(query: string): VibeIntent | null {
  const normalized = normalizeText(query)
  if (!normalized) return null
  const queryTokens = tokenize(normalized)
  if (queryTokens.length === 0) return null

  const hasPhrase = (phrases: string[]) => phrases.some((phrase) => normalized.includes(phrase))

  const signals: VibeIntent = {
    chill: hasPhrase(CHILL_SIGNALS),
    energetic: hasPhrase(ENERGETIC_SIGNALS),
    techno: hasPhrase(TECHNO_SIGNALS),
    date: hasPhrase(DATE_SIGNALS),
    free: hasPhrase(FREE_SIGNALS),
    neighborhood: findNeighborhood(queryTokens),
    dayOfWeek: findDayOfWeek(queryTokens),
    today:
      queryTokens.some((token) => TODAY_TOKENS[token]) || normalized.includes('esta noche'),
    tomorrow: queryTokens.some((token) => TOMORROW_TOKENS[token]),
    weekend: hasPhrase(WEEKEND_PHRASES),
  }

  const hasVibeSignal =
    signals.chill || signals.energetic || signals.techno || signals.date || signals.free
  const hasGeoOrTimeSignal =
    signals.neighborhood !== null ||
    signals.dayOfWeek !== null ||
    signals.today ||
    signals.tomorrow ||
    signals.weekend

  if (!hasVibeSignal && !hasGeoOrTimeSignal) return null
  return signals
}

// ============================================================================
// SCORING
// ============================================================================

/**
 * Minimum STRONG-evidence score (keyword overlap + text/free-flag signal
 * matches) for an event to be returned when the query carries a vibe signal.
 * This is the relevance gate: a "chill" ask must not be satisfied by a loud
 * techno party just because it shares a category, and category nudges are
 * ranking-only — they never qualify an event on their own. Queries with only
 * geo/time signals (no vibe signal) skip the gate — a "palermo" or
 * "saturday" browse should return matches ranked by context.
 */
export const MIN_CONTENT_SCORE = 6

// Soft completeness boosts/penalties (applied to the context component).
const QUALITY_BOOST_IMAGE = 3
const QUALITY_BOOST_LOCATION = 2
const QUALITY_PENALTY_LOCATION_TBA = 6
const QUALITY_PENALTY_NO_DESCRIPTION = 5

const CHILL_CATEGORIES: Record<string, true> = { social: true, arts: true, food: true }
// Music alone is not a date signal — every electronic night is "music". The
// date ask needs actual date-like content (keywords/text) or a food/arts
// context; the content gate then keeps techno nights out of date results.
const DATE_CATEGORIES: Record<string, true> = { food: true, arts: true }

const CHILL_TEXT_RE = /(chill|tranqui|relaj|calm|cozy|unwind|mellow|quiet|slow|descontractur)/i
const ENERGETIC_TEXT_RE = /(party|fiesta|dance|bail|perreo|movida|dj|rave)/i
const TECHNO_TEXT_RE = /(techno|house|trance|electron|underground|minimal|rave|dnb|dubstep|edm)/i
const DATE_TEXT_RE = /(romantic|romance|romant|velada|candle|wine|vino|cena|dinner|intimate|pareja|amor|galant)/i
const FREE_TEXT_RE = /(free|gratis|gratuit|sin costo|sin cargo|a la gorra)/i

export interface VibeScoreBreakdown {
  keyword: number
  signals: number
  /** Text/free-flag signal matches — the only signal evidence that qualifies an event. */
  strong: number
  context: number
  total: number
}

/**
 * Deterministic structured score for one candidate event against a vibe
 * query. Three additive components:
 *
 * - keyword: query-token overlap with name (double weight) / description /
 *   venue name (max ~40)
 * - signals: bilingual intent boosts/penalties for chill, techno, energetic,
 *   date, free (soft)
 * - context: neighborhood/day/time soft boosts + completeness quality
 *   adjustments
 *
 * The `MIN_CONTENT_SCORE` gate on keyword+signals decides whether the event
 * is returned at all for vibe-signal queries; the total decides rank order.
 */
export function scoreEventVibe(
  event: ChatEventPayload,
  query: string,
  intent: VibeIntent
): VibeScoreBreakdown {
  const name = normalizeText(event.name)
  const description = normalizeText(
    [
      event.description_summary_es,
      event.description_summary_en,
      event.description_es,
      event.description_en,
      event.description_display_es,
      event.description_display_en,
    ]
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .join(' ')
  )
  const venueName = normalizeText(event.venue_name ?? '')
  const eventText = `${name} ${description} ${venueName}`

  // --- Keyword overlap (max 40): name matches count double ---
  const tokens = contentTokens(query)
  let keyword = 0
  if (tokens.length > 0) {
    let matchedWeight = 0
    for (const token of tokens) {
      if (name.includes(token)) matchedWeight += 2
      else if (eventText.includes(token)) matchedWeight += 1
    }
    keyword = (matchedWeight / (tokens.length * 2)) * 40
  }

  // --- Intent signals (soft boosts / penalties) ---
  // `strong` accumulates the text/free-flag evidence only: category nudges
  // rank but never qualify (see MIN_CONTENT_SCORE).
  let signals = 0
  let strong = 0
  if (intent.chill) {
    if (event.categories.some((category) => CHILL_CATEGORIES[category])) signals += 6
    if (CHILL_TEXT_RE.test(eventText)) {
      signals += 8
      strong += 8
    }
    // Chill and energetic are opposites: a party night must not ride a
    // generic "social" category into chill results.
    if (ENERGETIC_TEXT_RE.test(eventText)) signals -= 8
  }
  if (intent.techno) {
    // Music alone is a weak techno signal (every music event is music); the
    // genre text and the keyword overlap carry the real weight.
    if (event.categories.includes('music')) signals += 4
    if (TECHNO_TEXT_RE.test(eventText)) {
      signals += 10
      strong += 10
    }
    if (!event.categories.includes('music')) signals -= 4
  }
  if (intent.energetic) {
    if (event.categories.includes('music')) signals += 6
    if (ENERGETIC_TEXT_RE.test(eventText)) {
      signals += 6
      strong += 6
    }
  }
  if (intent.date) {
    if (event.categories.some((category) => DATE_CATEGORIES[category])) signals += 4
    if (DATE_TEXT_RE.test(eventText)) {
      signals += 6
      strong += 6
    }
  }
  if (intent.free) {
    if (event.is_free) {
      signals += 15
      strong += 15
    } else if ((event.price ?? 0) > 0) signals -= 6
    if (FREE_TEXT_RE.test(eventText)) signals += 4
  }

  // --- Geo/time context (soft, additive) ---
  let context = 0
  if (intent.neighborhood) {
    if (event.venue_neighborhood === intent.neighborhood) context += 18
    else if (event.venue_neighborhood) context -= 4
  }
  if (intent.dayOfWeek !== null) {
    const eventDay = getDay(toZonedTime(event.starts_at, BA_TIMEZONE))
    context += eventDay === intent.dayOfWeek ? 12 : -6
  }
  if (intent.today || intent.tomorrow) {
    const baNow = toZonedTime(new Date(), BA_TIMEZONE)
    const baStart = toZonedTime(event.starts_at, BA_TIMEZONE)
    const dayDiff = Math.round(
      (Date.UTC(baStart.getFullYear(), baStart.getMonth(), baStart.getDate()) -
        Date.UTC(baNow.getFullYear(), baNow.getMonth(), baNow.getDate())) /
        86_400_000
    )
    if (intent.today && dayDiff === 0) context += 12
    else if (intent.tomorrow && dayDiff === 1) context += 12
    else context -= 6
  }
  if (intent.weekend) {
    const eventDay = getDay(toZonedTime(event.starts_at, BA_TIMEZONE))
    context += eventDay === 0 || eventDay === 6 ? 10 : -4
  }

  // --- Completeness (soft quality, last) ---
  if (event.image_url) context += QUALITY_BOOST_IMAGE
  if (event.venue_name || event.venue_neighborhood || event.venue_address) {
    context += QUALITY_BOOST_LOCATION
  }
  if (event.location_tba) context -= QUALITY_PENALTY_LOCATION_TBA
  if (event.description_unavailable) context -= QUALITY_PENALTY_NO_DESCRIPTION

  return { keyword, signals, strong, context, total: keyword + signals + context }
}

// ============================================================================
// RANKING
// ============================================================================

export interface VibeRankedResult {
  events: ChatEventPayload[]
  /** Number of hard-filtered candidates that were scored. */
  candidateCount: number
  /** Number of candidates that cleared the relevance gate. */
  relevantCount: number
}

const hasVibeSignal = (intent: VibeIntent): boolean =>
  intent.chill || intent.energetic || intent.techno || intent.date || intent.free

/**
 * Rank the complete hard-filtered candidate set by vibe score. Returns at
 * most `limit` events, and FEWER when relevance is poor: candidates that
 * fail the content gate (vibe-signal queries) are dropped, so a corpus that
 * does not fit the ask yields a short (or empty) list instead of filler.
 * Ties break by soonest start.
 */
export function rankVibeMatches(
  candidates: ChatEventPayload[],
  query: string,
  intent: VibeIntent,
  limit: number
): VibeRankedResult {
  const scored = candidates
    .map((event) => {
      const breakdown = scoreEventVibe(event, query, intent)
      return { event, breakdown }
    })
    .filter(({ event, breakdown }) => {
      // A query-named neighborhood excludes events known to be elsewhere —
      // "things to do in palermo" must not pad with recoleta events.
      if (
        intent.neighborhood &&
        event.venue_neighborhood &&
        event.venue_neighborhood !== intent.neighborhood
      ) {
        return false
      }
      if (!hasVibeSignal(intent)) return true
      return breakdown.keyword + breakdown.strong >= MIN_CONTENT_SCORE
    })
    .sort((a, b) => {
      if (b.breakdown.total !== a.breakdown.total) return b.breakdown.total - a.breakdown.total
      return a.event.starts_at.localeCompare(b.event.starts_at)
    })

  return {
    events: scored.slice(0, limit).map(({ event }) => event),
    candidateCount: candidates.length,
    relevantCount: scored.length,
  }
}

// ============================================================================
// TOOL RESULT FORMATTING
// ============================================================================

/** Formatted event shape reused by the vibe tool result (see formatEventForClaude). */
export interface VibeFormattedEvent {
  id: string
  name: string
  description: string | null
  hasDetails: boolean
  venue: string | null
  venueAddress: string | null
  neighborhood: string | null
  dateTime: string
  endsAt: string | null
  timeTba: boolean
  isAllDay: boolean
  price: string
  categories: string[]
  ticketUrl: string | null
}

/**
 * Tool-result formatting for the vibe path. Adds a relevance note so the
 * model can explain WHY it returned fewer events than matched the filters
 * (the coverage metadata already carries totalMatches vs. returned).
 */
export function formatVibeEventsToolResult(
  result: VibeRankedResult,
  floor: number = MIN_CONTENT_SCORE
): string {
  const payload: {
    count: number
    events: VibeFormattedEvent[]
    relevanceNote?: string
  } = {
    count: result.events.length,
    events: result.events.slice(0, 10).map((event) => formatEventForClaude(event)),
  }

  if (result.relevantCount < result.candidateCount) {
    payload.relevanceNote =
      `Vibe-matched ${result.relevantCount} of ${result.candidateCount} hard-filtered ` +
      `events (relevance floor ${floor}); only confident matches are returned, so ` +
      `fewer results than requested means weak relevance, not an empty calendar.`
  }

  return JSON.stringify(payload)
}
