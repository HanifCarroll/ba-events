#!/usr/bin/env bun
/**
 * Deterministic blinded disagreement worksheet for a pure-Voyage vs fused(2)
 * audit.
 *
 * Selects the union of queries where pure Voyage and fused(2) disagree
 * (different rank 1, materially different top five, or Voyage loses NDCG@5),
 * and every mixed-language query. For each selected query it
 * emits:
 *   - a blinded worksheet (shuffled event content, opaque option ids, blank
 *     grade/rationale) with NO ranker, rank, variant order, old grade, or event
 *     database id, and
 *   - a key that restores option-id → event-id identity and records variant
 *     orders, selection reasons, and existing labels for later comparison.
 *
 * Randomization is fully deterministic: a documented fixed seed drives a stable
 * PRNG (mulberry32). Math.random() is never used.
 *
 * Usage:
 *   bun evals/search/relevance/audit.ts
 *   bun evals/search/relevance/audit.ts --capture ./capture-holdout.json --labels ./live-labels.ts \
 *     --worksheet ./audit-worksheet.json --key ./audit-key.json
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  fusedOrder,
  voyageOrder,
  asStringArray,
  asEnergy,
  type CaptureFile,
  type FrozenEvent,
  type FrozenQuery,
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
const labelsArg = argValue('--labels')
const worksheetArg = argValue('--worksheet')
const keyArg = argValue('--key')

const CAPTURE_PATH = captureArg
  ? resolve(process.cwd(), captureArg)
  : new URL('./capture-latest.json', import.meta.url).pathname
const LABELS_PATH = labelsArg
  ? resolve(process.cwd(), labelsArg)
  : new URL('./live-labels.ts', import.meta.url).pathname
const WORKSHEET_PATH = worksheetArg
  ? resolve(process.cwd(), worksheetArg)
  : new URL('./audit-worksheet.json', import.meta.url).pathname
const KEY_PATH = keyArg
  ? resolve(process.cwd(), keyArg)
  : new URL('./audit-key.json', import.meta.url).pathname

const capture: CaptureFile = JSON.parse(readFileSync(CAPTURE_PATH, 'utf-8'))
const { LIVE_LABELS } = (await import(pathToFileURL(LABELS_PATH).href)) as { LIVE_LABELS: Labels }

// ============================================================================
// Deterministic PRNG (never Math.random)
// ============================================================================

/** Fixed, documented seed so every worksheet is reproducible. */
const AUDIT_SEED = 20260816

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffled<T>(arr: T[], rng: () => number): T[] {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// ============================================================================
// Metrics helpers (selection only; replay.ts owns the product metrics)
// ============================================================================

function dcg(grades: number[]): number {
  return grades.reduce((sum, g, i) => sum + g / Math.log2(i + 2), 0)
}

function ndcg5(order: string[], labels: Record<string, Grade>): number {
  const actual = order.slice(0, 5).map((id) => labels[id] ?? 0)
  const ideal = Object.values(labels).sort((a, b) => b - a).slice(0, 5)
  const idcg = dcg(ideal)
  return idcg > 0 ? dcg(actual) / idcg : 0
}

function sameSet(a: string[], b: string[]): boolean {
  const sa = new Set(a)
  const sb = new Set(b)
  if (sa.size !== sb.size) return false
  for (const x of sa) if (!sb.has(x)) return false
  return true
}

function positionalDiffs(a: string[], b: string[]): number {
  let c = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) c += 1
  return c
}

// ============================================================================
// Selection
// ============================================================================

interface Qualified {
  queryIndex: number
  q: FrozenQuery
  reasons: string[]
  voyageTop5: string[]
  fusedTop5: string[]
  voyageNdcg: number
  fusedNdcg: number
}

const qualified: Qualified[] = []

for (let i = 0; i < capture.queries.length; i++) {
  const q = capture.queries[i]
  if (q.baseOrder.length === 0) continue

  const labels = LIVE_LABELS[q.id] ?? {}
  const voyageTop5 = voyageOrder(q).slice(0, 5)
  const fusedTop5 = fusedOrder(q, 2).slice(0, 5)
  const voyageNdcg = ndcg5(voyageTop5, labels)
  const fusedNdcg = ndcg5(fusedTop5, labels)

  const reasons: string[] = []

  const rank1Differs = voyageTop5[0] !== fusedTop5[0]
  const top5Material =
    !sameSet(voyageTop5, fusedTop5) || positionalDiffs(voyageTop5, fusedTop5) >= 2
  const voyageLoss = voyageNdcg < fusedNdcg
  const mixedLanguage = q.lang === 'mixed'

  if (rank1Differs) reasons.push('rank1-differs')
  if (top5Material) reasons.push('top5-material-differs')
  if (voyageLoss) reasons.push('voyage-ndcg-loss')
  if (mixedLanguage) reasons.push('mixed-language')

  if (reasons.length === 0) continue

  qualified.push({
    queryIndex: i,
    q,
    reasons,
    voyageTop5,
    fusedTop5,
    voyageNdcg,
    fusedNdcg,
  })
}

// ============================================================================
// Cap + prioritization (only when strictly over 50)
// ============================================================================

const CAP = 50

function priorityRank(reasons: string[]): number {
  if (reasons.includes('voyage-ndcg-loss')) return 0
  if (reasons.includes('mixed-language')) return 2
  if (reasons.includes('rank1-differs') || reasons.includes('top5-material-differs')) return 3
  return 4
}

let selected: Qualified[]
if (qualified.length > CAP) {
  selected = [...qualified]
    .sort((a, b) => {
      const pa = priorityRank(a.reasons)
      const pb = priorityRank(b.reasons)
      if (pa !== pb) return pa - pb
      const da = Math.abs(a.voyageNdcg - a.fusedNdcg)
      const db = Math.abs(b.voyageNdcg - b.fusedNdcg)
      if (db !== da) return db - da
      return a.queryIndex - b.queryIndex
    })
    .slice(0, CAP)
} else {
  // Stable capture order; include every qualifying query.
  selected = [...qualified].sort((a, b) => a.queryIndex - b.queryIndex)
}

// ============================================================================
// Worksheet + key
// ============================================================================

function facetSummary(e: FrozenEvent): Record<string, unknown> {
  return {
    genres: asStringArray(e.facets.genres) ?? [],
    vibes: asStringArray(e.facets.vibes) ?? asStringArray(e.facets.vibe) ?? [],
    activities: asStringArray(e.facets.activities) ?? asStringArray(e.facets.activity) ?? [],
    audience: asStringArray(e.facets.audience) ?? asStringArray(e.facets.audiences) ?? [],
    setting: asStringArray(e.facets.setting) ?? asStringArray(e.facets.settings) ?? [],
    energy: asEnergy(e.facets.energy) ?? null,
    eventType: asStringArray(e.facets.eventType) ?? asStringArray(e.facets.event_type) ?? [],
  }
}

const rng = mulberry32(AUDIT_SEED)
let optionCounter = 0

const worksheetQueries: unknown[] = []
const keyQueries: unknown[] = []

for (const sel of selected) {
  const q = sel.q
  const baseIndex = new Map(q.baseOrder.map((id, i) => [id, i]))

  // Union top five of pure Voyage and fused(2), in base order, then shuffled.
  const unionSet = new Set<string>()
  for (const id of sel.voyageTop5) unionSet.add(id)
  for (const id of sel.fusedTop5) unionSet.add(id)
  const union = [...unionSet].sort((a, b) => (baseIndex.get(a) ?? 0) - (baseIndex.get(b) ?? 0))
  const presented = shuffled(union, rng)

  const worksheetOptions: unknown[] = []
  const keyOptions: unknown[] = []

  for (const eventId of presented) {
    const e = capture.events[eventId]
    const optionId = `op-${String(++optionCounter).padStart(4, '0')}`
    worksheetOptions.push({
      optionId,
      name: e?.name ?? '???',
      summary: e?.description_summary_es ?? e?.description_summary_en ?? null,
      description: (e?.description_es ?? e?.description_en ?? '').slice(0, 400) || null,
      categories: e?.categories ?? [],
      facets: e ? facetSummary(e) : {},
      venue: e?.venue_name ?? null,
      neighborhood: e?.venue_neighborhood ?? null,
      starts_at: e?.starts_at ?? null,
      is_free: e?.is_free ?? null,
      price: e?.price ?? null,
      grade: null,
      rationale: '',
    })
    keyOptions.push({
      optionId,
      eventId,
      existingGrade: e ? ((LIVE_LABELS[q.id]?.[eventId] ?? null) as Grade | null) : null,
    })
  }

  worksheetQueries.push({
    queryId: q.id,
    query: q.query,
    subjective: q.subjective,
    lang: q.lang,
    options: worksheetOptions,
  })

  keyQueries.push({
    queryId: q.id,
    reasons: sel.reasons,
    voyageTop5: sel.voyageTop5,
    fused2Top5: sel.fusedTop5,
    options: keyOptions,
  })
}

const generatedAt = new Date().toISOString()

const worksheet = {
  meta: {
    generatedAt,
    seed: AUDIT_SEED,
    capture: portablePath(CAPTURE_PATH),
    labels: portablePath(LABELS_PATH),
    note:
      'Blinded disagreement worksheet. Option IDs are opaque; no ranker, rank, variant order, previous grade, or event database ID is exposed. Fill grade (0..3) and rationale per option.',
  },
  queries: worksheetQueries,
}

const key = {
  meta: {
    generatedAt,
    seed: AUDIT_SEED,
    capture: portablePath(CAPTURE_PATH),
    labels: portablePath(LABELS_PATH),
    note:
      'Restores identity for the blinded worksheet. Contains variant orders, selection reasons, and existing labels for later comparison.',
  },
  queries: keyQueries,
}

writeFileSync(WORKSHEET_PATH, JSON.stringify(worksheet, null, 2) + '\n')
writeFileSync(KEY_PATH, JSON.stringify(key, null, 2) + '\n')

// ============================================================================
// Report
// ============================================================================

const reasonCounts = new Map<string, number>()
for (const sel of selected) {
  for (const r of sel.reasons) reasonCounts.set(r, (reasonCounts.get(r) ?? 0) + 1)
}

console.log(
  `[audit] selected ${selected.length} of ${qualified.length} qualifying queries ` +
    `(cap=${CAP}, applied=${qualified.length > CAP})`
)
console.log(
  `[audit] reason counts: ${[...reasonCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([r, c]) => `${r}=${c}`)
    .join(', ')}`
)
console.log(`[audit] worksheet → ${WORKSHEET_PATH}`)
console.log(`[audit] key       → ${KEY_PATH}`)
