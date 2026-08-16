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
 *   - named weekdays (single or multiple) / weekday phrasing ("during the week", "entre semana") → BA date range
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
import {
  GENRE_VALUES,
  VIBE_VALUES,
  ACTIVITY_VALUES,
  AUDIENCE_VALUES,
  SETTING_VALUES,
} from '#shared/lib/search-facets.ts'
import { baToUTC } from './utils.ts'
import {
  annotateQuery,
  type QueryRule,
  type QueryAnnotationTrace,
} from './search-query-annotations.ts'

// ============================================================================
// INTENT CONTRACTS (plan §2.1)
// ============================================================================

export interface EventSearchMust {
  startsAfter?: string
  startsBefore?: string
  /** Exact per-day windows for a multi-weekday ask ("Monday or Friday").
   *  Disjoint days are queried separately — never a spanning hull, which would
   *  admit unrequested weekdays in between. */
  weekdayWindows?: Array<{ startsAfter: string; startsBefore: string }>
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
  /** Compact query-annotation trace (debug/tests only; never user-visible). */
  annotation?: QueryAnnotationTrace
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
  // English glue once structured constraints have been resolved.
  'in', 'and', 'or',
])

/** Whole-word tokens that mark a query as free (never a substring). */
const FREE_SINGLE_TOKENS = ['gratis', 'gratuito', 'free']

/** Multi-word free phrases, matched as exact contiguous token spans. */
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

/**
 * Weekday-only phrasing meaning Monday–Friday ("during the week", "on
 * weekdays", "entre semana") — NOT `timeFilter: "week"` (the next 7 days).
 * Whole-phrase matched on normalized tokens.
 */
const WEEKDAY_PHRASES: string[][] = [
  ['weekday'],
  ['weekdays'],
  ['on', 'weekdays'],
  ['during', 'the', 'week'],
  ['during', 'week'],
  ['entre', 'semana'],
  ['durante', 'la', 'semana'],
  ['durante', 'semana'],
  ['dia', 'de', 'semana'],
  ['dias', 'de', 'semana'],
]

/**
 * Generic discovery phrases — "what's on?" / "qué hay?" / "things to do" —
 * that name the ask itself rather than a subject. Matched as exact contiguous
 * token spans on the normalized query (never substring). Removing them turns a
 * pure discovery ask into filter-only search instead of embedding meaningless
 * tokens.
 */
const GENERIC_DISCOVERY_PHRASES: string[][] = [
  // Spanish
  ['planes'],
  ['eventos'],
  ['actividades'],
  ['cosas', 'para', 'hacer'],
  ['algo', 'para', 'hacer'],
  ['que', 'hay'], // "qué hay"
  ['hay', 'eventos'], // "hay eventos"
  ['hay', 'algun', 'evento'], // "hay algún evento"
  // English
  ['what', 's', 'on'], // "what's on"
  ['what', 'is', 'on'],
  ['whats', 'on'],
  ['things', 'to', 'do'],
  ['thing', 'to', 'do'],
  ['something', 'to', 'do'],
  ['events'],
  ['activities'],
  ['any', 'events', 'on'],
  ['are', 'there', 'any', 'events', 'on'],
  ['are', 'there', 'events', 'on'],
  ['any', 'events'],
  ['are', 'there', 'any', 'events'],
  ['are', 'there', 'events'],
]

/**
 * Temporal phrases keyed by the structured `timeFilter`, so only the phrase
 * matching the *active* filter is stripped from semantic residue. This avoids
 * globally deleting "night" / "week" / "now" when no structured filter exists.
 */
const TEMPORAL_PHRASES_BY_FILTER: Record<
  NonNullable<CanonicalizeInput['timeFilter']>,
  string[][]
> = {
  now: [['now'], ['right', 'now'], ['ahora'], ['en', 'este', 'momento']],
  tonight: [
    ['tonight'],
    ['this', 'evening'],
    ['esta', 'noche'],
    ['hoy', 'a', 'la', 'noche'],
  ],
  tomorrow: [['tomorrow'], ['manana']], // "mañana"
  weekend: [
    ['weekend'],
    ['this', 'weekend'],
    ['este', 'fin', 'de', 'semana'],
    ['fin', 'de', 'semana'],
    ['este', 'finde'],
    ['finde'],
  ],
  week: [['this', 'week'], ['esta', 'semana']],
  future: [['in', 'the', 'future'], ['en', 'el', 'futuro']],
}

const NORMALIZED_NEIGHBORHOODS: Array<{ name: Neighborhood; tokens: string[] }> =
  NEIGHBORHOODS.map((name) => ({
    name,
    tokens: normalizeText(name).split(' ').filter(Boolean),
  }))

// ============================================================================
// QUERY-ANNOTATION RULES (declarative; consumed by annotateQuery)
// ============================================================================
//
// Each rule is an exact contiguous token-span match on the normalized query.
// Semantic residue is computed from the resolved consuming spans' token
// indexes — never by token value. See search-query-annotations.ts for the
// overlap policy and the QueryRule contract.

/** Abbreviated filler/stopword tokens not worth embedding on their own. */
const FILLER_RULES: QueryRule[] = [...SEMANTIC_FILLER].map((token) => ({
  phrase: [token],
  kind: 'filler' as const,
}))

/** Whole-token + phrase free markers → the isFree constraint. */
const FREE_RULES: QueryRule[] = [
  ...FREE_SINGLE_TOKENS.map((token) => ({
    phrase: [token],
    kind: 'free' as const,
    value: 'free',
  })),
  ...FREE_PHRASES.map((phrase) => ({
    phrase,
    kind: 'free' as const,
    value: 'free',
  })),
]

/** Normalized weekday token → target weekday index (0=Sunday..6=Saturday). */
const WEEKDAY_RULES: QueryRule[] = Object.entries(WEEKDAY_TOKENS).map(
  ([token, day]) => ({
    phrase: [token],
    kind: 'weekday' as const,
    value: day,
  })
)

/**
 * Weekday-only phrasing meaning Monday–Friday. Suppressed by a named weekday
 * so a named day always wins over the generic phrasing (behavior unchanged).
 */
const WEEKDAY_RANGE_RULES: QueryRule[] = WEEKDAY_PHRASES.map((phrase) => ({
  phrase,
  kind: 'weekday_range' as const,
  suppressedBy: ['weekday'],
}))

/** Generic discovery phrases — "what's on?" / "qué hay?" / "things to do". */
const GENERIC_RULES: QueryRule[] = GENERIC_DISCOVERY_PHRASES.map((phrase) => ({
  phrase,
  kind: 'generic_discovery' as const,
}))

/** Query neighborhoods — matched as exact contiguous token spans. */
const NEIGHBORHOOD_RULES: QueryRule[] = NORMALIZED_NEIGHBORHOODS.map((nb) => ({
  phrase: nb.tokens,
  kind: 'neighborhood' as const,
  value: nb.name,
}))

/** Active temporal phrases for the structured `timeFilter`, if any. */
function temporalRules(timeFilter: NonNullable<CanonicalizeInput['timeFilter']> | undefined): QueryRule[] {
  if (!timeFilter) return []
  return TEMPORAL_PHRASES_BY_FILTER[timeFilter].map((phrase) => ({
    phrase,
    kind: 'temporal' as const,
    value: timeFilter,
  }))
}

/**
 * Build the full rule set for annotation. Temporal rules are active only for
 * the matching structured `timeFilter`; everything else is unconditional.
 * Exported for annotation-level tests.
 */
export function buildQueryAnnotationRules(
  timeFilter: NonNullable<CanonicalizeInput['timeFilter']> | undefined
): QueryRule[] {
  return [
    ...GENERIC_RULES,
    ...WEEKDAY_RULES,
    ...WEEKDAY_RANGE_RULES,
    ...NEIGHBORHOOD_RULES,
    ...FREE_RULES,
    ...FILLER_RULES,
    ...temporalRules(timeFilter),
  ]
}

// ============================================================================
// PREFER FACET EXTRACTION (soft hints — never filters)
// ============================================================================

/** Whole-token chill markers. Matches token-boundary aware on normalized text. */
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

type PreferFacetKey = 'genres' | 'vibes' | 'activities' | 'audience' | 'setting'
const PREFER_FACET_KEYS: PreferFacetKey[] = [
  'genres',
  'vibes',
  'activities',
  'audience',
  'setting',
]

interface PreferAlias {
  /** Normalized tokens, space-separated. Whole-token (and phrase) matched. */
  phrase: string
  value: string
}

const PREFER_ALIASES: Record<PreferFacetKey, PreferAlias[]> = {
  genres: GENRE_ALIASES.map((a) => ({ phrase: a.token, value: a.genre })),
  vibes: [
    ...VIBE_VALUES.map((v) => ({ phrase: normalizeText(v), value: v })),
    ...[...CHILL_TOKENS].map((token) => ({ phrase: token, value: 'relaxed' })),
    // "low-key" normalizes to the adjacent pair "low key".
    { phrase: 'low key', value: 'relaxed' },
  ],
  activities: [
    ...ACTIVITY_VALUES.map((v) => ({ phrase: normalizeText(v), value: v })),
    { phrase: 'live', value: 'live-music' },
    { phrase: 'vivo', value: 'live-music' },
    { phrase: 'en vivo', value: 'live-music' },
    { phrase: 'afuera', value: 'outdoor' },
    { phrase: 'al aire', value: 'outdoor' },
  ],
  audience: [
    ...AUDIENCE_VALUES.map((v) => ({ phrase: normalizeText(v), value: v })),
    { phrase: 'date', value: 'couples' },
    { phrase: 'cita', value: 'couples' },
    { phrase: 'pareja', value: 'couples' },
  ],
  setting: [
    ...SETTING_VALUES.map((v) => ({ phrase: normalizeText(v), value: v })),
    { phrase: 'afuera', value: 'outdoor' },
    { phrase: 'exterior', value: 'outdoor' },
    { phrase: 'adentro', value: 'indoor' },
    { phrase: 'interior', value: 'indoor' },
  ],
}

/** Negation markers whose following token must not feed a soft prefer boost. */
const NEGATION_MARKERS = new Set(['except', 'excepto', 'salvo', 'menos', 'sin', 'avoid', 'not'])

/** Whole-token/phrase match that ignores tokens in a negation context. */
function phraseMatches(
  tokens: string[],
  phraseTokens: string[],
  blocked: Set<number>
): boolean {
  const n = phraseTokens.length
  if (n === 0) return false
  for (let i = 0; i + n <= tokens.length; i++) {
    let ok = true
    for (let j = 0; j < n; j++) {
      if (tokens[i + j] !== phraseTokens[j] || blocked.has(i + j)) {
        ok = false
        break
      }
    }
    if (ok) return true
  }
  return false
}

/** Extract soft `prefer` hints from free-text query tokens (never filters). */
function extractPreferFromQuery(normalizedQuery: string): EventSearchPrefer {
  const tokens = normalizedQuery ? normalizedQuery.split(' ').filter(Boolean) : []
  if (tokens.length === 0) return {}

  const blocked = new Set<number>()
  for (let i = 0; i < tokens.length; i++) {
    if (NEGATION_MARKERS.has(tokens[i])) {
      blocked.add(i)
      if (i + 1 < tokens.length) blocked.add(i + 1)
    }
  }

  const prefer: EventSearchPrefer = {}
  for (const key of PREFER_FACET_KEYS) {
    const hits = new Set<string>()
    for (const alias of PREFER_ALIASES[key]) {
      const phraseTokens = alias.phrase.split(' ')
      if (phraseMatches(tokens, phraseTokens, blocked)) hits.add(alias.value)
    }
    if (hits.size > 0) prefer[key] = [...hits]
  }
  return prefer
}

/** Merge an explicit prefer with extracted hints (union per key, de-duped). */
function mergePrefer(
  base: EventSearchPrefer | undefined,
  extra: EventSearchPrefer
): EventSearchPrefer {
  const merged: EventSearchPrefer = { ...(base ?? {}) }
  for (const key of PREFER_FACET_KEYS) {
    const values = new Set<string>([...(merged[key] ?? []), ...(extra[key] ?? [])])
    if (values.size > 0) merged[key] = [...values]
  }
  return merged
}

/** True when a prefer has no populated facet arrays. */
export function preferIsEmpty(prefer: EventSearchPrefer | undefined | null): boolean {
  if (!prefer) return true
  return !PREFER_FACET_KEYS.some((key) => (prefer[key]?.length ?? 0) > 0)
}

// ============================================================================
// NEIGHBORHOOD RESOLUTION
// ============================================================================

/**
 * Resolve the neighborhoods named in the explicit `neighborhoods` input and
 * the contiguous query-neighborhood spans. Explicit input is matched exactly as
 * before (token-boundary whole-word: "Palermo Soho" → "Palermo"); query
 * neighborhoods arrive already resolved as exact contiguous spans.
 */
function resolveNeighborhoods(
  input: string[],
  queryNeighborhoods: Neighborhood[]
): Neighborhood[] {
  const resolved = new Set<Neighborhood>(queryNeighborhoods)
  for (const raw of input) {
    const tokens = normalizeText(raw).split(' ').filter(Boolean)
    for (const nb of NORMALIZED_NEIGHBORHOODS) {
      if (nb.tokens.length > 0 && nb.tokens.every((t) => tokens.includes(t))) {
        resolved.add(nb.name)
      }
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

/**
 * Next occurrence of each named weekday as its own exact window, ordered
 * chronologically. A requested day that is today starts at `now`; future days
 * start at midnight. Days are never collapsed into a spanning hull.
 */
function weekdayWindows(
  now: Date,
  targetWeekdays: number[]
): Array<{ after: Date; before: Date }> {
  const nowWeekday = getDay(now)
  return targetWeekdays
    .map((targetWeekday) => {
      const daysUntil = (targetWeekday - nowWeekday + 7) % 7
      const day = startOfDay(addDays(now, daysUntil))
      return {
        after: daysUntil === 0 ? now : day,
        before: startOfDay(addDays(day, 1)),
      }
    })
    .sort((a, b) => a.after.getTime() - b.after.getTime())
}

/**
 * Weekday-only phrasing ("during the week", "entre semana") → the upcoming
 * Monday–Friday block, mirroring `weekendWindow`: already inside it → start
 * now; otherwise → the coming Monday through Friday.
 */
function weekdaysWindow(now: Date): { after: Date; before: Date } {
  const dayOfWeek = getDay(now)
  if (dayOfWeek >= 1 && dayOfWeek <= 5) {
    // Already a weekday — start now, end Saturday midnight.
    const daysUntilSaturday = 6 - dayOfWeek
    const saturday = startOfDay(addDays(now, daysUntilSaturday))
    return { after: now, before: saturday }
  }
  // Weekend — the coming Monday through Friday.
  const daysUntilMonday = dayOfWeek === 6 ? 2 : 1
  const monday = startOfDay(addDays(now, daysUntilMonday))
  return { after: monday, before: startOfDay(addDays(monday, 5)) }
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

  // --- annotate once: normalize → tokenize → match → resolve → residue ---
  const annotated = annotateQuery(query, buildQueryAnnotationRules(input.timeFilter))
  const spans = annotated.spans

  // Derived from resolved spans — never by re-scanning token values.
  const hadGenericDiscoveryIntent = spans.some((s) => s.kind === 'generic_discovery')
  const weekdays = new Set(
    spans.filter((s) => s.kind === 'weekday').map((s) => s.value as number)
  )
  const hasWeekdayRange = spans.some((s) => s.kind === 'weekday_range')
  const queryNeighborhoods = spans
    .filter((s) => s.kind === 'neighborhood')
    .map((s) => s.value as Neighborhood)

  const must: EventSearchMust = {}
  const avoid: EventSearchAvoid = {}

  // displayLimit: default 1, clamped 1..5 (never lower than 1 so a negative
  // limit cannot slice(0, negative)). Vague discovery asks (a time window /
  // vibe / prefer with no named constraint and no explicit limit) default to 3
  // below, once the objective and hard-must set are known.
  const explicitLimit = input.limit !== undefined
  let displayLimit = Math.max(1, Math.min(input.limit ?? DISPLAY_LIMIT_DEFAULT, DISPLAY_LIMIT_MAX))

  // --- isFree from explicit input or free-language spans ---
  let isFree = input.isFree ?? false
  if (spans.some((s) => s.kind === 'free')) isFree = true
  if (isFree) must.isFree = true

  // --- neighborhoods (explicit + contiguous query spans) ---
  const neighborhoods = resolveNeighborhoods(input.neighborhoods ?? [], queryNeighborhoods)
  if (neighborhoods.length > 0) must.neighborhoodIds = neighborhoods

  // --- venues ---
  if (input.venueIds?.length) {
    must.venueIds = input.venueIds
  } else if (input.venueName) {
    const venues = await searchVenuesByName(input.venueName)
    must.venueIds = venues.map((v) => v.id)
  }

  // --- weekday / weekday-range / timeFilter / dateFrom-dateTo ---
  // Named weekdays ("lunes o martes" → both days) win over weekday-only
  // phrasing, which wins over the structured timeFilter. The weekday-range
  // span is already suppressed when a named weekday is present.
  if (weekdays.size > 0) {
    const windows = weekdayWindows(nowBA, [...weekdays])
    if (windows.length === 1) {
      must.startsAfter = baToUTC(windows[0].after)
      must.startsBefore = baToUTC(windows[0].before)
    } else {
      must.weekdayWindows = windows.map((w) => ({
        startsAfter: baToUTC(w.after),
        startsBefore: baToUTC(w.before),
      }))
    }
  } else if (hasWeekdayRange) {
    const w = weekdaysWindow(nowBA)
    must.startsAfter = baToUTC(w.after)
    must.startsBefore = baToUTC(w.before)
  } else {
    applyTimeFilter(must, input.timeFilter, nowBA)
  }

  // dateFrom/dateTo: win over timeFilter / weekday window. When both a window
  // and an explicit range exist, intersect — use the later start and the
  // earlier end. Never widen. An empty intersection (after >= before) is
  // preserved so SQL returns no rows.
  if (input.dateFrom || input.dateTo) {
    const explicit = dateRangeBounds(input.dateFrom, input.dateTo)
    if (must.weekdayWindows) {
      must.weekdayWindows = must.weekdayWindows.map((w) => ({
        startsAfter: latest(w.startsAfter, explicit.after)!,
        startsBefore: earliest(w.startsBefore, explicit.before)!,
      }))
    } else {
      must.startsAfter = latest(must.startsAfter, explicit.after)
      must.startsBefore = earliest(must.startsBefore, explicit.before)
    }
  }

  // --- categorical / price / age pass-through ---
  if (input.categories?.length) must.categories = input.categories
  if (input.maxPrice !== undefined) must.maxPrice = input.maxPrice
  if (input.minAge !== undefined) must.attendeeAge = input.minAge

  // --- avoid (free-text exclusions mapped onto the closed facet genre keys) ---
  const avoidGenres = mapAvoidGenres(input.avoid)
  if (avoidGenres.length > 0) avoid.genres = avoidGenres

  // --- semanticQuery: ordered unconsumed tokens (the annotator's residue) ---
  let semanticQuery = annotated.semanticQuery

  // Prefer is retrieval text only — never a filter. It merges explicit
  // `input.prefer` with soft hints extracted from the free-text query tokens.
  // When the user-facing semanticQuery is empty but prefer terms exist, append
  // them so the hybrid retriever still has something to embed / lexically match.
  const prefer = mergePrefer(input.prefer, extractPreferFromQuery(annotated.normalizedQuery))
  if (!semanticQuery) {
    semanticQuery = joinPreferIntoQuery(prefer)
  }

  const objective = resolveObjective(input, must, semanticQuery, hadGenericDiscoveryIntent)
  // Vague discovery asks (no explicit limit, not a surprise pick, no named
  // constraint) default to a short list of 3 rather than a single pick.
  if (
    !explicitLimit &&
    objective !== 'surprise' &&
    !hasHardMust(input, must, weekdays)
  ) {
    displayLimit = 3
  }

  return {
    must,
    prefer,
    avoid,
    semanticQuery,
    displayLimit,
    candidateLimit: CANDIDATE_LIMIT,
    objective,
    annotation: annotated.trace,
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
  semanticQuery: string,
  hadGenericDiscoveryIntent: boolean
): 'search' | 'surprise' {
  // Non-empty semantic text is always a directed search, never a surprise.
  if (semanticQuery) return 'search'
  // Hard must constraints / a non-default window are a directed search.
  if (!isDefaultWindowOnly(input, must)) return 'search'
  // Passed the gate. An explicit `objective: 'search'` must never surprise;
  // an explicit `surprise` still picks (the real "surprise me" path).
  if (input.objective === 'search') return 'search'
  if (input.objective === 'surprise') return 'surprise'
  // A generic discovery ask ("what's on?", "qué hay?", "things to do") with no
  // other signal is a directed discovery search, not a surprise pick.
  if (hadGenericDiscoveryIntent) return 'search'
  // Truly empty/default input → surprise.
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
  // A multi-weekday ask ("Monday or Friday") is an exact-window constraint,
  // not the default upcoming window — never surprise.
  if (must.weekdayWindows && must.weekdayWindows.length > 0) return false
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

// True when the intent carries a named constraint that should keep the default
// display limit at 1 (neighborhood / venue / category / free / price / age /
// explicit date or named weekday). A timeFilter preset is NOT a hard must —
// "what's on tonight?" is a discovery list, not a decisive pick.
function hasHardMust(
  input: CanonicalizeInput,
  must: EventSearchMust,
  weekdays: Set<number>
): boolean {
  if ((must.neighborhoodIds?.length ?? 0) > 0) return true
  if ((must.venueIds?.length ?? 0) > 0) return true
  if ((must.categories?.length ?? 0) > 0) return true
  if (must.isFree !== undefined) return true
  if (must.maxPrice !== undefined) return true
  if (must.attendeeAge !== undefined) return true
  if (input.dateFrom || input.dateTo) return true
  if (weekdays.size > 0) return true
  return false
}

// Join prefer terms into a retrieval query string when the user gave no
// semantic text of their own. Preferred facets become the query so the dense +
// lexical retrievers still have signal.
function joinPreferIntoQuery(prefer: EventSearchPrefer): string {
  const terms = [
    ...(prefer.genres ?? []),
    ...(prefer.vibes ?? []),
    ...(prefer.activities ?? []),
    ...(prefer.audience ?? []),
    ...(prefer.setting ?? []),
  ]
  return terms.join(' ')
}

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
