/**
 * search_events intent canonicalization.
 *
 * Decomposes the raw tool input into a structured intent: non-negotiable
 * `must` constraints (dates, neighborhoods, venues, price, free), subjective
 * `prefer`/`avoid` hints, and a leftover `semanticQuery` passed to retrieval.
 *
 * String matching is allowed ONLY here, for alias canonicalization:
 *   - neighborhood aliases → canonical NEIGHBORHOODS names
 *   - venueName → venue ids (via searchVenuesByName)
 *   - free-language → must.isFree
 *   - named weekdays / "este sábado" / "el domingo" → BA date range
 *   - dateFrom/dateTo vs timeFilter intersection
 *
 * It never scores "romantic"/"chill", never classifies genre by regex, and
 * never awards quality points. Those are retrieval/rerank concerns.
 */

import { getDay, addDays, startOfDay, setHours } from 'date-fns'
import type { Neighborhood, EventFilters } from '#shared/lib/types.ts'
import { NEIGHBORHOODS } from '#shared/lib/types.ts'
import { searchVenuesByName } from '#shared/lib/db/client.server.ts'
import { normalizeText } from '#shared/lib/utils/normalize-text.ts'
import { GENRE_VALUES } from '#shared/lib/search-facets.ts'
import { baToUTC } from './utils.ts'

// ============================================================================
// INTENT CONTRACTS (plan §2.1)
// ============================================================================

export interface EventSearchMust {
  startsAfter?: string
  startsBefore?: string
  neighborhoodIds?: Neighborhood[]
  venueIds?: string[]
  categories?: string[]
  isFree?: boolean
  maxPrice?: number
  attendeeAge?: number
}

export interface EventSearchPrefer {
  genres?: string[]
  vibes?: string[]
  activities?: string[]
  audience?: string[]
  setting?: string[]
}

export interface EventSearchAvoid {
  genres?: string[]
  vibes?: string[]
  activities?: string[]
  venueIds?: string[]
}

export interface EventSearchIntent {
  must: EventSearchMust
  prefer: EventSearchPrefer
  avoid: EventSearchAvoid
  semanticQuery: string
  displayLimit: number
  candidateLimit: number
  objective: 'search' | 'surprise'
}

// The tool input as seen by canonicalize. Structurally compatible with
// SearchEventsInput (avoids a circular import between the two tool modules).
export interface CanonicalizeInput {
  query?: string
  categories?: string[]
  neighborhoods?: string[]
  venueName?: string
  venueIds?: string[]
  dateFrom?: string
  dateTo?: string
  avoid?: string[]
  prefer?: EventSearchPrefer
  isFree?: boolean
  maxPrice?: number
  minAge?: number
  timeFilter?: 'now' | 'tonight' | 'tomorrow' | 'weekend' | 'week' | 'future'
  limit?: number
  /** Explicit objective hint ("surprise me" → 'surprise'). Derivation: see objectFromInput. */
  objective?: 'search' | 'surprise'
}

// ============================================================================
// DEFAULTS
// ============================================================================

const DISPLAY_LIMIT_DEFAULT = 1
const DISPLAY_LIMIT_MAX = 5
const CANDIDATE_LIMIT = 50

// ============================================================================
// ALIAS TABLES (token-boundary aware, operate on normalized text)
// ============================================================================

/** Abbreviated filler/stopword tokens not worth embedding on their own. */
const SEMANTIC_FILLER = new Set([
  'el', 'la', 'los', 'las', 'lo', 'un', 'una', 'unos', 'unas',
  'de', 'del', 'en', 'a', 'y', 'o', 'que', 'para', 'por', 'con', 'al',
])

/** Whole-word tokens that mark a query as free (never a substring). */
const FREE_SINGLE_TOKENS = ['gratis', 'gratuito', 'free']

/** Multi-word free phrases; all words present (as whole tokens) counts. */
const FREE_PHRASES: string[][] = [
  ['sin', 'costo'],
  ['sin', 'cargo'],
  ['a', 'la', 'gorra'],
]

/** Normalized weekday → target weekday index (0=Sunday..6=Saturday). */
const WEEKDAY_TOKENS: Record<string, number> = {
  lunes: 1, monday: 1,
  martes: 2, tuesday: 2,
  miercoles: 3, wednesday: 3,
  jueves: 4, thursday: 4,
  viernes: 5, friday: 5,
  sabado: 6, saturday: 6,
  domingo: 0, sunday: 0,
}

const NORMALIZED_NEIGHBORHOODS: Array<{ name: Neighborhood; tokens: string[] }> =
  NEIGHBORHOODS.map((name) => ({
    name,
    tokens: normalizeText(name).split(' ').filter(Boolean),
  }))

// ============================================================================
// NEIGHBORHOOD RESOLUTION
// ============================================================================

/**
 * Resolve the neighborhoods named in the explicit `neighborhoods` input and/or
 * the free-text `query`, using token-boundary whole-word matching against the
 * canonical NEIGHBORHOODS names. "Palermo Soho"/"Palermo Hollywood" both map to
 * "Palermo" because the canonical name's tokens must each appear as a word.
 */
function resolveNeighborhoods(input: string[], queryTokens: Set<string>): Neighborhood[] {
  const resolved = new Set<Neighborhood>()

  for (const raw of input) {
    const tokens = normalizeText(raw).split(' ').filter(Boolean)
    for (const nb of NORMALIZED_NEIGHBORHOODS) {
      if (nb.tokens.every((t) => tokens.includes(t))) resolved.add(nb.name)
    }
  }

  const tokens = new Set(input.flatMap((raw) => normalizeText(raw).split(' ').filter(Boolean)))
  queryTokens.forEach((t) => tokens.add(t))

  for (const nb of NORMALIZED_NEIGHBORHOODS) {
    if (nb.tokens.length > 0 && nb.tokens.every((t) => tokens.has(t))) {
      resolved.add(nb.name)
    }
  }

  return [...resolved]
}

// ============================================================================
// TIME FILTERS
// ============================================================================

/** today's "tonight" window, with the midnight–6am exception. */
function tonightWindow(now: Date): { after: Date; before: Date } {
  const currentHour = now.getHours()
  if (currentHour < 6) {
    // Late night / early morning — the night is already happening.
    const before = setHours(startOfDay(now), 6)
    return { after: now, before }
  }
  const after = setHours(startOfDay(now), 18)
  const before = setHours(startOfDay(addDays(now, 1)), 6)
  return { after, before }
}

function weekendWindow(now: Date): { after: Date; before: Date } {
  const dayOfWeek = getDay(now)
  if (dayOfWeek === 6 || dayOfWeek === 0) {
    // Already weekend — start from now, end Monday midnight.
    const daysUntilMonday = dayOfWeek === 6 ? 2 : 1
    const monday = startOfDay(addDays(now, daysUntilMonday))
    return { after: now, before: monday }
  }
  const daysUntilSaturday = 6 - dayOfWeek
  const saturday = startOfDay(addDays(now, daysUntilSaturday))
  const monday = startOfDay(addDays(saturday, 2))
  return { after: saturday, before: monday }
}

/** Next occurrence of a named weekday as a single-day window (00:00 → 00:00). */
function weekdayWindow(now: Date, targetWeekday: number): { after: Date; before: Date } {
  const nowWeekday = getDay(now)
  const daysUntil = (targetWeekday - nowWeekday + 7) % 7
  const day = startOfDay(addDays(now, daysUntil))
  return { after: day, before: startOfDay(addDays(day, 1)) }
}

/**
 * Apply the timeFilter presets, preserving today's semantics (tonight 18:00–
 * next 06:00 with the midnight–6am exception, weekend Sat–Mon, etc.). "now" is
 * handled outside canonicalize (the happening-now path), so it sets no range.
 */
function applyTimeFilter(
  must: EventSearchMust,
  timeFilter: CanonicalizeInput['timeFilter'],
  now: Date
): void {
  if (timeFilter === 'now') return

  let after: Date
  let before: Date | null = null

  if (timeFilter === 'tonight') {
    const w = tonightWindow(now)
    after = w.after
    before = w.before
  } else if (timeFilter === 'tomorrow') {
    const tomorrow = startOfDay(addDays(now, 1))
    after = tomorrow
    before = startOfDay(addDays(tomorrow, 1))
  } else if (timeFilter === 'weekend') {
    const w = weekendWindow(now)
    after = w.after
    before = w.before
  } else if (timeFilter === 'week') {
    after = now
    before = addDays(now, 7)
  } else {
    // 'future' and default: unbounded upcoming window (no upper limit).
    after = now
  }

  must.startsAfter = baToUTC(after)
  if (before) must.startsBefore = baToUTC(before)
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Apply an explicit dateFrom/dateTo range (ISO date or datetime). Returns the
 * window as ISO strings. Invalid/absent bounds are undefined.
 *
 * A bare `YYYY-MM-DD` is interpreted as a Buenos Aires calendar date (00:00 BA)
 * using baToUTC, NOT as UTC midnight via `new Date('YYYY-MM-DD')` — that would
 * land 3 hours early in BA and drift across the intended day.
 */
function dateRangeBounds(dateFrom?: string, dateTo?: string): {
  after?: string
  before?: string
} {
  const bounds: { after?: string; before?: string } = {}
  if (dateFrom) {
    bounds.after = toUTCBound(dateFrom)
  }
  if (dateTo) {
    bounds.before = toUTCBound(dateTo)
  }
  return bounds
}

/** Parse a date-only or datetime string, treating bare dates as BA calendar dates. */
function toUTCBound(value: string): string | undefined {
  if (DATE_ONLY_RE.test(value)) {
    // YYYY-MM-DD → BA midnight of that calendar day.
    const [y, m, d] = value.split('-').map(Number)
    return baToUTC(startOfDay(new Date(y, m - 1, d)))
  }
  const dt = new Date(value)
  if (Number.isNaN(dt.getTime())) return undefined
  return dt.toISOString()
}

/**
 * Latest of the given ISO bounds (the intersection's start). Never widens —
 * this is the later start date.
 */
function latest(...bounds: Array<string | undefined>): string | undefined {
  const present = bounds.filter((b): b is string => !!b)
  if (present.length === 0) return undefined
  return present.sort()[present.length - 1]
}

/**
 * Earliest of the given ISO bounds (the intersection's end). Never widens —
 * this is the earlier end date.
 */
function earliest(...bounds: Array<string | undefined>): string | undefined {
  const present = bounds.filter((b): b is string => !!b)
  if (present.length === 0) return undefined
  return present.sort()[0]
}


// ============================================================================
// INTENT → FILTERS
// ============================================================================

export function mustToFilters(must: EventSearchMust): EventFilters {
  const filters: EventFilters = {}
  if (must.startsAfter) filters.startsAfter = must.startsAfter
  if (must.startsBefore) filters.startsBefore = must.startsBefore
  if (must.neighborhoodIds?.length) filters.neighborhoods = must.neighborhoodIds
  if (must.venueIds?.length) filters.venueIds = must.venueIds
  if (must.categories?.length) filters.categories = must.categories
  if (must.isFree !== undefined) filters.isFree = must.isFree
  if (must.maxPrice !== undefined) filters.maxPrice = must.maxPrice
  if (must.attendeeAge !== undefined) filters.minAge = must.attendeeAge
  return filters
}

/**
 * Build `EventFilters` from a whole intent: must filters plus the avoid-genre
 * hard excludes. Avoid = a hard exclude — at the SQL layer the search RPCs use
 * `NOT (coalesce(facets->'genres','[]') ?| avoidGenres)` and the PostgREST
 * filter-only/count paths apply it in memory; either way, events without a
 * genres key stay eligible. Prefer is never a filter (handled as retrieval
 * text in canonicalize / the reranker), so it contributes nothing here.
 */
export function applyPreferAvoid(intent: EventSearchIntent): EventFilters {
  const filters = mustToFilters(intent.must)
  if (intent.avoid.genres?.length) {
    filters.avoidGenres = intent.avoid.genres
  }
  return filters
}

// ============================================================================
// CANONICALIZE
// ============================================================================

/**
 * Canonicalize raw tool input into an EventSearchIntent. Venue resolution is
 * async (DB lookup via searchVenuesByName). `nowBA` MUST be injected — the
 * caller passes a BA Date; tests pin it for determinism.
 */
export async function canonicalizeSearchIntent(
  input: CanonicalizeInput,
  nowBA: Date
): Promise<EventSearchIntent> {
  const query = input.query?.trim() ?? ''
  const normalizedQuery = normalizeText(query)
  const queryTokens = new Set(normalizedQuery ? normalizedQuery.split(' ') : [])

  const must: EventSearchMust = {}
  const avoid: EventSearchAvoid = {}

  // displayLimit: default 1, clamped 1..5 (never lower than 1 so a negative
  // limit cannot slice(0, negative)).
  const displayLimit = Math.max(1, Math.min(input.limit ?? DISPLAY_LIMIT_DEFAULT, DISPLAY_LIMIT_MAX))

  // --- isFree from explicit input or free-language ---
  const strippedTokens = new Set<string>()
  let isFree = input.isFree ?? false
  if (FREE_SINGLE_TOKENS.some((t) => queryTokens.has(t))) {
    isFree = true
    FREE_SINGLE_TOKENS.forEach((t) => {
      if (queryTokens.has(t)) strippedTokens.add(t)
    })
  }
  for (const phrase of FREE_PHRASES) {
    if (phrase.every((t) => queryTokens.has(t))) {
      isFree = true
      phrase.forEach((t) => strippedTokens.add(t))
    }
  }
  if (isFree) must.isFree = true

  // --- neighborhoods (explicit + query) ---
  const neighborhoods = resolveNeighborhoods(input.neighborhoods ?? [], queryTokens)
  if (neighborhoods.length > 0) {
    must.neighborhoodIds = neighborhoods
    neighborhoods.forEach((n) => {
      NORMALIZED_NEIGHBORHOODS.find((nb) => nb.name === n)?.tokens.forEach((t) =>
        strippedTokens.add(t)
      )
    })
  }

  // --- venues ---
  if (input.venueIds?.length) {
    must.venueIds = input.venueIds
  } else if (input.venueName) {
    const venues = await searchVenuesByName(input.venueName)
    must.venueIds = venues.map((v) => v.id)
  }

  // --- weekday / timeFilter / dateFrom-dateTo ---
  let weekday: number | null = null
  for (const token of queryTokens) {
    const day = WEEKDAY_TOKENS[token]
    if (day !== undefined) {
      weekday = day
      break
    }
  }

  if (weekday !== null) {
    const w = weekdayWindow(nowBA, weekday)
    must.startsAfter = baToUTC(w.after)
    must.startsBefore = baToUTC(w.before)
    // Strip the weekday token.
    for (const [key, value] of Object.entries(WEEKDAY_TOKENS)) {
      if (value === weekday && queryTokens.has(key)) strippedTokens.add(key)
    }
  } else {
    applyTimeFilter(must, input.timeFilter, nowBA)
  }

  // dateFrom/dateTo: win over timeFilter / weekday window. When both a window
  // and an explicit range exist, intersect — use the later start and the
  // earlier end. Never widen. An empty intersection (after >= before) is
  // preserved so SQL returns no rows.
  if (input.dateFrom || input.dateTo) {
    const explicit = dateRangeBounds(input.dateFrom, input.dateTo)
    must.startsAfter = latest(must.startsAfter, explicit.after)
    must.startsBefore = earliest(must.startsBefore, explicit.before)
  }

  // --- categorical / price / age pass-through ---
  if (input.categories?.length) must.categories = input.categories
  if (input.maxPrice !== undefined) must.maxPrice = input.maxPrice
  if (input.minAge !== undefined) must.attendeeAge = input.minAge

  // --- avoid (free-text exclusions mapped onto the closed facet genre keys) ---
  const avoidGenres = mapAvoidGenres(input.avoid)
  if (avoidGenres.length > 0) avoid.genres = avoidGenres

  // --- semanticQuery = query minus resolved constraint tokens + filler ---
  let semanticQuery = ''
  if (normalizedQuery) {
    const remaining = normalizedQuery
      .split(' ')
      .filter((t) => t && !strippedTokens.has(t) && !SEMANTIC_FILLER.has(t))
    semanticQuery = remaining.join(' ')
  }

  // Prefer is retrieval text only — never a filter. When the user-facing
  // semanticQuery is empty but prefer terms exist, append them so the hybrid
  // retriever still has something to embed / lexically match.
  const prefer = applyPrefer(input.prefer)
  if (!semanticQuery) {
    semanticQuery = joinPreferIntoQuery(prefer)
  }

  return {
    must,
    prefer,
    avoid,
    semanticQuery,
    displayLimit,
    candidateLimit: CANDIDATE_LIMIT,
    objective: resolveObjective(input, must, semanticQuery),
  }
}

/**
 * Resolve the tool objective.
 *
 * An explicit `objective: 'surprise'` (the concierge's "pick one for me"
 * path) wins. Otherwise it is surprise only when there is no semantic query
 * AND the `must` is nothing more than the default upcoming window — no
 * neighborhood / venue / free / price / age / category filter and no explicit
 * date range beyond the default `startsAfter: now`. If the user set hard musts
 * (Palermo, free, Niceto, Saturday) that is NOT surprise.
 */
function resolveObjective(
  input: CanonicalizeInput,
  must: EventSearchMust,
  semanticQuery: string
): 'search' | 'surprise' {
  // Surprise is never legitimate when there is semantic text OR a hard must
  // beyond the default upcoming window. That gate holds even for an explicit
  // `objective: 'surprise'` hint — hard filters (Palermo / free / Niceto /
  // Saturday) make it a directed search, not a surprise pick.
  if (semanticQuery) return 'search'
  if (!isDefaultWindowOnly(input, must)) return 'search'
  // Passed the gate. An explicit `objective: 'search'` must never surprise;
  // an explicit `surprise` picks; otherwise the empty-query default surprises.
  if (input.objective === 'search') return 'search'
  if (input.objective === 'surprise') return 'surprise'
  return 'surprise'
}

/**
 * True when the must set is (possibly) the default upcoming window alone —
 * i.e. no constraint that would make this a directed search rather than
 * "surprise me".
 */
function isDefaultWindowOnly(input: CanonicalizeInput, must: EventSearchMust): boolean {
  if (must.neighborhoodIds && must.neighborhoodIds.length > 0) return false
  if (must.venueIds && must.venueIds.length > 0) return false
  if (must.categories && must.categories.length > 0) return false
  if (must.isFree !== undefined) return false
  if (must.maxPrice !== undefined) return false
  if (must.attendeeAge !== undefined) return false
  // An explicit end/date bound is a directed range, not the default window.
  if (must.startsBefore) return false
  // A shifted/special time window is also a directed search.
  if (input.dateFrom || input.dateTo) return false
  // 'now' is happening-now, not the default upcoming window — not surprise.
  if (input.timeFilter === 'now') return false
  if (
    input.timeFilter === 'tonight' ||
    input.timeFilter === 'tomorrow' ||
    input.timeFilter === 'weekend' ||
    input.timeFilter === 'week'
  )
    return false
  return true
}

// Apply prefer to the intent. Prefer is NEVER a filter — it only feeds the
// retrieval query text (see joinPreferIntoQuery) and later the reranker.
function applyPrefer(prefer: CanonicalizeInput['prefer']): EventSearchPrefer {
  return prefer ?? {}
}

// Join prefer terms into a retrieval query string when the user gave no
// semantic text of their own. Preferred genres/vibes/audience/setting become
// the query so the dense + lexical retrievers still have signal.
function joinPreferIntoQuery(prefer: EventSearchPrefer): string {
  const terms = [
    ...(prefer.genres ?? []),
    ...(prefer.vibes ?? []),
    ...(prefer.audience ?? []),
    ...(prefer.setting ?? []),
  ]
  return terms.join(' ')
}

// The free-form (user phrase → facet) genre keys. Extend only from eval
// failures; unknown tokens are ignored rather than guessed.
const GENRE_ALIASES: Array<{ token: string; genre: (typeof GENRE_VALUES)[number] }> =
  GENRE_VALUES.map((g) => ({ token: normalizeText(g), genre: g })).concat([
    { token: 'tecnico', genre: 'techno' },
    { token: 'reggueton', genre: 'reggaeton' },
    { token: 'deephouse', genre: 'house' },
    { token: 'hiphop', genre: 'hip-hop' },
    { token: 'electronica', genre: 'electronic' },
    { token: 'electro', genre: 'electronic' },
    { token: 'clasical', genre: 'classical' },
    { token: 'clasico', genre: 'classical' },
  ])

/**
 * Map free-text avoid tokens onto the closed facet genre keys, ignoring
 * unknown tokens. Only genres with a known facet key become hard SQL excludes
 * (via `EventFilters.avoidGenres`).
 */
export function mapAvoidGenres(avoid: CanonicalizeInput['avoid'] | undefined): string[] {
  if (!avoid?.length) return []
  const matched = new Set<string>()
  for (const raw of avoid) {
    const token = normalizeText(raw)
    const hit = GENRE_ALIASES.find((a) => a.token === token)
    if (hit) matched.add(hit.genre)
  }
  return [...matched]
}

// ============================================================================
// CHILL INTENT (ranking signal only — never a filter, never event scoring)
// ============================================================================

/**
 * Whole-token chill markers. Matching is token-boundary aware on normalized,
 * accent-stripped text — "chill" in "chillout" or "cita" in "recital" never
 * matches. `low-key` is handled separately below because `normalizeText` turns
 * the hyphen into a space, splitting it into two tokens.
 */
const CHILL_TOKENS = new Set([
  'chill',
  'tranqui',
  'tranquilo',
  'tranquila',
  'relajado',
  'relajada',
  'relaxed',
  'lowkey',
  'calmado',
  'suave',
])

/**
 * True when the semantic query asks for something chill / tranquilo / relaxed.
 * Intent detection only — it drives a soft rerank upstream and must never
 * become a SQL filter or a per-event score.
 */
export function detectChillIntent(semanticQuery: string): boolean {
  if (!semanticQuery.trim()) return false
  const tokens = normalizeText(semanticQuery).split(' ').filter(Boolean)
  if (tokens.some((t) => CHILL_TOKENS.has(t))) return true
  // "low-key" normalizes to the adjacent pair "low key"; match it as a phrase
  // while still refusing substring matches.
  for (let i = 0; i + 1 < tokens.length; i++) {
    if (tokens[i] === 'low' && tokens[i + 1] === 'key') return true
  }
  return false
}
