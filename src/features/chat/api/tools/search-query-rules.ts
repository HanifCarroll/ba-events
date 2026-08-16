/**
 * Declarative query-syntax rules for search_events canonicalization.
 *
 * These rules recognize narrow request structure only: discovery
 * scaffolding, active temporal syntax, weekdays, neighborhoods, free
 * markers, and filler. They do not score relevance or classify
 * subjective suitability.
 */

import { NEIGHBORHOODS, type Neighborhood } from '#shared/lib/types.ts'
import { normalizeText } from '#shared/lib/utils/normalize-text.ts'
import type { QueryRule } from './search-query-annotations.ts'

export type SearchTimeFilter =
  | 'now'
  | 'tonight'
  | 'tomorrow'
  | 'weekend'
  | 'week'
  | 'future'

const SEMANTIC_FILLER = new Set([
  'el',
  'la',
  'los',
  'las',
  'lo',
  'un',
  'una',
  'unos',
  'unas',
  'de',
  'del',
  'en',
  'a',
  'y',
  'o',
  'que',
  'para',
  'por',
  'con',
  'al',
  'in',
  'and',
  'or',
])

const FREE_SINGLE_TOKENS = ['gratis', 'gratuito', 'free']

const FREE_PHRASES: string[][] = [
  ['sin', 'costo'],
  ['sin', 'cargo'],
  ['a', 'la', 'gorra'],
]

const WEEKDAY_TOKENS: Record<string, number> = {
  lunes: 1,
  monday: 1,
  martes: 2,
  tuesday: 2,
  miercoles: 3,
  wednesday: 3,
  jueves: 4,
  thursday: 4,
  viernes: 5,
  friday: 5,
  sabado: 6,
  saturday: 6,
  domingo: 0,
  sunday: 0,
}

/**
 * Weekday-only phrasing meaning Monday–Friday, not timeFilter "week".
 * These spans remain annotated and consumed beside named weekdays;
 * intent construction gives the named weekday precedence.
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

const GENERIC_DISCOVERY_PHRASES: string[][] = [
  ['planes'],
  ['eventos'],
  ['actividades'],
  ['cosas', 'para', 'hacer'],
  ['algo', 'para', 'hacer'],
  ['que', 'hay'],
  ['hay', 'eventos'],
  ['hay', 'algun', 'evento'],
  ['what', 's', 'on'],
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

const TEMPORAL_PHRASES_BY_FILTER: Record<SearchTimeFilter, string[][]> = {
  now: [['now'], ['right', 'now'], ['ahora'], ['en', 'este', 'momento']],
  tonight: [
    ['tonight'],
    ['this', 'evening'],
    ['esta', 'noche'],
    ['hoy', 'a', 'la', 'noche'],
  ],
  tomorrow: [['tomorrow'], ['manana']],
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

export const NORMALIZED_NEIGHBORHOODS: Array<{
  name: Neighborhood
  tokens: string[]
}> = NEIGHBORHOODS.map((name) => ({
  name,
  tokens: normalizeText(name).split(' ').filter(Boolean),
}))

const FILLER_RULES: QueryRule[] = [...SEMANTIC_FILLER].map((token) => ({
  phrase: [token],
  kind: 'filler' as const,
}))

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

const WEEKDAY_RULES: QueryRule[] = Object.entries(WEEKDAY_TOKENS).map(
  ([token, day]) => ({
    phrase: [token],
    kind: 'weekday' as const,
    value: day,
  })
)

const WEEKDAY_RANGE_RULES: QueryRule[] = WEEKDAY_PHRASES.map((phrase) => ({
  phrase,
  kind: 'weekday_range' as const,
}))

const GENERIC_RULES: QueryRule[] = GENERIC_DISCOVERY_PHRASES.map((phrase) => ({
  phrase,
  kind: 'generic_discovery' as const,
}))

const NEIGHBORHOOD_RULES: QueryRule[] = NORMALIZED_NEIGHBORHOODS.map((nb) => ({
  phrase: nb.tokens,
  kind: 'neighborhood' as const,
  value: nb.name,
}))

function temporalRules(timeFilter: SearchTimeFilter | undefined): QueryRule[] {
  if (!timeFilter) return []
  return TEMPORAL_PHRASES_BY_FILTER[timeFilter].map((phrase) => ({
    phrase,
    kind: 'temporal' as const,
    value: timeFilter,
  }))
}

export function buildQueryAnnotationRules(
  timeFilter: SearchTimeFilter | undefined
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
