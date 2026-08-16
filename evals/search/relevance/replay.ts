#!/usr/bin/env bun
/**
 * Offline replay for the conclusive rerank eval.
 *
 * Reads the frozen live capture (capture-latest.json) and graded labels
 * (live-labels.ts) and scores rerank variants with NO network and NO env keys.
 * Every variant is computed from the frozen ranks, so fused-weight sweeps are
 * exact — nothing re-hits Voyage.
 *
 * Variants per query:
 *   baseline  — the frozen retrieval order, unchanged.
 *   facet     — production-equivalent facet/chill rerank (facetRerank).
 *   voyage    — order by rerankerRank asc (fallback to baseline when unapplied).
 *   fused(w)  — w/(60+rerankerRank) + 1/(60+baseRank) desc, ties by baseRank.
 *
 * Usage: bun evals/search/relevance/replay.ts [--labels <path>]
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { facetRerank } from './rerank-variants.ts'
import type { SearchScoreable } from '#features/chat/api/tools/quality-diversity.ts'
import type { EventSearchPrefer } from '#features/chat/api/tools/search-intent.ts'

// ============================================================================
// Frozen artifact shapes (mirror capture.ts)
// ============================================================================

interface FrozenEvent {
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

interface FrozenRank {
  baseRank: number
  rerankerRank: number
  rerankerScore: number
  finalRank: number
}

interface FrozenVoyage {
  status: string
  model?: string
  ranks?: Record<string, FrozenRank>
}

interface FrozenQuery {
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
}

interface CaptureFile {
  meta: {
    capturedAt: string
    nowBA: string
    queries: number
  }
  events: Record<string, FrozenEvent>
  queries: FrozenQuery[]
}

const NDCG_K = 5

// ============================================================================
// CLI + input loading
// ============================================================================

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const CAPTURE_PATH = new URL('./capture-latest.json', import.meta.url).pathname
const labelsArg = argValue('--labels')
const labelsPath = labelsArg
  ? resolve(process.cwd(), labelsArg)
  : new URL('./live-labels.ts', import.meta.url).pathname

const capture: CaptureFile = JSON.parse(readFileSync(CAPTURE_PATH, 'utf-8'))
const { LIVE_LABELS } = (await import(pathToFileURL(labelsPath).href)) as {
  LIVE_LABELS: Record<string, Record<string, 0 | 1 | 2 | 3>>
}

// ============================================================================
// Frozen event → SearchScoreable adapter (mirrors corpusToScoreable)
// ============================================================================

function asStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const out = value.filter((v): v is string => typeof v === 'string')
    return out.length > 0 ? out : undefined
  }
  if (typeof value === 'string' && value.trim().length > 0) return [value]
  return undefined
}

const ENERGY_VALUES = ['low', 'medium', 'high'] as const
type Energy = (typeof ENERGY_VALUES)[number]

function asEnergy(value: unknown): Energy | undefined {
  if (typeof value === 'string' && (ENERGY_VALUES as readonly string[]).includes(value)) {
    return value as Energy
  }
  return undefined
}

function toScoreable(e: FrozenEvent): SearchScoreable {
  return {
    id: e.id,
    name: e.name,
    starts_at: e.starts_at,
    image_url: e.image_url,
    venue_id: e.venue_id,
    venue_name: e.venue_name,
    location_tba: e.location_tba,
    description_unavailable: e.description_unavailable,
    categories: e.categories,
    facets: {
      genres: asStringArray(e.facets.genres),
      vibes: asStringArray(e.facets.vibes) ?? asStringArray(e.facets.vibe),
      activities: asStringArray(e.facets.activities) ?? asStringArray(e.facets.activity),
      audience: asStringArray(e.facets.audience) ?? asStringArray(e.facets.audiences),
      setting: asStringArray(e.facets.setting) ?? asStringArray(e.facets.settings),
      energy: asEnergy(e.facets.energy),
      eventType: asStringArray(e.facets.eventType) ?? asStringArray(e.facets.event_type),
    },
  }
}

// ============================================================================
// Variant orders
// ============================================================================

function baseOrder(q: FrozenQuery): string[] {
  return [...q.baseOrder]
}

function facetOrder(q: FrozenQuery, events: Record<string, FrozenEvent>): string[] {
  const scoreables = q.baseOrder.map((id) => toScoreable(events[id]))
  return facetRerank(scoreables, q.semanticQuery, q.prefer).map((s) => s.id)
}

function voyageOrder(q: FrozenQuery): string[] {
  if (q.voyage.status !== 'applied' || !q.voyage.ranks) return [...q.baseOrder]
  return [...q.baseOrder].sort(
    (a, b) =>
      (q.voyage.ranks![a]?.rerankerRank ?? Infinity) -
      (q.voyage.ranks![b]?.rerankerRank ?? Infinity)
  )
}

function fusedOrder(q: FrozenQuery, w: number): string[] {
  if (q.voyage.status !== 'applied' || !q.voyage.ranks) return [...q.baseOrder]
  const ranks = q.voyage.ranks!
  const baseRank = new Map(q.baseOrder.map((id, i) => [id, i + 1]))
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

const variants = [
  { name: 'baseline', order: (q: FrozenQuery) => baseOrder(q) },
  { name: 'facet', order: (q: FrozenQuery) => facetOrder(q, capture.events) },
  { name: 'voyage', order: (q: FrozenQuery) => voyageOrder(q) },
  { name: 'fused(1)', order: (q: FrozenQuery) => fusedOrder(q, 1) },
  { name: 'fused(2)', order: (q: FrozenQuery) => fusedOrder(q, 2) },
  { name: 'fused(3)', order: (q: FrozenQuery) => fusedOrder(q, 3) },
]

const ordersByName: Record<string, string[][]> = {}
for (const v of variants) {
  ordersByName[v.name] = capture.queries.map((q) => v.order(q))
}

// ============================================================================
// Metrics (run.ts semantics)
// ============================================================================

function dcg(grades: number[]): number {
  return grades.reduce((sum, g, i) => sum + g / Math.log2(i + 2), 0)
}

function queryMetrics(
  order: string[],
  labels: Record<string, 0 | 1 | 2 | 3> | undefined
): { ndcg5: number; hit1: number; labeled: boolean } {
  const l = labels ?? {}
  const entries = Object.entries(l)
  if (entries.length === 0) return { ndcg5: 0, hit1: 0, labeled: false }

  const actualTop5 = order.slice(0, NDCG_K).map((id) => l[id] ?? 0)
  const idealTop5 = Object.values(l)
    .sort((a, b) => b - a)
    .slice(0, NDCG_K)
  const idealDcg = dcg(idealTop5)
  const ndcg5 = idealDcg > 0 ? dcg(actualTop5) / idealDcg : 0
  const hit1 = order.length > 0 && (l[order[0]] ?? 0) >= 2 ? 1 : 0
  return { ndcg5, hit1, labeled: true }
}

interface Summary {
  ndcg5: number
  hit1: number
  n: number
  excluded: number
}

function summarize(variantOrders: string[][], indices: number[]): Summary {
  let ndcgSum = 0
  let hitSum = 0
  let n = 0
  let excluded = 0
  for (const i of indices) {
    const m = queryMetrics(variantOrders[i], LIVE_LABELS[capture.queries[i].id])
    if (m.labeled) {
      ndcgSum += m.ndcg5
      hitSum += m.hit1
      n += 1
    } else {
      excluded += 1
    }
  }
  return { ndcg5: n > 0 ? ndcgSum / n : 0, hit1: n > 0 ? hitSum / n : 0, n, excluded }
}

function printTable(title: string, indices: number[]): void {
  console.log(`\n--- ${title} ---`)
  console.log(
    `${'variant'.padEnd(10)} ${'ndcg@5'.padStart(8)} ${'hit@1'.padStart(7)} ${'n'.padStart(5)} ${'excluded'.padStart(9)}`
  )
  for (const v of variants) {
    const s = summarize(ordersByName[v.name], indices)
    console.log(
      `${v.name.padEnd(10)} ${s.ndcg5.toFixed(3).padStart(8)} ${s.hit1.toFixed(3).padStart(7)} ` +
        `${String(s.n).padStart(5)} ${String(s.excluded).padStart(9)}`
    )
  }
}

function rankDisplacement(baseline: string[], variant: string[], relevant: Set<string>): number | null {
  const baseRank = new Map(baseline.map((id, i) => [id, i]))
  const varRank = new Map(variant.map((id, i) => [id, i]))
  let total = 0
  let count = 0
  for (const id of relevant) {
    const b = baseRank.get(id)
    const v = varRank.get(id)
    if (b === undefined || v === undefined) continue
    total += Math.abs(v - b)
    count += 1
  }
  return count > 0 ? total / count : null
}

// ============================================================================
// Report
// ============================================================================

const allIndices = capture.queries.map((_, i) => i)
const overall = summarize(ordersByName['baseline'], allIndices)
const labeledQueries = overall.n
const noCandidateQueries = capture.queries.filter((q) => q.baseOrder.length === 0).length
const unlabeledQueries = capture.queries.filter(
  (q) => q.baseOrder.length > 0 && Object.keys(LIVE_LABELS[q.id] ?? {}).length === 0
).length

console.log(`\n=== replay (offline) ===`)
console.log(`capture : ${CAPTURE_PATH} (${capture.meta.queries} queries, ${Object.keys(capture.events).length} events)`)
console.log(`labels  : ${labelsPath}`)
console.log(
  `\n*** ${labeledQueries} scored queries, ${noCandidateQueries} excluded with no candidates, ` +
    `${unlabeledQueries} excluded without labels${unlabeledQueries > 0 ? ' — result is INCOMPLETE' : ''} ***`
)

printTable('overall', allIndices)
printTable(
  'subjective: true',
  allIndices.filter((i) => capture.queries[i].subjective)
)
printTable(
  'subjective: false',
  allIndices.filter((i) => !capture.queries[i].subjective)
)
for (const lang of ['es', 'en', 'mixed'] as const) {
  printTable(
    `lang: ${lang}`,
    allIndices.filter((i) => capture.queries[i].lang === lang)
  )
}

console.log(`\n--- mean rank displacement vs baseline ---`)
const baselineOrders = ordersByName['baseline']
for (const v of variants) {
  if (v.name === 'baseline') continue
  let total = 0
  let queriesWithData = 0
  for (let i = 0; i < capture.queries.length; i++) {
    const labels = LIVE_LABELS[capture.queries[i].id]
    if (!labels || Object.keys(labels).length === 0) continue
    const relevant = new Set(
      Object.entries(labels)
        .filter(([, g]) => g >= 2)
        .map(([id]) => id)
    )
    const d = rankDisplacement(baselineOrders[i], ordersByName[v.name][i], relevant)
    if (d !== null) {
      total += d
      queriesWithData += 1
    }
  }
  const mean = queriesWithData > 0 ? total / queriesWithData : null
  console.log(`${v.name.padEnd(10)}: ${mean === null ? 'n/a' : mean.toFixed(3)}`)
}
