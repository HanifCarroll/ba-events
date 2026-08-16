#!/usr/bin/env bun
/**
 * Blinded disagreement audit report.
 *
 * Scores pure Voyage and fused(2) on the selected audit queries using the
 * blinded grades from an audit worksheet, maps those grades back through the
 * audit key, and compares the blinded conclusion against the existing labels.
 *
 * Reports, for both systems:
 *   NDCG@3, NDCG@5, NDCG at the frozen display limit, mean grade@1,
 *   Excellent@1 (grade 3), Relevant@1 (grade >= 2), Bad@1 (grade 0), n.
 * Then:
 *   paired per-query NDCG@5 wins/ties/losses and mean difference (voyage - fused),
 *   exact agreement rate and a 4x4 confusion matrix between blinded grades and
 *   existing labels where both exist (NOT labeled "human agreement"), and
 *   query-level cases where the blinded grades reverse which system wins or
 *   change whether either system's top result is bad/excellent.
 *
 * No statistical probability claim is made. If --out is supplied, the same
 * facts are written as structured JSON; the console report is always printed.
 *
 * Usage:
 *   bun evals/search/relevance/audit-report.ts \
 *     --capture ./capture-latest.json \
 *     --key ./audit-key.json \
 *     --grades ./audit-graded.json \
 *     --existing-labels ./live-labels.ts \
 *     --out ./audit-report.json
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  voyageOrder,
  fusedOrder,
  displayLimitOf,
  type CaptureFile,
} from './frozen-variants.ts'
import { portablePath } from './portable-path.ts'

type Grade = 0 | 1 | 2 | 3
type Labels = Record<string, Record<string, Grade>>

// ============================================================================
// CLI
// ============================================================================

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const captureArg = argValue('--capture')
const keyArg = argValue('--key')
const gradesArg = argValue('--grades')
const existingArg = argValue('--existing-labels')
const outArg = argValue('--out')

if (!keyArg || !gradesArg) {
  console.error('usage: audit-report.ts --capture <json> --key <key-json> --grades <graded-json> [--existing-labels <ts>] [--out <json>]')
  process.exit(1)
}

const CAPTURE_PATH = captureArg
  ? resolve(process.cwd(), captureArg)
  : new URL('./capture-latest.json', import.meta.url).pathname
const KEY_PATH = resolve(process.cwd(), keyArg)
const GRADES_PATH = resolve(process.cwd(), gradesArg)
const EXISTING_PATH = existingArg
  ? resolve(process.cwd(), existingArg)
  : new URL('./live-labels.ts', import.meta.url).pathname
const OUT_PATH = outArg ? resolve(process.cwd(), outArg) : undefined

// ============================================================================
// Input shapes
// ============================================================================

interface KeyOption {
  optionId: string
  eventId: string
  existingGrade?: Grade | null
}

interface KeyQuery {
  queryId: string
  reasons?: string[]
  voyageTop5?: string[]
  fused2Top5?: string[]
  facetTop5?: string[]
  options: KeyOption[]
}

interface GradedEntry {
  grade: number
  rationale?: string
}

interface GradedFile {
  provenance?: string
  grades: Record<string, GradedEntry>
}

const capture: CaptureFile = JSON.parse(readFileSync(CAPTURE_PATH, 'utf-8'))
const key = JSON.parse(readFileSync(KEY_PATH, 'utf-8')) as { queries: KeyQuery[] }
const graded = JSON.parse(readFileSync(GRADES_PATH, 'utf-8')) as GradedFile
const { LIVE_LABELS } = (await import(pathToFileURL(EXISTING_PATH).href)) as { LIVE_LABELS: Labels }

const captureQueryById = new Map(capture.queries.map((q) => [q.id, q]))

// ============================================================================
// Validation: exact option-ID coverage
// ============================================================================

const keyOptionIds: string[] = []
const optionMap = new Map<string, { queryId: string; eventId: string }>()
for (const q of key.queries) {
  for (const o of q.options) {
    keyOptionIds.push(o.optionId)
    if (optionMap.has(o.optionId)) throw new Error(`duplicate optionId in key: ${o.optionId}`)
    optionMap.set(o.optionId, { queryId: q.queryId, eventId: o.eventId })
  }
}

const gradedOptionIds = Object.keys(graded.grades)
const keySet = new Set(keyOptionIds)
const gradedSet = new Set(gradedOptionIds)
for (const o of keyOptionIds) {
  if (!gradedSet.has(o)) throw new Error(`optionId in key but missing from grades: ${o}`)
}
for (const o of gradedOptionIds) {
  if (!keySet.has(o)) throw new Error(`optionId in grades but missing from key: ${o}`)
}
for (const o of keyOptionIds) {
  const g = graded.grades[o].grade
  if (!Number.isInteger(g) || g < 0 || g > 3) {
    throw new Error(`invalid blinded grade for ${o}: ${JSON.stringify(g)} (must be integer 0..3)`)
  }
}

// ============================================================================
// Metrics
// ============================================================================

function dcg(grades: number[]): number {
  return grades.reduce((sum, g, i) => sum + g / Math.log2(i + 2), 0)
}

function idealDcgAt(labels: Record<string, Grade>, k: number): number {
  return dcg(Object.values(labels).sort((a, b) => b - a).slice(0, k))
}

function ndcgAt(order: string[], labels: Record<string, Grade>, k: number): number {
  const actual = order.slice(0, k).map((id) => labels[id] ?? 0)
  const ideal = idealDcgAt(labels, k)
  return ideal > 0 ? dcg(actual) / ideal : 0
}

interface SystemMetrics {
  ndcg3: number
  ndcg5: number
  ndcgDl: number
  grade1: number
  excellent1: number
  relevant1: number
  bad1: number
  n: number
}

function summarize(
  queries: Array<{ order: string[]; labels: Record<string, Grade>; displayLimit: number }>
): SystemMetrics {
  let ndcg3 = 0
  let ndcg5 = 0
  let ndcgDl = 0
  let grade1 = 0
  let excellent1 = 0
  let relevant1 = 0
  let bad1 = 0
  const n = queries.length
  for (const q of queries) {
    const k = Math.max(1, Math.min(q.displayLimit, 5))
    ndcg3 += ndcgAt(q.order, q.labels, 3)
    ndcg5 += ndcgAt(q.order, q.labels, 5)
    ndcgDl += ndcgAt(q.order, q.labels, k)
    const g1 = q.order.length > 0 ? (q.labels[q.order[0]] ?? 0) : 0
    grade1 += g1
    excellent1 += g1 === 3 ? 1 : 0
    relevant1 += g1 >= 2 ? 1 : 0
    bad1 += g1 === 0 ? 1 : 0
  }
  const div = n > 0 ? n : 1
  return {
    ndcg3: ndcg3 / div,
    ndcg5: ndcg5 / div,
    ndcgDl: ndcgDl / div,
    grade1: grade1 / div,
    excellent1: excellent1 / div,
    relevant1: relevant1 / div,
    bad1: bad1 / div,
    n,
  }
}

// ============================================================================
// Per-query blinded vs existing grade maps + orders
// ============================================================================

interface QueryRow {
  queryId: string
  voyageOrder: string[]
  fusedOrder: string[]
  displayLimit: number
  blindedLabels: Record<string, Grade>
  existingLabels: Record<string, Grade> // restricted to the judgment pool
}

const rows: QueryRow[] = []

for (const kq of key.queries) {
  const fq = captureQueryById.get(kq.queryId)
  if (!fq) throw new Error(`key query ${kq.queryId} not found in capture`)

  const blindedLabels: Record<string, Grade> = {}
  const existingLabels: Record<string, Grade> = {}
  const pool = new Set<string>()

  for (const o of kq.options) {
    pool.add(o.eventId)
    blindedLabels[o.eventId] = graded.grades[o.optionId].grade as Grade
    const existing = LIVE_LABELS[kq.queryId]?.[o.eventId]
    if (existing !== undefined) existingLabels[o.eventId] = existing
  }

  rows.push({
    queryId: kq.queryId,
    voyageOrder: voyageOrder(fq),
    fusedOrder: fusedOrder(fq, 2),
    displayLimit: displayLimitOf(fq),
    blindedLabels,
    existingLabels,
  })
}

// ============================================================================
// System summaries (blinded grades)
// ============================================================================

const voyageBlinded = summarize(
  rows.map((r) => ({ order: r.voyageOrder, labels: r.blindedLabels, displayLimit: r.displayLimit }))
)
const fusedBlinded = summarize(
  rows.map((r) => ({ order: r.fusedOrder, labels: r.blindedLabels, displayLimit: r.displayLimit }))
)

// ============================================================================
// Paired per-query NDCG@5 (blinded)
// ============================================================================

let wins = 0
let ties = 0
let losses = 0
let ndcg5DiffSum = 0

for (const r of rows) {
  const v = ndcgAt(r.voyageOrder, r.blindedLabels, 5)
  const f = ndcgAt(r.fusedOrder, r.blindedLabels, 5)
  ndcg5DiffSum += v - f
  if (v > f + 1e-9) wins += 1
  else if (f > v + 1e-9) losses += 1
  else ties += 1
}
const meanNdcg5Diff = rows.length > 0 ? ndcg5DiffSum / rows.length : 0

// ============================================================================
// Agreement + 4x4 confusion matrix (blinded vs existing, where both exist)
// ============================================================================

const confusion = [
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
]
let agree = 0
let compared = 0

for (const r of rows) {
  for (const [eventId, blindedGrade] of Object.entries(r.blindedLabels)) {
    const existingGrade = r.existingLabels[eventId]
    if (existingGrade === undefined) continue
    compared += 1
    if (blindedGrade === existingGrade) agree += 1
    confusion[blindedGrade][existingGrade] += 1
  }
}
const exactAgreementRate = compared > 0 ? agree / compared : 0

// ============================================================================
// Reversal cases (blinded vs existing conclusions)
// ============================================================================

function winnerOf(a: number, b: number): 'voyage' | 'fused' | 'tie' {
  if (a > b + 1e-9) return 'voyage'
  if (b > a + 1e-9) return 'fused'
  return 'tie'
}

interface Reversal {
  queryId: string
  blindedVoyageNdcg5: number
  blindedFusedNdcg5: number
  existingVoyageNdcg5: number
  existingFusedNdcg5: number
  changes: string[]
}

const reversals: Reversal[] = []

for (const r of rows) {
  const bv = ndcgAt(r.voyageOrder, r.blindedLabels, 5)
  const bf = ndcgAt(r.fusedOrder, r.blindedLabels, 5)
  const ev = ndcgAt(r.voyageOrder, r.existingLabels, 5)
  const ef = ndcgAt(r.fusedOrder, r.existingLabels, 5)

  const blindedWinner = winnerOf(bv, bf)
  const existingWinner = winnerOf(ev, ef)

  const changes: string[] = []

  if (blindedWinner !== existingWinner) {
    changes.push(`winner-reversed: blinded=${blindedWinner}, existing=${existingWinner}`)
  }

  const voyageTop1 = r.voyageOrder[0]
  const fusedTop1 = r.fusedOrder[0]
  if (voyageTop1) {
    const bg = r.blindedLabels[voyageTop1] ?? 0
    const eg = r.existingLabels[voyageTop1] ?? 0
    if ((bg === 0) !== (eg === 0)) changes.push(`voyage-top1-bad: blinded=${bg}, existing=${eg}`)
    if ((bg === 3) !== (eg === 3)) changes.push(`voyage-top1-excellent: blinded=${bg}, existing=${eg}`)
  }
  if (fusedTop1) {
    const bg = r.blindedLabels[fusedTop1] ?? 0
    const eg = r.existingLabels[fusedTop1] ?? 0
    if ((bg === 0) !== (eg === 0)) changes.push(`fused-top1-bad: blinded=${bg}, existing=${eg}`)
    if ((bg === 3) !== (eg === 3)) changes.push(`fused-top1-excellent: blinded=${bg}, existing=${eg}`)
  }

  if (changes.length > 0) {
    reversals.push({
      queryId: r.queryId,
      blindedVoyageNdcg5: bv,
      blindedFusedNdcg5: bf,
      existingVoyageNdcg5: ev,
      existingFusedNdcg5: ef,
      changes,
    })
  }
}

// ============================================================================
// Console report
// ============================================================================

function fmt(s: SystemMetrics): string {
  return (
    `${s.ndcg3.toFixed(3)} ${s.ndcg5.toFixed(3)} ${s.ndcgDl.toFixed(3)} ` +
    `${s.grade1.toFixed(2)} ${s.excellent1.toFixed(3)} ${s.relevant1.toFixed(3)} ${s.bad1.toFixed(3)} ${s.n}`
  )
}

console.log('\n=== blinded disagreement audit report ===')
console.log(`capture : ${CAPTURE_PATH}`)
console.log(`key     : ${KEY_PATH}`)
console.log(`grades  : ${GRADES_PATH}${graded.provenance ? ` (${graded.provenance})` : ''}`)
console.log(`existing: ${EXISTING_PATH}`)
console.log(`queries : ${rows.length}`)

console.log(`\n--- blinded-grade system scores (${rows.length} audit queries) ---`)
console.log(
  `${'system'.padEnd(9)} ${'ndcg@3'.padStart(7)} ${'ndcg@5'.padStart(7)} ${'ndcg@dl'.padStart(7)} ` +
    `${'g@1'.padStart(5)} ${'exc@1'.padStart(6)} ${'rel@1'.padStart(6)} ${'bad@1'.padStart(6)} ${'n'.padStart(3)}`
)
console.log(`${'voyage'.padEnd(9)} ${fmt(voyageBlinded)}`)
console.log(`${'fused(2)'.padEnd(9)} ${fmt(fusedBlinded)}`)

console.log(`\n--- paired NDCG@5 (voyage minus fused, blinded) ---`)
console.log(`wins=${wins} ties=${ties} losses=${losses} meanDiff=${meanNdcg5Diff.toFixed(4)}`)

console.log(`\n--- blinded vs existing agreement (${compared} pairs) ---`)
console.log(`exact agreement rate: ${(exactAgreementRate * 100).toFixed(2)}%`)
console.log(`confusion matrix [rows=blinded, cols=existing] 0..3:`)
console.log(`         existing`)
console.log(`          0    1    2    3`)
for (let b = 0; b < 4; b++) {
  console.log(`  ${b}  ${confusion[b].map((c) => String(c).padStart(4)).join(' ')}`)
}

console.log(`\n--- query-level reversals vs existing labels (${reversals.length}) ---`)
if (reversals.length === 0) {
  console.log('(none)')
} else {
  for (const rv of reversals) {
    console.log(
      `  ${rv.queryId}: blinded voyage=${rv.blindedVoyageNdcg5.toFixed(3)} fused=${rv.blindedFusedNdcg5.toFixed(3)} | ` +
        `existing voyage=${rv.existingVoyageNdcg5.toFixed(3)} fused=${rv.existingFusedNdcg5.toFixed(3)}`
    )
    for (const c of rv.changes) console.log(`      - ${c}`)
  }
}

// ============================================================================
// Optional structured JSON
// ============================================================================

if (OUT_PATH) {
  const out = {
    meta: {
      generatedAt: new Date().toISOString(),
      capture: portablePath(CAPTURE_PATH),
      key: portablePath(KEY_PATH),
      grades: portablePath(GRADES_PATH),
      existingLabels: portablePath(EXISTING_PATH),
      queries: rows.length,
      note: 'Blinded disagreement audit. No statistical probability claim is made.',
    },
    systems: {
      voyage: voyageBlinded,
      'fused(2)': fusedBlinded,
    },
    pairedNdcg5: {
      wins,
      ties,
      losses,
      meanDifference: meanNdcg5Diff,
    },
    agreement: {
      exactRate: exactAgreementRate,
      compared,
      confusion,
    },
    reversals,
  }
  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + '\n')
  console.log(`\n[audit-report] wrote ${OUT_PATH}`)
}
