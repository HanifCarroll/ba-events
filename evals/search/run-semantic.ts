#!/usr/bin/env bun
/**
 * Semantic-only retrieval eval.
 *
 * Runs golden queries through `semanticEventSearch` (the dense vector path on
 * its own, pre-fusion) so a regression in the fused `hybridEventSearch` can be
 * isolated: if `eval:search` (hybrid) dips but `eval:search:semantic` holds,
 * the regression is in the lexical/fusion layer, not the embeddings.
 *
 * Usage: bun evals/search/run-semantic.ts
 */
import { semanticEventSearch } from '#shared/lib/db/client.server.ts'
import { mapWithConcurrency } from '../lib/checks.ts'
import { GOLDEN_QUERIES } from './golden.ts'

const K = 5
const MIN_HIT_RATE = 0.7
const MIN_MEAN_RECALL = 0.5

interface QueryResult {
  query: string
  recall: number
  hit: boolean
  topNames: string[]
}

console.log(`Running ${GOLDEN_QUERIES.length} golden queries (semantic-only, recall@${K})...`)
const results = await mapWithConcurrency(GOLDEN_QUERIES, 4, async (q): Promise<QueryResult> => {
  const events = await semanticEventSearch(q.query, {}, K)
  const ids = new Set(events.map((e) => e.id))
  const found = q.relevant.filter((id) => ids.has(id))
  return {
    query: q.query,
    recall: found.length / q.relevant.length,
    hit: found.length > 0,
    topNames: events.map((e) => e.name).slice(0, 3),
  }
})

console.log('\n=== semantic-search (dense only) ===')
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
