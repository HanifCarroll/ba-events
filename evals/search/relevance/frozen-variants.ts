/**
 * Shared frozen-artifact shapes + deterministic variant ordering.
 *
 * capture.ts writes these shapes; pool.ts, replay.ts and audit.ts all read them
 * and need the exact same variant orders, so the adapters live here once.
 *
 * No network, no env keys, no DB. Everything is derived from the frozen
 * baseOrder and the hosted reranker ranks captured at freeze time.
 */

import type { EventSearchPrefer } from '#features/chat/api/tools/search-intent.ts'
import type { EventFilters } from '#shared/lib/types.ts'

// ============================================================================
// Frozen artifact shapes (mirror capture.ts)
// ============================================================================

export interface FrozenEvent {
  id: string
  name: string
  starts_at: string
  is_free: boolean
  price: number | null
  min_age: number | null
  categories: string[]
  venue_id: string | null
  venue_name: string | null
  venue_neighborhood: string | null
  image_url: string | null
  location_tba: boolean
  description_unavailable: boolean
  description_summary_es: string | null
  description_summary_en: string | null
  description_es: string | null
  description_en: string | null
  facets: Record<string, unknown>
}

export interface FrozenRank {
  baseRank: number
  rerankerRank: number
  rerankerScore: number
  finalRank: number
}

export interface FrozenVoyage {
  status: string
  model?: string
  ranks?: Record<string, FrozenRank>
}

export interface FrozenQuery {
  filters?: EventFilters
  id: string
  query: string
  subjective: boolean
  lang: 'es' | 'en' | 'mixed'
  hasMust: boolean
  path: 'semantic' | 'filter_only'
  semanticQuery: string
  prefer: EventSearchPrefer
  baseOrder: string[]
  voyage: FrozenVoyage
  /** Frozen canonicalized display limit (1-5). Absent on pre-extension captures. */
  displayLimit?: number
}

export interface CaptureFile {
  meta: {
    suiteVersion?: string
    queryFileSha256?: string
    diagnosticQueryIds?: string[]
    complete?: boolean
    capturedAt: string
    nowBA: string
    queries: number
  }
  events: Record<string, FrozenEvent>
  queries: FrozenQuery[]
}

export function asStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const out = value.filter((v): v is string => typeof v === 'string')
    return out.length > 0 ? out : undefined
  }
  if (typeof value === 'string' && value.trim().length > 0) return [value]
  return undefined
}

const ENERGY_VALUES = ['low', 'medium', 'high'] as const
type Energy = (typeof ENERGY_VALUES)[number]

export function asEnergy(value: unknown): Energy | undefined {
  if (typeof value === 'string' && (ENERGY_VALUES as readonly string[]).includes(value)) {
    return value as Energy
  }
  return undefined
}

// ============================================================================
// Deterministic variant orders
// ============================================================================

/** The frozen retrieval order (RRF hybrid or filter-only), unchanged. */
export function baseOrder(q: FrozenQuery): string[] {
  return [...q.baseOrder]
}

function baseRankMap(q: FrozenQuery): Map<string, number> {
  return new Map(q.baseOrder.map((id, i) => [id, i + 1]))
}

/**
 * Pure hosted-Voyage order: sort by rerankerRank asc. When the reranker was
 * not applied, fail closed to base order.
 */
export function voyageOrder(q: FrozenQuery): string[] {
  if (q.voyage.status !== 'applied' || !q.voyage.ranks) return [...q.baseOrder]
  return [...q.baseOrder].sort(
    (a, b) =>
      (q.voyage.ranks![a]?.rerankerRank ?? Infinity) -
      (q.voyage.ranks![b]?.rerankerRank ?? Infinity)
  )
}

/**
 * Weighted rank fusion: w/(60+rerankerRank) + 1/(60+baseRank) desc, ties by
 * lower baseRank first. Fail closed to base order when Voyage was not applied.
 */
export function fusedOrder(q: FrozenQuery, w: number): string[] {
  if (q.voyage.status !== 'applied' || !q.voyage.ranks) return [...q.baseOrder]
  const ranks = q.voyage.ranks!
  const baseRank = baseRankMap(q)
  return [...q.baseOrder].sort((a, b) => {
    const ra = ranks[a]?.rerankerRank ?? Infinity
    const rb = ranks[b]?.rerankerRank ?? Infinity
    const ba = baseRank.get(a) ?? Infinity
    const bb = baseRank.get(b) ?? Infinity
    const sa = w / (60 + ra) + 1 / (60 + ba)
    const sb = w / (60 + rb) + 1 / (60 + bb)
    if (sb !== sa) return sb - sa
    return ba - bb
  })
}

/** Frozen canonicalized display limit, defaulting to 1 for pre-extension captures. */
export function displayLimitOf(q: FrozenQuery): number {
  return q.displayLimit ?? 1
}

/**
 * Frozen reranking-depth ablation: rerank only the first `depth` base
 * candidates by their frozen Voyage rank, then append the rest in original
 * base (RRF) order. Fail closed to base order when Voyage was not applied.
 */
export function depthVoyageOrder(q: FrozenQuery, depth: number): string[] {
  if (q.voyage.status !== 'applied' || !q.voyage.ranks) return [...q.baseOrder]
  const ranks = q.voyage.ranks!
  const baseRank = baseRankMap(q)
  const head = q.baseOrder.slice(0, depth)
  const tail = q.baseOrder.slice(depth)
  head.sort((a, b) => {
    const ra = ranks[a]?.rerankerRank ?? Infinity
    const rb = ranks[b]?.rerankerRank ?? Infinity
    if (ra !== rb) return ra - rb
    return (baseRank.get(a) ?? Infinity) - (baseRank.get(b) ?? Infinity)
  })
  return [...head, ...tail]
}
