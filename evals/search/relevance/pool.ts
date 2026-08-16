#!/usr/bin/env bun
/**
 * Build the labeling worksheet for the live rerank eval.
 *
 * For each captured query, pools the union of the top-8 events across all
 * replay variants (baseline / facet / voyage / fused@2) — these are the only
 * events whose grades can move NDCG@5 or Hit@1 for any variant. Everything
 * outside the pool is implicitly graded 0 by replay.
 *
 * Usage: bun evals/search/relevance/pool.ts
 * Writes: evals/search/relevance/labeling-worksheet.json
 */

import { readFileSync, writeFileSync } from 'node:fs'

interface FrozenEvent {
  id: string
  name: string
  starts_at: string
  is_free: boolean
  price: number | null
  categories: string[]
  venue_name: string | null
  venue_neighborhood: string | null
  description_summary_es: string | null
  description_summary_en: string | null
  description_es: string | null
  facets: Record<string, unknown>
}

interface FrozenQuery {
  id: string
  query: string
  subjective: boolean
  lang: string
  hasMust: boolean
  path: string
  semanticQuery: string
  baseOrder: string[]
  voyage: { status: string; ranks?: Record<string, { baseRank: number; rerankerRank: number }> }
}

interface CaptureFile {
  events: Record<string, FrozenEvent>
  queries: FrozenQuery[]
}

const POOL_DEPTH = 8
const FUSION_W = 2

const capture: CaptureFile = JSON.parse(
  readFileSync(new URL('./capture-latest.json', import.meta.url).pathname, 'utf-8')
)

function voyageOrder(q: FrozenQuery): string[] {
  if (q.voyage.status !== 'applied' || !q.voyage.ranks) return [...q.baseOrder]
  return [...q.baseOrder].sort(
    (a, b) => (q.voyage.ranks![a]?.rerankerRank ?? 999) - (q.voyage.ranks![b]?.rerankerRank ?? 999)
  )
}

function fusedOrder(q: FrozenQuery): string[] {
  if (q.voyage.status !== 'applied' || !q.voyage.ranks) return [...q.baseOrder]
  const score = (id: string) => {
    const r = q.voyage.ranks![id]
    if (!r) return 0
    return FUSION_W / (60 + r.rerankerRank) + 1 / (60 + r.baseRank)
  }
  return [...q.baseOrder].sort((a, b) => score(b) - score(a))
}

const worksheet = capture.queries.map((q) => {
  const pool = new Set<string>()
  for (const id of q.baseOrder.slice(0, POOL_DEPTH)) pool.add(id)
  for (const id of voyageOrder(q).slice(0, POOL_DEPTH)) pool.add(id)
  for (const id of fusedOrder(q).slice(0, POOL_DEPTH)) pool.add(id)
  // facet variant order needs the SearchScoreable machinery; baseline top-8
  // already covers most of it, and fused/voyage shifts dominate the pool.

  return {
    queryId: q.id,
    query: q.query,
    semanticQuery: q.semanticQuery,
    subjective: q.subjective,
    lang: q.lang,
    pool: [...pool].map((id) => {
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

const out = new URL('./labeling-worksheet.json', import.meta.url).pathname
writeFileSync(out, JSON.stringify(worksheet, null, 2) + '\n')
const totalPairs = worksheet.reduce((s, w) => s + w.pool.length, 0)
console.log(`[pool] ${worksheet.length} queries, ${totalPairs} query-event pairs → ${out}`)
