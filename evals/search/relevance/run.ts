#!/usr/bin/env bun
/**
 * Offline search relevance eval — Phase 7c (v1).
 *
 * Runs ENTIRELY OFFLINE against the committed corpus at
 * `evals/search/corpus/events.json`. It never queries the live events table as
 * a source of truth. Frozen "now" (Buenos Aires time) pins the calendar so the
 * run is deterministic.
 *
 * What v1 measures:
 *   1. Structured-intent accuracy — does `canonicalizeSearchIntent` faithfully
 *      turn the seed's declared ground-truth `must` (isFree, weekday→date
 *      window, neighborhood, venueId, price, date-time) into `intent.must`?
 *      Tool-input passthrough is also checked for seeds that declare input.
 *   2. Hard-constraint violation rate — after applying the must/avoid/price/age
 *      constraints, does any returned candidate still violate the seed's
 *      declared `must`? Reported even when it is 0.
 *   3. Retrieval quality over a candidate set:
 *        recall@50, NDCG@5, hit@1 / precision@1 (limit=1 cases),
 *        no-match accuracy (aggregated only over expectEmpty seeds),
 *        candidate counts.
 *
 * RETRIEVER WARNING: Phase 4's real hybrid retriever (and Phase 6's document
 * rebuild) have NOT landed. The ranking used here is a placeholder — filter the
 * fixture by the hard `must`, then order by naive token overlap on
 * name+descriptions. It is a scaffolding retriever so this eval runs NOW and
 * gets a stable contract; when the production retriever lands, swap `rank()`.
 * Do NOT treat these numbers as the production search quality.
 *
 * No binary pass/fail thresholds and no LLM grading — just a metric table.
 *
 * Usage: bun evals/search/relevance/run.ts
 */

import { readFileSync } from 'node:fs'
import { addDays, getDay, startOfDay } from 'date-fns'
import { fromZonedTime, toZonedTime } from 'date-fns-tz'
import { canonicalizeSearchIntent, type EventSearchIntent } from '#features/chat/api/tools/search-intent.ts'
import { normalizeText } from '#shared/lib/utils/normalize-text.ts'
import { BA_TIMEZONE } from '#shared/lib/constants.ts'
import { rerankEvents, type RerankDocumentEvent, type RerankMeta } from '#shared/lib/search/rerank.ts'
import { corpusToRerankDocument } from './rerank-variants.ts'
import type { CorpusEvent, CorpusFile } from '../corpus/types.ts'
import { RELEVANCE_QUERIES, RELEVANCE_NOW_BA, type SeedQuery, type SeedMust } from './queries.ts'

const NDCG_K = 5
const RECALL_K = 50

// ============================================================================
// Corpus loading
// ============================================================================
const CORPUS_PATH = new URL('../corpus/events.json', import.meta.url).pathname
const corpus: CorpusFile = JSON.parse(readFileSync(CORPUS_PATH, 'utf-8'))
const EVENTS = corpus.events

/** Event text used by the naive token-overlap retriever and avoid matching. */
function textOf(e: CorpusEvent): string {
  return [e.name, e.descriptions.es, e.descriptions.en ?? '', e.descriptions.es_summary ?? '']
    .filter(Boolean)
    .join(' ')
}

// ============================================================================
// Time helpers
// ============================================================================
function baWeekday(e: CorpusEvent): number {
  return toZonedTime(new Date(e.starts_at), BA_TIMEZONE).getDay()
}
function ts(iso: string): number {
  return new Date(iso).getTime()
}

/** BA wall-clock Date → UTC ISO string (mirrors search-intent's baToUTC). */
function baToUTCISO(baDate: Date): string {
  return fromZonedTime(baDate, BA_TIMEZONE).toISOString()
}

/** Expected UTC window for the next occurrence of `target` weekday from `nowBA`. */
function weekdayWindowUTC(nowBA: Date, target: number): { after: string; before: string } {
  const daysUntil = (target - getDay(nowBA) + 7) % 7
  const day = startOfDay(addDays(nowBA, daysUntil))
  return { after: baToUTCISO(day), before: baToUTCISO(startOfDay(addDays(day, 1))) }
}

// ============================================================================
// Must / avoid predicates
// ============================================================================

/** Hard intends captured by canonicalize (intent.must). */
function intentMustFilter(must: {
  startsAfter?: string
  startsBefore?: string
  neighborhoodIds?: string[]
  venueIds?: string[]
  categories?: string[]
  isFree?: boolean
  maxPrice?: number
  attendeeAge?: number
}): (e: CorpusEvent) => boolean {
  return (e) => {
    if (must.startsAfter && ts(e.starts_at) < ts(must.startsAfter)) return false
    if (must.startsBefore && ts(e.starts_at) > ts(must.startsBefore)) return false
    if (must.neighborhoodIds?.length && !(e.venue?.neighborhood && must.neighborhoodIds.includes(e.venue.neighborhood))) return false
    if (must.venueIds?.length && !(e.venue?.id && must.venueIds.includes(e.venue.id))) return false
    if (must.categories?.length && !must.categories.some((c: string) => e.categories.includes(c))) return false
    if (must.isFree !== undefined && e.is_free !== must.isFree) return false
    if (must.maxPrice !== undefined && (e.price ?? 0) > must.maxPrice) return false
    if (must.attendeeAge !== undefined && e.min_age != null && e.min_age > must.attendeeAge) return false
    return true
  }
}

/** Ground-truth hard labels from seed.must (used to detect violations). */
function declaredMustFilter(must: SeedMust | undefined): (e: CorpusEvent) => boolean {
  return (e) => {
    if (!must) return true
    if (must.isFree !== undefined && e.is_free !== must.isFree) return false
    if (must.weekday !== undefined && baWeekday(e) !== must.weekday) return false
    if (must.neighborhood && e.venue?.neighborhood !== must.neighborhood) return false
    if (must.venueId && e.venue?.id !== must.venueId) return false
    if (must.minAge !== undefined && e.min_age != null && e.min_age > must.minAge) return false
    if (must.maxPrice !== undefined && (e.price ?? 0) > must.maxPrice) return false
    if (must.within) {
      if (must.within.after && ts(e.starts_at) < ts(must.within.after)) return false
      if (must.within.before && ts(e.starts_at) > ts(must.within.before)) return false
    }
    return true
  }
}

/** Does an event match an avoid term (genres text or event text)? */
function matchesAvoid(e: CorpusEvent, avoid: string[]): boolean {
  if (!avoid.length) return false
  const text = normalizeText(textOf(e))
  return avoid.some((term) => {
    const t = normalizeText(term)
    return t !== '' && text.split(' ').includes(t)
  })
}

// ============================================================================
// Naive placeholder retriever
// ============================================================================
function rank(query: string, events: CorpusEvent[]): CorpusEvent[] {
  const qTokens = new Set(normalizeText(query) ? normalizeText(query).split(' ') : [])
  if (qTokens.size === 0) return [...events] // pure-filter search: keep order
  const scored = events.map((e) => {
    const etokens = new Set(normalizeText(textOf(e)).split(' ').filter(Boolean))
    let score = 0
    qTokens.forEach((t) => {
      if (etokens.has(t)) score += 1
      // bonus exact word overlap in the name
      if (normalizeText(e.name).split(' ').includes(t)) score += 1
    })
    return { e, score }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored.map((s) => s.e)
}

// ============================================================================
// Intent fidelity checks
// ============================================================================

/** Does `intent.must` faithfully realize the seed's declared `must`? */
function intentSatisfiesMust(intent: EventSearchIntent, must: SeedMust | undefined, nowBA: Date): boolean {
  if (!must) return true
  const m = intent.must
  if (must.isFree !== undefined && m.isFree !== must.isFree) return false
  if (must.weekday !== undefined) {
    const expected = weekdayWindowUTC(nowBA, must.weekday)
    if (m.startsAfter !== expected.after || m.startsBefore !== expected.before) return false
  }
  if (must.neighborhood !== undefined && !(m.neighborhoodIds ?? []).includes(must.neighborhood as any)) return false
  if (must.venueId !== undefined && !(m.venueIds ?? []).includes(must.venueId)) return false
  if (must.minAge !== undefined && m.attendeeAge !== must.minAge) return false
  if (must.maxPrice !== undefined && m.maxPrice !== must.maxPrice) return false
  if (must.within) {
    if (m.startsAfter !== must.within.after || m.startsBefore !== must.within.before) return false
  }
  return true
}

/** Does the canonicalized intent faithfully pass through the raw tool input? */
function toolInputIsFaithful(intent: EventSearchIntent, ti: SeedQuery['toolInput']): boolean {
  if (!ti) return true
  const m = intent.must
  if (ti.isFree !== undefined && m.isFree !== ti.isFree) return false
  if (ti.neighborhoods?.length) {
    const got = m.neighborhoodIds ?? []
    if (!ti.neighborhoods.every((n) => got.includes(n as any))) return false
  }
  if (ti.venueIds?.length && JSON.stringify((m.venueIds ?? []).sort()) !== JSON.stringify([...ti.venueIds].sort())) {
    return false
  }
  if (ti.avoid?.length) {
    const got = intent.avoid.genres ?? []
    if (JSON.stringify(got.sort()) !== JSON.stringify([...ti.avoid].sort())) return false
  }
  if (ti.maxPrice !== undefined && m.maxPrice !== ti.maxPrice) return false
  if (ti.minAge !== undefined && m.attendeeAge !== ti.minAge) return false
  if (ti.dateFrom && m.startsAfter === undefined) return false
  if (ti.dateTo && m.startsBefore === undefined) return false
  if (ti.timeFilter && ti.timeFilter !== 'now' && m.startsAfter === undefined) return false
  return true
}

// ============================================================================
// Metrics
// ============================================================================
function dcg(grades: number[]): number {
  return grades.reduce((sum, g, i) => sum + g / Math.log2(i + 2), 0)
}

interface CaseResult {
  id: string
  candidates: number
  top: number
  relevant: number
  recall50: number
  ndcg5: number
  hit: number // hit@k / precision@1
  intentAccurate: boolean
  violations: number
  expectEmpty: boolean
  noMatchPass: boolean | null // null when not expectEmpty
}

// ============================================================================
// Main
// ============================================================================
const cases: CaseResult[] = []
let structuredSeeds = 0
let structureHits = 0

// Inputs captured for the --rerank comparison variants (parallel to `cases`).
interface VariantInput {
  seed: SeedQuery
  intent: EventSearchIntent
  candidates: CorpusEvent[]
  baselineRanked: CorpusEvent[]
  relevantSet: Set<string>
  k: number
}
const variantInputs: VariantInput[] = []

for (const seed of RELEVANCE_QUERIES) {
  const input = seed.toolInput ?? { query: seed.query }
  const intent = await canonicalizeSearchIntent({ query: seed.query, ...input }, RELEVANCE_NOW_BA)

  // --- 1) structured-intent fidelity (ground-truth must + tool passthrough) ---
  let faithful = true
  if (seed.must || seed.toolInput) {
    structuredSeeds++
    faithful = intentSatisfiesMust(intent, seed.must, RELEVANCE_NOW_BA)
    if (!toolInputIsFaithful(intent, seed.toolInput)) faithful = false
  }
  if (faithful && (seed.must || seed.toolInput)) structureHits += 1

  // --- 2) candidate set = intent-must AND avoid -------------------------
  const intentFiltered = EVENTS.filter(intentMustFilter(intent.must))
  const candidates = intentFiltered.filter((e) => !matchesAvoid(e, intent.avoid.genres ?? []))
  const ranked = rank(intent.semanticQuery, candidates)
  const k = intent.displayLimit
  const topK = ranked.slice(0, k)

  // --- 2b) constraint-violation rate against ground-truth labels --------
  const declaredPass = declaredMustFilter(seed.must)
  const violations = candidates.filter((e) => !declaredPass(e)).length

  // --- 3) retrieval metrics ---------------------------------------------
  const relevantSet = new Set(
    Object.entries(seed.labels)
      .filter(([, g]) => g >= 2)
      .map(([id]) => id)
  )
  const relevant = relevantSet.size
  const top50 = ranked.slice(0, RECALL_K)
  const foundRelevant = top50.filter((e) => relevantSet.has(e.id)).length
  const recall50 = relevant > 0 ? foundRelevant / relevant : 0

  // NDCG: ideal ranking is the top-5 ground-truth grades (1–3) from ALL labels,
  // NOT the retrieved slice — otherwise missing labels deflate/inflate the ideal.
  const actualTop5 = ranked.slice(0, NDCG_K).map((e) => seed.labels[e.id] ?? 0)
  const idealTop5 = Object.values(seed.labels)
    .sort((a, b) => b - a)
    .slice(0, NDCG_K)
  const idealDcg = dcg(idealTop5)
  const ndcg5 = idealDcg > 0 ? dcg(actualTop5) / idealDcg : 0

  const hit = topK.some((e) => relevantSet.has(e.id)) ? 1 : 0

  // no-match: an expectEmpty seed is only a pass if the retriever returns ZERO
  // candidates. Returning any event (e.g. all 11 free events) is a miss.
  const expectEmpty = !!seed.expectEmpty
  const noMatchPass = expectEmpty ? candidates.length === 0 : null

  cases.push({
    id: seed.id,
    candidates: candidates.length,
    top: k,
    relevant,
    recall50,
    ndcg5,
    hit,
    intentAccurate: faithful,
    violations,
    expectEmpty,
    noMatchPass,
  })

  variantInputs.push({ seed, intent, candidates, baselineRanked: ranked, relevantSet, k })
}

// ============================================================================
// Aggregate + table (baseline-only output; suppressed when --rerank is set)
// ============================================================================
if (!process.argv.includes('--rerank')) {
  const intentAccuracy = structuredSeeds > 0 ? structureHits / structuredSeeds : 1
  const harmSeeds = cases.filter((c) => c.candidates > 0)
  const totalViolations = harmSeeds.reduce((s, c) => s + c.violations, 0)
  const totalCandidates = harmSeeds.reduce((s, c) => s + c.candidates, 0)
  const violationRate = totalCandidates > 0 ? totalViolations / totalCandidates : 0

  const recall50Mean = cases.reduce((s, c) => s + c.recall50, 0) / cases.length
  const ndcg5Mean = cases.reduce((s, c) => s + c.ndcg5, 0) / cases.length
  const hitRate = cases.reduce((s, c) => s + c.hit, 0) / cases.length

  const emptySeeds = cases.filter((c) => c.expectEmpty)
  const noMatchHits = emptySeeds.filter((c) => c.noMatchPass === true).length
  const noMatchAccuracy = emptySeeds.length > 0 ? noMatchHits / emptySeeds.length : 1

  console.log(`\n=== relevance eval (offline, corpus=${EVENTS.length} events) ===`)
  console.log(
    `${'id'.padEnd(28)} ${'cand'.padStart(4)} ${'top'.padStart(3)} ${'rel'.padStart(3)} ${'r@50'.padStart(5)} ${'ndcg@5'.padStart(7)} ${'hit'.padStart(3)} ${'intent'.padStart(6)} ${'viol'.padStart(4)} ${'nomatch'.padStart(7)}`
  )
  for (const c of cases) {
    const nomatch = c.expectEmpty ? (c.noMatchPass ? 'ok' : 'MISS') : '-'
    console.log(
      `${c.id.padEnd(28)} ${String(c.candidates).padStart(4)} ${String(c.top).padStart(3)} ` +
        `${String(c.relevant).padStart(3)} ${c.recall50.toFixed(2).padStart(5)} ${c.ndcg5.toFixed(2).padStart(7)} ` +
        `${String(c.hit).padStart(3)} ${c.intentAccurate ? 'ok' : 'MISS'.padStart(6)} ` +
        `${String(c.violations).padStart(4)} ${nomatch.padStart(7)}`
    )
  }

  console.log(`\n--- summary ---`)
  console.log(`corpus events           : ${EVENTS.length}`)
  console.log(`structured intent acc   : ${intentAccuracy.toFixed(3)} (${structureHits}/${structuredSeeds})`)
  console.log(`constraint-violation    : ${violationRate.toFixed(3)} (${totalViolations}/${totalCandidates} of must-filtered candidates)`)
  console.log(`mean recall@${RECALL_K}        : ${recall50Mean.toFixed(3)}`)
  console.log(`mean NDCG@${NDCG_K}           : ${ndcg5Mean.toFixed(3)}`)
  console.log(`hit@${'1'} (limit=1)         : ${hitRate.toFixed(3)}`)
  console.log(`no-match accuracy        : ${noMatchAccuracy.toFixed(3)} (${noMatchHits}/${emptySeeds.length} expectEmpty seeds)`)
  console.log(`intent-fidelity misses  : ${cases.filter((c) => !c.intentAccurate).map((c) => c.id).join(', ') || 'none'}`)
  console.log(`no-match misses          : ${emptySeeds.filter((c) => c.noMatchPass !== true).map((c) => c.id).join(', ') || 'none'}`)
  console.log(`\nnote: ranking is the placeholder token-overlap retriever (Phase 4/6 not loaded here).`)
}

// ============================================================================
// --rerank comparison variants
// ============================================================================

function variantMetrics(
  ranked: CorpusEvent[],
  seed: SeedQuery,
  relevantSet: Set<string>,
  k: number
): { ndcg5: number; hit: number } {
  const actualTop5 = ranked.slice(0, NDCG_K).map((e) => seed.labels[e.id] ?? 0)
  const idealTop5 = Object.values(seed.labels)
    .sort((a, b) => b - a)
    .slice(0, NDCG_K)
  const idealDcg = dcg(idealTop5)
  const ndcg5 = idealDcg > 0 ? dcg(actualTop5) / idealDcg : 0
  const hit = ranked.slice(0, k).some((e) => relevantSet.has(e.id)) ? 1 : 0
  return { ndcg5, hit }
}

function rankDisplacement(
  baseline: CorpusEvent[],
  variant: CorpusEvent[],
  relevantSet: Set<string>
): number | null {
  const baseRank = new Map(baseline.map((e, i) => [e.id, i]))
  const varRank = new Map(variant.map((e, i) => [e.id, i]))
  let total = 0
  let count = 0
  for (const id of relevantSet) {
    const b = baseRank.get(id)
    const v = varRank.get(id)
    if (b === undefined || v === undefined) continue
    total += Math.abs(v - b)
    count++
  }
  return count > 0 ? total / count : null
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
}

function printVariantTable(
  name: string,
  cases: CaseResult[],
  inputs: VariantInput[],
  orders: CorpusEvent[][]
): void {
  console.log(`\n--- ${name} ---`)
  console.log(
    `${'id'.padEnd(28)} ${'cand'.padStart(4)} ${'top'.padStart(3)} ${'ndcg@5'.padStart(7)} ${'hit'.padStart(3)} ${'viol'.padStart(4)} ${'nomatch'.padStart(7)}`
  )

  let ndcgSum = 0
  let hitSum = 0
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i]
    const m = variantMetrics(orders[i], inputs[i].seed, inputs[i].relevantSet, inputs[i].k)
    ndcgSum += m.ndcg5
    hitSum += m.hit
    const nomatch = c.expectEmpty ? (c.noMatchPass ? 'ok' : 'MISS') : '-'
    console.log(
      `${c.id.padEnd(28)} ${String(c.candidates).padStart(4)} ${String(c.top).padStart(3)} ` +
        `${m.ndcg5.toFixed(2).padStart(7)} ${String(m.hit).padStart(3)} ` +
        `${String(c.violations).padStart(4)} ${nomatch.padStart(7)}`
    )
  }

  const harmCases = cases.filter((c) => c.candidates > 0)
  const totalViolations = harmCases.reduce((s, c) => s + c.violations, 0)
  const totalCandidates = harmCases.reduce((s, c) => s + c.candidates, 0)
  const violationRate = totalCandidates > 0 ? totalViolations / totalCandidates : 0
  const emptySeeds = cases.filter((c) => c.expectEmpty)
  const noMatchHits = emptySeeds.filter((c) => c.noMatchPass === true).length
  const noMatchAccuracy = emptySeeds.length > 0 ? noMatchHits / emptySeeds.length : 1

  console.log(`mean NDCG@${NDCG_K}       : ${(ndcgSum / cases.length).toFixed(3)}`)
  console.log(`hit@1 (limit=1)     : ${(hitSum / cases.length).toFixed(3)}`)
  console.log(`constraint-violation: ${violationRate.toFixed(3)}`)
  console.log(`no-match accuracy    : ${noMatchAccuracy.toFixed(3)}`)
}

async function runRerankVariants(cases: CaseResult[], inputs: VariantInput[]): Promise<void> {
  const hasKey = !!process.env.VOYAGE_API_KEY

  const baselineOrders: CorpusEvent[][] = inputs.map((inp) => inp.baselineRanked.slice(0, RECALL_K))
  const voyageOrders: CorpusEvent[][] = []
  const rerankedOrders: CorpusEvent[][] = []
  const latencies: number[] = []
  let fallbacks = 0

  if (hasKey) {
    // Free-tier keys are rate-limited per minute; pace calls so the comparison
    // measures reranker quality, not 429 fallbacks. Production makes one call
    // per search, so this delay is eval-only.
    const PACE_MS = 1100
    for (const inp of inputs) {
      const baseline50 = inp.baselineRanked.slice(0, RECALL_K)
      const byId = new Map(baseline50.map((e) => [e.id, e]))
      const docs = baseline50.map(corpusToRerankDocument)
      // Eval-only retry on free-tier 429s (production rerankEvents stays
      // fail-closed). Backoff: 5s, 15s, 30s.
      let rerankedDocs: RerankDocumentEvent[] = docs
      let meta: RerankMeta = { status: 'failed', error: 'not run' }
      for (const backoffMs of [0, 5000, 15000, 30000]) {
        if (backoffMs > 0) {
          const { promise: wait, resolve: waitResolve } = Promise.withResolvers<void>()
          setTimeout(waitResolve, backoffMs)
          await wait
        }
        const result = await rerankEvents(docs, {
          semanticQuery: inp.intent.semanticQuery,
          prefer: inp.intent.prefer,
          avoid: [],
        })
        rerankedDocs = result.ordered
        meta = result.meta
        if (meta.status !== 'failed' || !meta.error?.includes('429')) break
      }

      if (meta.status === 'failed') fallbacks += 1
      if (meta.status === 'applied' && meta.latencyMs !== undefined) latencies.push(meta.latencyMs)

      if (meta.status === 'applied') {
        const mapBack = (ds: RerankDocumentEvent[]) => ds.map((d) => byId.get(d.id)!)
        rerankedOrders.push(mapBack(rerankedDocs))
        const byRerankerRank = [...docs].sort(
          (a, b) => meta.ranks!.get(a.id)!.rerankerRank - meta.ranks!.get(b.id)!.rerankerRank
        )
        voyageOrders.push(mapBack(byRerankerRank))
      } else {
        rerankedOrders.push(baseline50)
        voyageOrders.push(baseline50)
      }

      const { promise: paced, resolve: pacedResolve } = Promise.withResolvers<void>()
      setTimeout(pacedResolve, PACE_MS)
      await paced
    }
  }

  console.log(`\n=== rerank variants ===`)

  printVariantTable('baseline', cases, inputs, baselineOrders)
  if (hasKey) {
    printVariantTable('voyage', cases, inputs, voyageOrders)
    printVariantTable('voyage+production', cases, inputs, rerankedOrders)
  }

  const ordersByName: Record<string, CorpusEvent[][]> = hasKey
    ? { voyage: voyageOrders, 'voyage+production': rerankedOrders }
    : {}
  for (const name of Object.keys(ordersByName)) {
    let total = 0
    let queries = 0
    for (let i = 0; i < inputs.length; i++) {
      const d = rankDisplacement(baselineOrders[i], ordersByName[name][i], inputs[i].relevantSet)
      if (d !== null) {
        total += d
        queries++
      }
    }
    const mean = queries > 0 ? total / queries : null
    console.log(
      `mean rank displacement vs baseline (${name}): ${mean === null ? 'n/a' : mean.toFixed(3)}`
    )
  }

  if (hasKey) {
    const sorted = [...latencies].sort((a, b) => a - b)
    console.log(`rerank latency p50 (ms) : ${percentile(sorted, 0.5) ?? 'n/a'}`)
    console.log(`rerank latency p95 (ms) : ${percentile(sorted, 0.95) ?? 'n/a'}`)
    console.log(`rerank fallbacks         : ${fallbacks}`)
  } else {
    console.log(`\nnote: voyage variants skipped (no VOYAGE_API_KEY).`)
  }
}

if (process.argv.includes('--rerank')) {
  await runRerankVariants(cases, variantInputs)
}
