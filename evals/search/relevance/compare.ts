#!/usr/bin/env bun
/**
 * Paired ranker comparison report (offline, deterministic).
 *
 * Compares exactly two frozen rerank variants on the SAME graded labels and
 * the SAME frozen capture, query by query, so disagreements are exact rather
 * than extrapolated from rounded aggregate rates. All statistics are computed
 * from the frozen artifact — no network, no env keys, no DB.
 *
 * Variant names: baseline, facet, voyage, fused(1), fused(2), fused(3),
 * depth(10), depth(20), depth(30), depth(50). Orders come from
 * frozen-variants.ts, the same adapters replay.ts and audit.ts use.
 *
 * Metric definitions and the top-five completeness standard are identical to
 * replay.ts. Zero-candidate queries are excluded explicitly and listed.
 *
 * Statistics (all frequentist; resampling is seeded and deterministic):
 *   - paired mean difference A-B per query, then the mean over queries;
 *   - paired bootstrap percentile 95% CI (2.5th / 97.5th percentiles) of the
 *     mean A-B using `--samples` resamples and `--seed`;
 *   - two-sided paired sign-flip randomization p-value for the mean A-B using
 *     `--samples` random sign assignments, with an ADD-ONE correction
 *     (p = (count + 1) / (samples + 1)); a finite-sample correction, slightly
 *     conservative, never zero;
 *   - binary top-one outcomes (Excellent@1, Relevant@1, Bad@1) get discordant
 *     counts aOnly / bOnly plus an EXACT two-sided McNemar/binomial p-value
 *     (H0: p = 0.5 on the discordant pairs; p = sum of binomial probabilities
 *     <= the observed probability).
 *
 * These are frequentist resampling / exact-test outputs, NOT posterior
 * probabilities.
 *
 * Usage:
 *   bun evals/search/relevance/compare.ts
 *   bun evals/search/relevance/compare.ts --capture holdout-capture.json \
 *       --labels holdout-labels.ts --a voyage --b fused\(2\) \
 *       --samples 100000 --seed 123456789 --out holdout-comparison.json
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  baseOrder,
  facetOrder,
  fusedOrder,
  voyageOrder,
  depthVoyageOrder,
  displayLimitOf,
  type CaptureFile,
  type FrozenEvent,
  type FrozenQuery,
} from './frozen-variants.ts'
import { portablePath } from './portable-path.ts'

// ============================================================================
// CLI
// ============================================================================

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const DEFAULT_SEED = 123456789
const DEFAULT_SAMPLES = 100000

const captureArg = argValue('--capture')
const labelsArg = argValue('--labels')
const aArg = argValue('--a')
const bArg = argValue('--b')
const outArg = argValue('--out')
const seedArg = argValue('--seed')
const samplesArg = argValue('--samples')

const CAPTURE_PATH = captureArg
  ? resolve(process.cwd(), captureArg)
  : new URL('./capture-latest.json', import.meta.url).pathname
const LABELS_PATH = labelsArg
  ? resolve(process.cwd(), labelsArg)
  : new URL('./live-labels.ts', import.meta.url).pathname
const VARIANT_A = aArg ?? 'voyage'
const VARIANT_B = bArg ?? 'fused(2)'
const OUT_PATH = outArg ? resolve(process.cwd(), outArg) : null
const SEED = seedArg === undefined ? DEFAULT_SEED : Number(seedArg)
const SAMPLES = samplesArg === undefined ? DEFAULT_SAMPLES : Number(samplesArg)

if (!Number.isInteger(SEED)) {
  console.error(`--seed must be an integer, got: ${seedArg}`)
  process.exit(1)
}
if (!Number.isInteger(SAMPLES) || SAMPLES < 1) {
  console.error(`--samples must be a positive integer, got: ${samplesArg}`)
  process.exit(1)
}

// ============================================================================
// Variant resolution (same supported set as replay.ts + depth ablations)
// ============================================================================

const SUPPORTED_VARIANTS = [
  'baseline',
  'facet',
  'voyage',
  'fused(1)',
  'fused(2)',
  'fused(3)',
  'depth(10)',
  'depth(20)',
  'depth(30)',
  'depth(50)',
] as const

function isSupportedVariant(name: string): boolean {
  return (SUPPORTED_VARIANTS as readonly string[]).includes(name)
}

function orderFor(name: string, q: FrozenQuery, events: Record<string, FrozenEvent>): string[] {
  switch (name) {
    case 'baseline':
      return baseOrder(q)
    case 'facet':
      return facetOrder(q, events)
    case 'voyage':
      return voyageOrder(q)
    case 'fused(1)':
      return fusedOrder(q, 1)
    case 'fused(2)':
      return fusedOrder(q, 2)
    case 'fused(3)':
      return fusedOrder(q, 3)
    case 'depth(10)':
      return depthVoyageOrder(q, 10)
    case 'depth(20)':
      return depthVoyageOrder(q, 20)
    case 'depth(30)':
      return depthVoyageOrder(q, 30)
    case 'depth(50)':
      return depthVoyageOrder(q, 50)
    default:
      throw new Error(`unknown variant "${name}"`)
  }
}

if (!isSupportedVariant(VARIANT_A)) {
  console.error(
    `unknown variant for --a: "${VARIANT_A}". Supported: ${SUPPORTED_VARIANTS.join(', ')}`
  )
  process.exit(1)
}
if (!isSupportedVariant(VARIANT_B)) {
  console.error(
    `unknown variant for --b: "${VARIANT_B}". Supported: ${SUPPORTED_VARIANTS.join(', ')}`
  )
  process.exit(1)
}

// ============================================================================
// Input loading
// ============================================================================

const capture: CaptureFile = JSON.parse(readFileSync(CAPTURE_PATH, 'utf-8'))
const { LIVE_LABELS } = (await import(pathToFileURL(LABELS_PATH).href)) as {
  LIVE_LABELS: Record<string, Record<string, 0 | 1 | 2 | 3>>
}

// ============================================================================
// Variant orders + per-query metrics (identical definitions to replay.ts)
// ============================================================================

type Grade = 0 | 1 | 2 | 3
type Labels = Record<string, Grade>

function dcg(grades: number[]): number {
  return grades.reduce((sum, g, i) => sum + g / Math.log2(i + 2), 0)
}

/** Ideal DCG from the explicitly judged pool (all grades for the query). */
function idealDcgAt(labels: Labels, k: number): number {
  return dcg(Object.values(labels).sort((a, b) => b - a).slice(0, k))
}

function ndcgAt(order: string[], labels: Labels, k: number): number {
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

function queryMetrics(order: string[], labels: Labels, displayLimit: number): QueryMetrics {
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

const aOrders = capture.queries.map((q) => orderFor(VARIANT_A, q, capture.events))
const bOrders = capture.queries.map((q) => orderFor(VARIANT_B, q, capture.events))

const aMetrics = capture.queries.map((q, i) =>
  queryMetrics(aOrders[i], LIVE_LABELS[q.id] ?? {}, displayLimitOf(q))
)
const bMetrics = capture.queries.map((q, i) =>
  queryMetrics(bOrders[i], LIVE_LABELS[q.id] ?? {}, displayLimitOf(q))
)

// ============================================================================
// Completeness check (same standard as replay.ts: every measured top-five
// event of both compared variants must have an explicit label entry)
// ============================================================================

const missing: Array<{ queryId: string; variant: string; eventId: string }> = []
for (const [variantName, orders] of [
  [VARIANT_A, aOrders],
  [VARIANT_B, bOrders],
] as Array<[string, string[][]]>) {
  for (let i = 0; i < capture.queries.length; i++) {
    const q = capture.queries[i]
    if (q.baseOrder.length === 0) continue // excluded separately, not a missing label
    const labels = LIVE_LABELS[q.id] ?? {}
    for (const id of orders[i].slice(0, 5)) {
      if (!(id in labels)) missing.push({ queryId: q.id, variant: variantName, eventId: id })
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
// Deterministic PRNG (mulberry32) — makes bootstrap / sign-flip reproducible
// ============================================================================

function makeRand(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ============================================================================
// Frequentist resampling / exact tests
// ============================================================================

function mean(xs: number[]): number {
  if (xs.length === 0) return 0
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

/**
 * Paired bootstrap percentile 95% CI for the mean of `diffs` (per-query A-B).
 * Resamples n queries with replacement `samples` times, then takes the 2.5th
 * and 97.5th percentiles (nearest-rank) of the resampled means.
 */
function bootstrapCI(
  diffs: number[],
  samples: number,
  rand: () => number
): { lo: number; hi: number } {
  const n = diffs.length
  if (n === 0) return { lo: 0, hi: 0 }
  const means = new Array<number>(samples)
  for (let s = 0; s < samples; s++) {
    let sum = 0
    for (let i = 0; i < n; i++) sum += diffs[Math.floor(rand() * n)]
    means[s] = sum / n
  }
  means.sort((a, b) => a - b)
  const loIdx = Math.max(0, Math.ceil(0.025 * samples) - 1)
  const hiIdx = Math.min(samples - 1, Math.ceil(0.975 * samples) - 1)
  return { lo: means[loIdx], hi: means[hiIdx] }
}

/**
 * Two-sided paired sign-flip randomization p-value for the mean of `diffs`.
 * Under the null, each per-query difference is equally likely +d or -d, so we
 * draw `samples` random sign assignments and count |permuted mean| >= |observed
 * mean|. Add-one correction: p = (count + 1) / (samples + 1).
 */
function signFlipP(diffs: number[], samples: number, rand: () => number): number {
  const n = diffs.length
  if (n === 0) return 1
  const obs = mean(diffs)
  if (obs === 0) return 1
  let count = 0
  for (let s = 0; s < samples; s++) {
    let sum = 0
    for (let i = 0; i < n; i++) sum += rand() < 0.5 ? diffs[i] : -diffs[i]
    if (Math.abs(sum / n) >= Math.abs(obs)) count += 1
  }
  return (count + 1) / (samples + 1)
}

/** Exact binomial coefficient C(n, k) for small n (exact via Math.round). */
function binomialCoeff(n: number, k: number): number {
  if (k < 0 || k > n) return 0
  k = Math.min(k, n - k)
  let result = 1
  for (let i = 1; i <= k; i++) {
    result = Math.round((result * (n - k + i)) / i)
  }
  return result
}

/**
 * Exact two-sided McNemar / binomial test on discordant pairs (H0: p = 0.5).
 * p = sum over k of P(X = k) for all k with P(X = k) <= P(X = aOnly),
 * X ~ Bin(aOnly + bOnly, 0.5). Exact arithmetic for this small n.
 */
function exactMcNemar(aOnly: number, bOnly: number): number {
  const n = aOnly + bOnly
  if (n === 0) return 1
  const target = binomialCoeff(n, aOnly) / 2 ** n
  let p = 0
  for (let k = 0; k <= n; k++) {
    const pk = binomialCoeff(n, k) / 2 ** n
    if (pk <= target + 1e-15) p += pk
  }
  return Math.min(1, p)
}

// ============================================================================
// Analysis types + helpers
// ============================================================================

type ContinuousKey = 'ndcg3' | 'ndcg5' | 'ndcgK' | 'grade1'
type BinaryKey = 'excellent1' | 'relevant1' | 'bad1'
type WtlKey = 'ndcg3' | 'ndcg5' | 'ndcgK'

const CONTINUOUS_KEYS: ContinuousKey[] = ['ndcg3', 'ndcg5', 'ndcgK', 'grade1']
const BINARY_KEYS: BinaryKey[] = ['excellent1', 'relevant1', 'bad1']
const WTL_KEYS: WtlKey[] = ['ndcg3', 'ndcg5', 'ndcgK']

function continuousValue(m: QueryMetrics, key: ContinuousKey): number {
  return key === 'grade1' ? (m.grade1 ?? 0) : m[key]
}

function round(x: number, digits = 6): number {
  return Number(x.toFixed(digits))
}

interface ContinuousReport {
  aMean: number
  bMean: number
  diffMean: number
  ciLo: number
  ciHi: number
  signFlipP: number
}

interface WtlReport {
  wins: number
  ties: number
  losses: number
}

interface BinaryReport {
  aMean: number
  bMean: number
  diffMean: number
  aOnly: number
  bOnly: number
  mcnemarP: number
}

interface SliceReport {
  name: string
  n: number
  excluded: number
  metrics: {
    ndcg3: ContinuousReport & WtlReport
    ndcg5: ContinuousReport & WtlReport
    ndcgK: ContinuousReport & WtlReport
    grade1: ContinuousReport
    excellent1: BinaryReport
    relevant1: BinaryReport
    bad1: BinaryReport
  }
}

// ============================================================================
// Slice analysis
// ============================================================================

function analyzeSlice(name: string, indices: number[], rand: () => number): SliceReport {
  const inc = indices.filter((i) => capture.queries[i].baseOrder.length > 0)
  const excluded = indices.length - inc.length

  const metrics = {} as SliceReport['metrics']

  for (const key of CONTINUOUS_KEYS) {
    const aVals = inc.map((i) => continuousValue(aMetrics[i], key))
    const bVals = inc.map((i) => continuousValue(bMetrics[i], key))
    const diffs = inc.map((i, j) => aVals[j] - bVals[j])
    const ci = bootstrapCI(diffs, SAMPLES, rand)
    const report: ContinuousReport = {
      aMean: round(mean(aVals)),
      bMean: round(mean(bVals)),
      diffMean: round(mean(diffs)),
      ciLo: round(ci.lo),
      ciHi: round(ci.hi),
      signFlipP: round(signFlipP(diffs, SAMPLES, rand)),
    }
    if (key === 'ndcg3' || key === 'ndcg5' || key === 'ndcgK') {
      const wtl = { wins: 0, ties: 0, losses: 0 }
      for (const i of inc) {
        const av = continuousValue(aMetrics[i], key)
        const bv = continuousValue(bMetrics[i], key)
        if (av > bv) wtl.wins += 1
        else if (av < bv) wtl.losses += 1
        else wtl.ties += 1
      }
      ;(metrics as Record<string, unknown>)[key] = { ...report, ...wtl }
    } else {
      ;(metrics as Record<string, unknown>)[key] = report
    }
  }

  for (const key of BINARY_KEYS) {
    const aVals = inc.map((i) => aMetrics[i][key])
    const bVals = inc.map((i) => bMetrics[i][key])
    let aOnly = 0
    let bOnly = 0
    for (let j = 0; j < inc.length; j++) {
      if (aVals[j] === 1 && bVals[j] === 0) aOnly += 1
      else if (aVals[j] === 0 && bVals[j] === 1) bOnly += 1
    }
    const report: BinaryReport = {
      aMean: round(mean(aVals)),
      bMean: round(mean(bVals)),
      diffMean: round(mean(aVals) - mean(bVals)),
      aOnly,
      bOnly,
      mcnemarP: round(exactMcNemar(aOnly, bOnly)),
    }
    ;(metrics as Record<string, unknown>)[key] = report
  }

  return { name, n: inc.length, excluded, metrics }
}

const allIndices = capture.queries.map((_, i) => i)

const sliceDefs: Array<{ name: string; indices: number[] }> = [
  { name: 'overall', indices: allIndices },
  { name: 'subjective: true', indices: allIndices.filter((i) => capture.queries[i].subjective) },
  { name: 'subjective: false', indices: allIndices.filter((i) => !capture.queries[i].subjective) },
]

for (const lang of ['es', 'en', 'mixed'] as const) {
  const indices = allIndices.filter((i) => capture.queries[i].lang === lang)
  if (indices.length > 0) sliceDefs.push({ name: `lang: ${lang}`, indices })
}

// One seeded stream, consumed in a fixed order, so every run is reproducible.
const slices = sliceDefs.map((s) => analyzeSlice(s.name, s.indices, makeRand(SEED)))

// ============================================================================
// Exact top-one disagreements + flags
// ============================================================================

interface FlagSet {
  aBadBNot: boolean
  bBadANot: boolean
  aExcellentBNot: boolean
  bExcellentANot: boolean
  aRelevantBNot: boolean
  bRelevantANot: boolean
}

interface TopEvent {
  eventId: string
  name: string
  grade: Grade
  baseRank: number
  rerankerRank: number | null
}

interface TopOneDisagreement {
  queryId: string
  query: string
  subjective: boolean
  lang: string
  displayLimit: number
  a: TopEvent
  b: TopEvent
  flags: FlagSet
}

function baseRankOf(q: FrozenQuery, id: string): number {
  const i = q.baseOrder.indexOf(id)
  return i >= 0 ? i + 1 : -1
}

function rerankerRankOf(q: FrozenQuery, id: string): number | null {
  return q.voyage.ranks?.[id]?.rerankerRank ?? null
}

function topEvent(
  q: FrozenQuery,
  order: string[],
  labels: Labels
): TopEvent | null {
  if (order.length === 0) return null
  const eventId = order[0]
  const e = capture.events[eventId]
  return {
    eventId,
    name: e?.name ?? '(missing event)',
    grade: labels[eventId] ?? 0,
    baseRank: baseRankOf(q, eventId),
    rerankerRank: rerankerRankOf(q, eventId),
  }
}

const FLAG_NAMES = [
  'aBadBNot',
  'bBadANot',
  'aExcellentBNot',
  'bExcellentANot',
  'aRelevantBNot',
  'bRelevantANot',
] as const

function computeFlags(aGrade: Grade, bGrade: Grade): FlagSet {
  return {
    aBadBNot: aGrade === 0 && bGrade !== 0,
    bBadANot: bGrade === 0 && aGrade !== 0,
    aExcellentBNot: aGrade === 3 && bGrade !== 3,
    bExcellentANot: bGrade === 3 && aGrade !== 3,
    aRelevantBNot: aGrade >= 2 && bGrade < 2,
    bRelevantANot: bGrade >= 2 && aGrade < 2,
  }
}

const disagreements: TopOneDisagreement[] = []
for (let i = 0; i < capture.queries.length; i++) {
  const q = capture.queries[i]
  if (q.baseOrder.length === 0) continue
  const labels = LIVE_LABELS[q.id] ?? {}
  const aTop = topEvent(q, aOrders[i], labels)
  const bTop = topEvent(q, bOrders[i], labels)
  if (!aTop || !bTop) continue
  if (aTop.eventId === bTop.eventId) continue
  disagreements.push({
    queryId: q.id,
    query: q.query,
    subjective: q.subjective,
    lang: q.lang,
    displayLimit: displayLimitOf(q),
    a: aTop,
    b: bTop,
    flags: computeFlags(aTop.grade, bTop.grade),
  })
}

function flagCounts(items: TopOneDisagreement[]): Record<(typeof FLAG_NAMES)[number], number> {
  const counts = Object.fromEntries(FLAG_NAMES.map((f) => [f, 0])) as Record<
    (typeof FLAG_NAMES)[number],
    number
  >
  for (const d of items) {
    for (const f of FLAG_NAMES) if (d.flags[f]) counts[f] += 1
  }
  return counts
}

const flagSummary = {
  overall: flagCounts(disagreements),
  subjectiveTrue: flagCounts(disagreements.filter((d) => d.subjective)),
  subjectiveFalse: flagCounts(disagreements.filter((d) => !d.subjective)),
}

const excludedQueries = capture.queries
  .filter((q) => q.baseOrder.length === 0)
  .map((q) => ({
    id: q.id,
    query: q.query,
    subjective: q.subjective,
    lang: q.lang,
    hasMust: q.hasMust,
    path: q.path,
    semanticQuery: q.semanticQuery,
    displayLimit: displayLimitOf(q),
  }))

// ============================================================================
// Console report
// ============================================================================

const f3 = (n: number) => n.toFixed(3)
const fmtP = (p: number) => (p < 0.0001 ? '<0.0001' : p > 0.9999 ? '>0.9999' : p.toFixed(4))

function ciStr(lo: number, hi: number): string {
  return `[${lo.toFixed(3)}, ${hi.toFixed(3)}]`
}

function diffStr(x: number): string {
  const s = x.toFixed(3)
  return (x > 0 ? '+' : '') + s
}

const scoredQueries = capture.queries.filter((q) => q.baseOrder.length > 0).length
const noCandidateQueries = capture.queries.length - scoredQueries

console.log(`\n=== paired comparison (offline) ===`)
console.log(`capture : ${CAPTURE_PATH} (${capture.meta.queries} queries, ${Object.keys(capture.events).length} events)`)
console.log(`labels  : ${LABELS_PATH}`)
console.log(`a       : ${VARIANT_A}`)
console.log(`b       : ${VARIANT_B}`)
console.log(`seed    : ${SEED}`)
console.log(`samples : ${SAMPLES}`)
console.log(
  `\n*** ${scoredQueries} scored queries, ${noCandidateQueries} excluded with no retrieval candidates ***`
)
console.log(
  `statistics are frequentist resampling/exact-test outputs (bootstrap + sign-flip p with add-one ` +
    `correction, exact McNemar); NOT posterior probabilities. a-b > 0 favors a.`
)

for (const s of slices) {
  console.log(`\n--- ${s.name} (n=${s.n}, excluded=${s.excluded}) ---`)

  console.log(`continuous/mean metrics:`)
  console.log(
    `${'metric'.padEnd(9)} ${'a'.padStart(7)} ${'b'.padStart(7)} ${'a-b'.padStart(8)} ` +
      `${'bootstrap 95% CI'.padStart(17)} ${'sign-flip p'.padStart(12)}`
  )
  for (const key of CONTINUOUS_KEYS) {
    const m = s.metrics[key]
    const label = key === 'ndcgK' ? 'ndcg@dl' : key === 'grade1' ? 'g@1' : key
    console.log(
      `${label.padEnd(9)} ${f3(m.aMean).padStart(7)} ${f3(m.bMean).padStart(7)} ` +
        `${diffStr(m.diffMean).padStart(8)} ${ciStr(m.ciLo, m.ciHi).padStart(17)} ` +
        `${fmtP(m.signFlipP).padStart(12)}`
    )
  }

  console.log(`binary top-one metrics (discordant pairs + exact McNemar):`)
  console.log(
    `${'metric'.padEnd(9)} ${'a'.padStart(7)} ${'b'.padStart(7)} ${'a-b'.padStart(8)} ` +
      `${'aOnly'.padStart(6)} ${'bOnly'.padStart(6)} ${'McNemar p'.padStart(10)}`
  )
  for (const key of BINARY_KEYS) {
    const m = s.metrics[key]
    const label = key === 'excellent1' ? 'exc@1' : key === 'relevant1' ? 'rel@1' : 'bad@1'
    console.log(
      `${label.padEnd(9)} ${f3(m.aMean).padStart(7)} ${f3(m.bMean).padStart(7)} ` +
        `${diffStr(m.diffMean).padStart(8)} ${String(m.aOnly).padStart(6)} ` +
        `${String(m.bOnly).padStart(6)} ${fmtP(m.mcnemarP).padStart(10)}`
    )
  }

  console.log(`per-query wins/ties/losses (a vs b):`)
  console.log(`${'metric'.padEnd(9)} ${'wins'.padStart(6)} ${'ties'.padStart(6)} ${'losses'.padStart(7)}`)
  for (const key of WTL_KEYS) {
    const m = s.metrics[key]
    const label = key === 'ndcgK' ? 'ndcg@dl' : key
    console.log(
      `${label.padEnd(9)} ${String(m.wins).padStart(6)} ${String(m.ties).padStart(6)} ` +
        `${String(m.losses).padStart(7)}`
    )
  }
}

console.log(`\n--- exact top-one disagreements (a=${VARIANT_A} vs b=${VARIANT_B}) ---`)
console.log(`${disagreements.length} quer${disagreements.length === 1 ? 'y' : 'ies'} with different top event IDs`)
for (const d of disagreements) {
  const trueFlags = FLAG_NAMES.filter((f) => d.flags[f])
  console.log(
    `\nquery ${d.queryId}: ${JSON.stringify(d.query)} [subjective=${d.subjective} lang=${d.lang} displayLimit=${d.displayLimit}]`
  )
  console.log(
    `  a top: ${d.a.eventId} ${JSON.stringify(d.a.name)} grade=${d.a.grade} baseRank=${d.a.baseRank} rerankerRank=${d.a.rerankerRank ?? 'n/a'}`
  )
  console.log(
    `  b top: ${d.b.eventId} ${JSON.stringify(d.b.name)} grade=${d.b.grade} baseRank=${d.b.baseRank} rerankerRank=${d.b.rerankerRank ?? 'n/a'}`
  )
  console.log(`  flags: ${trueFlags.length > 0 ? trueFlags.join(', ') : '(none)'}`)
}

console.log(`\n--- top-one disagreement flag counts ---`)
console.log(
  `${'flag'.padEnd(16)} ${'overall'.padStart(8)} ${'subjective=true'.padStart(16)} ${'subjective=false'.padStart(17)}`
)
for (const f of FLAG_NAMES) {
  console.log(
    `${f.padEnd(16)} ${String(flagSummary.overall[f]).padStart(8)} ` +
      `${String(flagSummary.subjectiveTrue[f]).padStart(16)} ` +
      `${String(flagSummary.subjectiveFalse[f]).padStart(17)}`
  )
}

console.log(`\n--- excluded zero-candidate queries ---`)
if (excludedQueries.length === 0) {
  console.log(`(none)`)
} else {
  for (const e of excludedQueries) {
    console.log(
      `${e.id} ${JSON.stringify(e.query)} [subjective=${e.subjective} lang=${e.lang} ` +
        `hasMust=${e.hasMust} path=${e.path} displayLimit=${e.displayLimit}]`
    )
  }
}

// ============================================================================
// JSON output
// ============================================================================

const report = {
  meta: {
    generatedAt: new Date().toISOString(),
    capturePath: portablePath(CAPTURE_PATH),
    labelsPath: portablePath(LABELS_PATH),
    variantA: VARIANT_A,
    variantB: VARIANT_B,
    seed: SEED,
    samples: SAMPLES,
    addOneCorrection: true,
    methods: {
      bootstrapCI:
        'paired bootstrap percentile 95% CI (2.5th/97.5th percentiles, nearest-rank) of per-query A-B differences, seeded, frequentist',
      signFlipP:
        'two-sided paired sign-flip randomization p-value of mean A-B with add-one correction (count+1)/(samples+1), frequentist',
      mcnemarP:
        'exact two-sided McNemar/binomial p-value on discordant pairs (H0 p=0.5), sum of binomial probabilities <= observed',
    },
    captureMeta: capture.meta,
    totalQueries: capture.queries.length,
    scoredQueries,
    excludedZeroCandidateQueries: excludedQueries.length,
    topOneDisagreementCount: disagreements.length,
  },
  excludedQueries,
  slices,
  topOneDisagreements: disagreements,
  flagSummaries: flagSummary,
}

if (OUT_PATH) {
  mkdirSync(dirname(OUT_PATH), { recursive: true })
  writeFileSync(OUT_PATH, JSON.stringify(report, null, 2) + '\n')
  console.log(`\n[wrote] ${OUT_PATH}`)
}
