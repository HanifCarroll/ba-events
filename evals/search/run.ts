#!/usr/bin/env bun
/**
 * Semantic search retrieval eval.
 *
 * Runs golden vibe queries through hybridEventSearch (the same function the
 * search_events tool uses) and scores recall@5 and hit@5 against labeled
 * relevant event IDs.
 *
 * Per-case pass = at least one relevant event in top 5 (hit@5).
 * Suite fails if hit rate < 70% or mean recall@5 < 0.5 — retrieval is
 * probabilistic, so individual misses are reported but don't fail the run.
 *
 * Usage: bun evals/search/run.ts
 */
import { hybridEventSearch } from '@/shared/lib/db/client'
import { mapWithConcurrency } from '../lib/checks'
import { GOLDEN_QUERIES } from './golden'

const K = 5
const MIN_HIT_RATE = 0.7
const MIN_MEAN_RECALL = 0.5

interface QueryResult {
  query: string
  recall: number
  hit: boolean
  topNames: string[]
}

console.log(`Running ${GOLDEN_QUERIES.length} golden queries (recall@${K})...`)
const results = await mapWithConcurrency(GOLDEN_QUERIES, 4, async (q): Promise<QueryResult> => {
  const events = await hybridEventSearch(q.query, {}, K)
  const ids = new Set(events.map((e) => e.id))
  const found = q.relevant.filter((id) => ids.has(id))
  return {
    query: q.query,
    recall: found.length / q.relevant.length,
    hit: found.length > 0,
    topNames: events.map((e) => e.name).slice(0, 3),
  }
})

console.log('\n=== semantic-search ===')
for (const r of results) {
  console.log(
    `${r.hit ? 'PASS' : 'MISS'}  "${r.query}"  recall@${K}=${r.recall.toFixed(2)}  top: ${r.topNames.join(' | ')}`
  )
}

const hitRate = results.filter((r) => r.hit).length / results.length
const meanRecall = results.reduce((sum, r) => sum + r.recall, 0) / results.length
console.log(`\nhit@${K}: ${(hitRate * 100).toFixed(0)}%  mean recall@${K}: ${meanRecall.toFixed(2)}`)
console.log(`thresholds: hit rate >= ${MIN_HIT_RATE}, mean recall >= ${MIN_MEAN_RECALL}`)

if (hitRate < MIN_HIT_RATE || meanRecall < MIN_MEAN_RECALL) process.exitCode = 1
