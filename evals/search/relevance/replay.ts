#!/usr/bin/env bun
/**
 * Offline replay for the conclusive rerank eval.
 *
 * Reads the frozen capture and graded labels and scores rerank variants with
 * NO network and NO env keys. Every variant is computed from the frozen ranks,
 * so fused-weight sweeps are exact — nothing re-hits Voyage.
 *
 * Variants per query:
 *   baseline  — the frozen retrieval order, unchanged.
 *   voyage    — order by rerankerRank asc (fallback to baseline when unapplied).
 *   fused(w)  — w/(60+rerankerRank) + 1/(60+baseRank) desc, ties by baseRank.
 *
 * Also reports a frozen reranking-depth ablation (pure Voyage at depths
 * 10/20/30/50) with mechanical request-size proxies — no live request is made.
 *
 * Before any table is printed, replay verifies that every event in the top five
 * of every reported variant (including the depth variants) has an explicit
 * label entry (an explicit zero counts). Missing entries are printed and the
 * process exits nonzero; an unjudged measured top-five event is never silently
 * treated as grade zero.
 *
 * Usage:
 *   bun evals/search/relevance/replay.ts
 *   bun evals/search/relevance/replay.ts --capture ./capture-holdout.json --labels ./live-labels.ts
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildRerankDocument, type RerankDocumentEvent } from '#shared/lib/search/rerank.ts'
import {
  baseOrder,
  fusedOrder,
  voyageOrder,
  depthVoyageOrder,
  displayLimitOf,
  asStringArray,
  type CaptureFile,
  type FrozenEvent,
  type FrozenQuery,
} from './frozen-variants.ts'

// ============================================================================
// CLI + input loading
// ============================================================================

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const captureArg = argValue('--capture')
const labelsArg = argValue('--labels')

const CAPTURE_PATH = captureArg
  ? resolve(process.cwd(), captureArg)
  : new URL('./capture-latest.json', import.meta.url).pathname
const labelsPath = labelsArg
  ? resolve(process.cwd(), labelsArg)
  : new URL('./live-labels.ts', import.meta.url).pathname

const capture: CaptureFile = JSON.parse(readFileSync(CAPTURE_PATH, 'utf-8'))
const { LIVE_LABELS } = (await import(pathToFileURL(labelsPath).href)) as {
  LIVE_LABELS: Record<string, Record<string, 0 | 1 | 2 | 3>>
}

// ============================================================================
// Variant orders
// ============================================================================

interface Variant {
  name: string
  order: (q: FrozenQuery) => string[]
}

const variants: Variant[] = [
  { name: 'baseline', order: baseOrder },
  { name: 'voyage', order: voyageOrder },
  { name: 'fused(1)', order: (q) => fusedOrder(q, 1) },
  { name: 'fused(2)', order: (q) => fusedOrder(q, 2) },
  { name: 'fused(3)', order: (q) => fusedOrder(q, 3) },
]

const DEPTH_DEPTHS = [10, 20, 30, 50]

const ordersByName: Record<string, string[][]> = {}
for (const v of variants) {
  ordersByName[v.name] = capture.queries.map((q) => v.order(q))
}

// ============================================================================
// Completeness check (must pass before any report is printed)
// ============================================================================

interface NamedOrders {
  name: string
  orders: string[][]
}

const checkOrders: NamedOrders[] = [
  ...variants.map((v) => ({ name: v.name, orders: ordersByName[v.name] })),
  // depth(50) === pure voyage, already covered above; 10/20/30 are not.
  { name: 'depth(10)', orders: capture.queries.map((q) => depthVoyageOrder(q, 10)) },
  { name: 'depth(20)', orders: capture.queries.map((q) => depthVoyageOrder(q, 20)) },
  { name: 'depth(30)', orders: capture.queries.map((q) => depthVoyageOrder(q, 30)) },
]

const missing: Array<{ queryId: string; variant: string; eventId: string }> = []
for (const no of checkOrders) {
  for (let i = 0; i < capture.queries.length; i++) {
    const q = capture.queries[i]
    if (q.baseOrder.length === 0) continue // excluded separately, not a missing label
    const labels = LIVE_LABELS[q.id] ?? {}
    for (const id of no.orders[i].slice(0, 5)) {
      if (!(id in labels)) missing.push({ queryId: q.id, variant: no.name, eventId: id })
    }
  }
}

if (missing.length > 0) {
  console.error(
    `\n=== completeness check FAILED: ${missing.length} unlabeled measured top-five event${missing.length === 1 ? '' : 's'} ===`
  )
  for (const m of missing) {
    console.error(`  missing label: query=${m.queryId} variant=${m.variant} event=${m.eventId}`)
  }
  console.error(
    `\nlabel every listed event (explicit 0..3) and re-run. Refusing to report while measured top-five events are unjudged.`
  )
  process.exit(1)
}

// ============================================================================
// Metrics
// ============================================================================

type Grade = 0 | 1 | 2 | 3

function dcg(grades: number[]): number {
  return grades.reduce((sum, g, i) => sum + g / Math.log2(i + 2), 0)
}

/** Ideal DCG from the explicitly judged pool (all grades for the query). */
function idealDcgAt(labels: Record<string, Grade>, k: number): number {
  return dcg(Object.values(labels).sort((a, b) => b - a).slice(0, k))
}

function ndcgAt(order: string[], labels: Record<string, Grade>, k: number): number {
  const actual = order.slice(0, k).map((id) => labels[id] ?? 0)
  const ideal = idealDcgAt(labels, k)
  return ideal > 0 ? dcg(actual) / ideal : 0
}

interface QueryMetrics {
  ndcg3: number
  ndcg5: number
  ndcgK: number
  grade1: number | null
  excellent1: number
  relevant1: number
  bad1: number
}

function queryMetrics(
  order: string[],
  labels: Record<string, Grade>,
  displayLimit: number
): QueryMetrics {
  const k = Math.max(1, Math.min(displayLimit, 5))
  const grade1 = order.length > 0 ? (labels[order[0]] ?? 0) : null
  return {
    ndcg3: ndcgAt(order, labels, 3),
    ndcg5: ndcgAt(order, labels, 5),
    ndcgK: ndcgAt(order, labels, k),
    grade1,
    excellent1: grade1 === 3 ? 1 : 0,
    relevant1: grade1 !== null && grade1 >= 2 ? 1 : 0,
    bad1: grade1 === 0 ? 1 : 0,
  }
}

interface Summary {
  ndcg3: number
  ndcg5: number
  ndcgK: number
  grade1: number
  excellent1: number
  relevant1: number
  bad1: number
  n: number
  excluded: number
}

function summarize(variantOrders: string[][], indices: number[]): Summary {
  let ndcg3Sum = 0
  let ndcg5Sum = 0
  let ndcgKSum = 0
  let grade1Sum = 0
  let excellentSum = 0
  let relevantSum = 0
  let badSum = 0
  let n = 0
  let excluded = 0
  for (const i of indices) {
    const q = capture.queries[i]
    if (q.baseOrder.length === 0) {
      excluded += 1
      continue
    }
    const m = queryMetrics(variantOrders[i], LIVE_LABELS[q.id] ?? {}, displayLimitOf(q))
    ndcg3Sum += m.ndcg3
    ndcg5Sum += m.ndcg5
    ndcgKSum += m.ndcgK
    grade1Sum += m.grade1 ?? 0
    excellentSum += m.excellent1
    relevantSum += m.relevant1
    badSum += m.bad1
    n += 1
  }
  return {
    ndcg3: n > 0 ? ndcg3Sum / n : 0,
    ndcg5: n > 0 ? ndcg5Sum / n : 0,
    ndcgK: n > 0 ? ndcgKSum / n : 0,
    grade1: n > 0 ? grade1Sum / n : 0,
    excellent1: n > 0 ? excellentSum / n : 0,
    relevant1: n > 0 ? relevantSum / n : 0,
    bad1: n > 0 ? badSum / n : 0,
    n,
    excluded,
  }
}

const HEADER =
  `${'variant'.padEnd(10)} ${'ndcg@3'.padStart(7)} ${'ndcg@5'.padStart(7)} ${'ndcg@dl'.padStart(7)} ` +
  `${'g@1'.padStart(5)} ${'exc@1'.padStart(6)} ${'rel@1'.padStart(6)} ${'bad@1'.padStart(6)} ` +
  `${'n'.padStart(4)} ${'excl'.padStart(5)}`

const METRIC_LEGEND =
  `  ndcg@dl = NDCG at the query's frozen display limit · g@1 = mean grade at rank 1 · ` +
  `exc@1 = grade 3 · rel@1 = grade >= 2 · bad@1 = grade 0`

function summaryRow(name: string, s: Summary): string {
  return (
    `${name.padEnd(10)} ${s.ndcg3.toFixed(3).padStart(7)} ${s.ndcg5.toFixed(3).padStart(7)} ${s.ndcgK.toFixed(3).padStart(7)} ` +
    `${s.grade1.toFixed(2).padStart(5)} ${s.excellent1.toFixed(3).padStart(6)} ${s.relevant1.toFixed(3).padStart(6)} ${s.bad1.toFixed(3).padStart(6)} ` +
    `${String(s.n).padStart(4)} ${String(s.excluded).padStart(5)}`
  )
}

function printTable(title: string, indices: number[]): void {
  console.log(`\n--- ${title} ---`)
  console.log(METRIC_LEGEND)
  console.log(HEADER)
  for (const v of variants) {
    console.log(summaryRow(v.name, summarize(ordersByName[v.name], indices)))
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
// Depth-ablation request-size proxies
// ============================================================================

function frozenToRerankDoc(e: FrozenEvent): RerankDocumentEvent {
  return {
    id: e.id,
    name: e.name,
    venue_name: e.venue_name,
    venue_neighborhood: e.venue_neighborhood,
    categories: e.categories,
    facets: {
      genres: asStringArray(e.facets.genres),
      vibes: asStringArray(e.facets.vibes) ?? asStringArray(e.facets.vibe),
      activities: asStringArray(e.facets.activities) ?? asStringArray(e.facets.activity),
      audience: asStringArray(e.facets.audience) ?? asStringArray(e.facets.audiences),
      setting: asStringArray(e.facets.setting) ?? asStringArray(e.facets.settings),
    },
    starts_at: e.starts_at,
    is_free: e.is_free,
    price: e.price,
    description_summary_es: e.description_summary_es,
    description_summary_en: e.description_summary_en,
    description_es: e.description_es,
    description_en: e.description_en,
  }
}

/**
 * Mechanical proxies for what a depth-D request WOULD serialize, derived from
 * frozen data only. Queries where Voyage was not applied fail closed and
 * contribute 0 (no request occurs). Not a measured latency or API cost.
 */
function requestSizeProxies(depth: number): { meanDocs: number; meanChars: number } {
  let docsSum = 0
  let charsSum = 0
  let n = 0
  for (const q of capture.queries) {
    if (q.baseOrder.length === 0) continue
    n += 1
    if (q.voyage.status !== 'applied' || !q.voyage.ranks) continue
    const window = q.baseOrder.slice(0, depth)
    docsSum += window.length
    for (const id of window) {
      const e = capture.events[id]
      if (!e) continue
      charsSum += buildRerankDocument(frozenToRerankDoc(e)).length
    }
  }
  return { meanDocs: n > 0 ? docsSum / n : 0, meanChars: n > 0 ? charsSum / n : 0 }
}

function printDepthTable(indices: number[]): void {
  console.log(`\n--- reranking-depth ablation (pure Voyage, frozen ranks) ---`)
  console.log(
    `Simulated order: rerank the first D base candidates by frozen Voyage rank, ` +
      `append the rest in original base order. Fail-closed to base order when Voyage was not applied.`
  )
  console.log(
    `request-size proxies are mechanical (from frozen data); no live request is made, so no latency/cost is claimed.`
  )
  console.log(
    `${'depth'.padStart(5)} ${'ndcg@3'.padStart(7)} ${'ndcg@5'.padStart(7)} ${'ndcg@dl'.padStart(7)} ` +
      `${'g@1'.padStart(5)} ${'exc@1'.padStart(6)} ${'rel@1'.padStart(6)} ${'bad@1'.padStart(6)} ` +
      `${'n'.padStart(4)} ${'excl'.padStart(5)} ${'meanDocs'.padStart(9)} ${'meanChars'.padStart(10)}`
  )
  for (const D of DEPTH_DEPTHS) {
    const orders = capture.queries.map((q) => depthVoyageOrder(q, D))
    const s = summarize(orders, indices)
    const p = requestSizeProxies(D)
    console.log(
      `${String(D).padStart(5)} ${s.ndcg3.toFixed(3).padStart(7)} ${s.ndcg5.toFixed(3).padStart(7)} ${s.ndcgK.toFixed(3).padStart(7)} ` +
        `${s.grade1.toFixed(2).padStart(5)} ${s.excellent1.toFixed(3).padStart(6)} ${s.relevant1.toFixed(3).padStart(6)} ${s.bad1.toFixed(3).padStart(6)} ` +
        `${String(s.n).padStart(4)} ${String(s.excluded).padStart(5)} ${p.meanDocs.toFixed(1).padStart(9)} ${p.meanChars.toFixed(0).padStart(10)}`
    )
  }
  const full = summarize(ordersByName['voyage'], indices)
  console.log(`\nfull-depth pure Voyage (== voyage variant, depth 50): ${summaryRow('voyage', full)}`)
}

// ============================================================================
// Report
// ============================================================================

const allIndices = capture.queries.map((_, i) => i)
const scoredQueries = capture.queries.filter((q) => q.baseOrder.length > 0).length
const noCandidateQueries = capture.queries.filter((q) => q.baseOrder.length === 0).length

console.log(`\n=== replay (offline) ===`)
console.log(`capture : ${CAPTURE_PATH} (${capture.meta.queries} queries, ${Object.keys(capture.events).length} events)`)
console.log(`labels  : ${labelsPath}`)
console.log(
  `\n*** ${scoredQueries} scored queries, ${noCandidateQueries} excluded with no retrieval candidates ***`
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

printDepthTable(allIndices)

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
