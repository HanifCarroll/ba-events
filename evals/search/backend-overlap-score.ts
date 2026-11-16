/** Scoring for evals/search/backend-overlap.ts, kept free of I/O so it can be tested. */

export const OVERLAP_K = 10
export const MIN_LEXICAL_OVERLAP = 0.7
export const MIN_SEMANTIC_OVERLAP = 0.8

/** The share of the longer top-K list that both lists hold; 1 when both are empty. */
export function topKOverlap(production: Array<{ id: string }>, staging: Array<{ id: string }>, k = OVERLAP_K): number {
  const a = production.slice(0, k), b = staging.slice(0, k)
  const ids = new Set(a.map(row => row.id))
  const denominator = Math.max(a.length, b.length)
  return denominator === 0 ? 1 : b.filter(row => ids.has(row.id)).length / denominator
}

/** Every query must reach both thresholds; a good mean doesn't excuse one query below them. */
export function overlapFailures(rows: Array<{ query: string; lexical: number; semantic: number }>): string[] {
  return rows.flatMap(row => [
    ...(row.lexical < MIN_LEXICAL_OVERLAP ? [`${row.query}: lexical ${Math.round(row.lexical * 100)}%`] : []),
    ...(row.semantic < MIN_SEMANTIC_OVERLAP ? [`${row.query}: semantic ${Math.round(row.semantic * 100)}%`] : []),
  ])
}
