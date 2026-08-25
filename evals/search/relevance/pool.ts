#!/usr/bin/env bun
/**
 * Build the labeling worksheet for the rerank eval.
 *
 * For each captured query, pools the union of the top-8 events across every
 * replay variant (baseline / pure voyage / fused@1 / fused@2 /
 * fused@3), plus the top-5 of the reranking-depth ablation variants (10/20/30;
 * depth 50 equals pure voyage). These are the only events whose grades can
 * move any measured top-five metric, so replay.ts treats anything outside the
 * pool as unjudged — never as an implicit zero.
 *
 * Usage:
 *   bun evals/search/relevance/pool.ts
 *   bun evals/search/relevance/pool.ts --capture ./capture-holdout.json --out ./labeling-worksheet-holdout.json
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  baseOrder,
  fusedOrder,
  voyageOrder,
  depthVoyageOrder,
  type CaptureFile,
  type FrozenQuery,
} from './frozen-variants.ts'

const POOL_DEPTH = 8
const ABLATION_DEPTHS = [10, 20, 30] // depth 50 === pure voyage, already pooled

// ============================================================================
// CLI
// ============================================================================

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const captureArg = argValue('--capture')
const outArg = argValue('--out')

const CAPTURE_PATH = captureArg
  ? resolve(process.cwd(), captureArg)
  : new URL('./capture-latest.json', import.meta.url).pathname
const OUT_PATH = outArg
  ? resolve(process.cwd(), outArg)
  : new URL('./labeling-worksheet.json', import.meta.url).pathname

const capture: CaptureFile = JSON.parse(readFileSync(CAPTURE_PATH, 'utf-8'))

// ============================================================================
// Variant orders
// ============================================================================

interface Variant {
  name: string
  order: (q: FrozenQuery) => string[]
}

const mainVariants: Variant[] = [
  { name: 'baseline', order: baseOrder },
  { name: 'voyage', order: voyageOrder },
  { name: 'fused(1)', order: (q) => fusedOrder(q, 1) },
  { name: 'fused(2)', order: (q) => fusedOrder(q, 2) },
  { name: 'fused(3)', order: (q) => fusedOrder(q, 3) },
]

// ============================================================================
// Build worksheet
// ============================================================================

const worksheet = capture.queries.map((q) => {
  const baseIndex = new Map(q.baseOrder.map((id, i) => [id, i]))
  const pool = new Set<string>()

  for (const v of mainVariants) {
    for (const id of v.order(q).slice(0, POOL_DEPTH)) pool.add(id)
  }
  for (const depth of ABLATION_DEPTHS) {
    for (const id of depthVoyageOrder(q, depth).slice(0, 5)) pool.add(id)
  }

  // Stable, natural presentation order: base retrieval order.
  const ordered = [...pool].sort((a, b) => (baseIndex.get(a) ?? 0) - (baseIndex.get(b) ?? 0))

  return {
    queryId: q.id,
    query: q.query,
    semanticQuery: q.semanticQuery,
    subjective: q.subjective,
    lang: q.lang,
    pool: ordered.map((id) => {
      const e = capture.events[id]
      return {
        eventId: id,
        name: e?.name ?? '???',
        starts_at: e?.starts_at ?? null,
        venue: e?.venue_name ?? null,
        neighborhood: e?.venue_neighborhood ?? null,
        categories: e?.categories ?? [],
        facets: e?.facets ?? {},
        is_free: e?.is_free ?? null,
        price: e?.price ?? null,
        summary: e?.description_summary_es ?? e?.description_summary_en ?? null,
        description: (e?.description_es ?? '').slice(0, 400) || null,
      }
    }),
  }
})

writeFileSync(OUT_PATH, JSON.stringify(worksheet, null, 2) + '\n')
const totalPairs = worksheet.reduce((s, w) => s + w.pool.length, 0)
console.log(`[pool] ${worksheet.length} queries, ${totalPairs} query-event pairs → ${OUT_PATH}`)
