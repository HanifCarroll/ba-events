/** Declared before fresh retrieval capture; developer-authored cases, not independent quality labels. */
import type { HoldoutQuery } from './holdout-queries.ts'

export const SUITE_VERSION = 'retrieval-refresh-2026-10-v1'
// These two reuse a known enrichment failure class and are development diagnostics.
export const DIAGNOSTIC_QUERY_IDS = ['oct-en-tango-class', 'oct-es-tango-class']

export const HOLDOUT_QUERIES: HoldoutQuery[] = [
  { id: 'oct-en-tango-class', query: 'a beginner tango class where I can practice dancing', subjective: false, lang: 'en', hasMust: false, toolInput: { limit: 3 } },
  { id: 'oct-es-tango-class', query: 'una clase de tango para principiantes para practicar el baile', subjective: false, lang: 'es', hasMust: false, toolInput: { limit: 3 } },
  { id: 'oct-en-dance-chat', query: 'somewhere to dance and still be able to chat, without a packed club', subjective: true, lang: 'en', hasMust: false, toolInput: { limit: 3 } },
  { id: 'oct-es-dance-chat', query: 'un lugar para bailar y poder charlar, sin un boliche explotado', subjective: true, lang: 'es', hasMust: false, toolInput: { limit: 3 } },
  { id: 'oct-en-free-recoleta', query: 'free cultural events in Recoleta this week', subjective: false, lang: 'en', hasMust: true, toolInput: { isFree: true, neighborhoods: ['Recoleta'], timeFilter: 'week', limit: 5 } },
  { id: 'oct-es-free-recoleta', query: 'planes culturales gratis en Recoleta esta semana', subjective: false, lang: 'es', hasMust: true, toolInput: { isFree: true, neighborhoods: ['Recoleta'], timeFilter: 'week', limit: 5 } },
  { id: 'oct-en-ceramics-weekend', query: 'a hands-on ceramics workshop this weekend', subjective: false, lang: 'en', hasMust: true, toolInput: { timeFilter: 'weekend', limit: 3 } },
  { id: 'oct-es-ceramics-weekend', query: 'un taller práctico de cerámica este finde', subjective: false, lang: 'es', hasMust: true, toolInput: { timeFilter: 'weekend', limit: 3 } },
  { id: 'oct-en-jazz-almagro', query: 'live jazz in Almagro', subjective: false, lang: 'en', hasMust: true, toolInput: { neighborhoods: ['Almagro'], limit: 3 } },
  { id: 'oct-es-jazz-almagro', query: 'jazz en vivo en Almagro', subjective: false, lang: 'es', hasMust: true, toolInput: { neighborhoods: ['Almagro'], limit: 3 } },
  { id: 'oct-en-family-budget', query: 'weekend plans with a twelve-year-old for at most twenty thousand pesos', subjective: true, lang: 'en', hasMust: true, toolInput: { timeFilter: 'weekend', maxPrice: 20000, minAge: 12, limit: 3 } },
  { id: 'oct-es-family-budget', query: 'planes de finde con un chico de doce años por hasta veinte mil pesos', subjective: true, lang: 'es', hasMust: true, toolInput: { timeFilter: 'weekend', maxPrice: 20000, minAge: 12, limit: 3 } },
]
