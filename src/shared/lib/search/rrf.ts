/**
 * Reciprocal Rank Fusion (RRF).
 *
 * Combines several ranked candidate lists into one fused ranking. Each list is
 * a set of items ranked from most to least relevant (rank 1 = best). Items get
 * a score of `1 / (k + rank)` per list they appear in; higher totals win.
 *
 * First occurrence of an id across the concatenated input keeps that object
 * (dedup is by id, later copies of the same id are dropped).
 */

export function rrfFuse<T extends { id: string }>(
  rankedLists: T[][],
  options?: { k?: number; limit?: number }
): T[] {
  const k = options?.k ?? 60
  const limit = options?.limit

  const scores = new Map<string, number>()
  const firstObject = new Map<string, T>()

  for (const list of rankedLists) {
    // A repeated id within one list must only be scored once (at its first
    // rank). Otherwise a duplicate could let A beat B by stacking two scores
    // from a single list instead of genuinely ranking higher.
    const scoredInList = new Set<string>()
    for (let rank = 1; rank <= list.length; rank++) {
      const item = list[rank - 1]
      if (!item) continue
      if (scoredInList.has(item.id)) continue
      scoredInList.add(item.id)
      if (!firstObject.has(item.id)) {
        firstObject.set(item.id, item)
      }
      const current = scores.get(item.id) ?? 0
      scores.set(item.id, current + 1 / (k + rank))
    }
  }

  const fused = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => firstObject.get(id) as T)

  return limit !== undefined ? fused.slice(0, limit) : fused
}
