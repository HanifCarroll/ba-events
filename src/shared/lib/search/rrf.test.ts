import { describe, expect, it } from 'vitest'
import { rrfFuse } from './rrf.ts'

interface Item {
  id: string
  name: string
}

function item(id: string, name = id): Item {
  return { id, name }
}

describe('rrfFuse', () => {
  it('a shared id in rank 1 and rank 3 beats a unique rank 2', () => {
    const listA = [item('a'), item('b'), item('shared')]
    const listB = [item('shared'), item('x')]
    // shared scores 1/(60+3) + 1/(60+1) ≈ 0.0159 + 0.0164
    // b (unique rank 2) scores 1/(60+2) ≈ 0.0161
    // shared total ≈ 0.0323 > b ≈ 0.0161 — shared must outrank b.
    const result = rrfFuse([listA, listB], { k: 60 })
    expect(result[0]).toHaveProperty('id', 'shared')
    // shared appears once (first occurrence keeps the object).
    expect(result.filter((r) => r.id === 'shared')).toHaveLength(1)
  })

  it('handles empty lists', () => {
    expect(rrfFuse([])).toEqual([])
    expect(rrfFuse([[], []])).toEqual([])
  })

  it('a duplicate rank-1+rank-2 in one list does not stack to beat a unique rank 1', () => {
    // A appears twice in listA (rank 1 + rank 2); B appears once in listB at
    // rank 1. B's list comes first so a pure tie breaks toward B. With per-list
    // dedup A scores once (1/61) and ties B (1/61) → [b, a]. Without dedup A's
    // stacked rank-1+rank-2 score (1/61+1/62 ≈ 0.0325) strictly beats B
    // (≈ 0.0164) → [a, b]. The duplicate must never lift A above B.
    const result = rrfFuse([[item('b')], [item('a'), item('a')]], { k: 60 })
    expect(result.map((r) => r.id)).toEqual(['b', 'a'])
    expect(result.filter((r) => r.id === 'a')).toHaveLength(1)
  })

  it('shared id at rank 1 and rank 3 across two lists still beats unique rank 2', () => {
    // Shared scores once per list across two lists: 1/(60+3)+1/(60+1)≈0.0323,
    // which must outrank the unique single-list rank 2 (1/62≈0.0161).
    const result = rrfFuse(
      [[item('a'), item('b'), item('shared')], [item('shared'), item('x')]],
      { k: 60 }
    )
    expect(result[0]).toHaveProperty('id', 'shared')
    expect(result.filter((r) => r.id === 'shared')).toHaveLength(1)
  })

  it('truncates to the limit', () => {
    const list = [item('a'), item('b'), item('c'), item('d')]
    expect(rrfFuse([list], { limit: 2 }).map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('first occurrence of an id keeps that object', () => {
    const listA = [item('dup', 'from A')]
    const listB = [item('dup', 'from B'), item('x')]
    const result = rrfFuse([listA, listB])
    const dup = result.find((r) => r.id === 'dup')
    expect(dup?.name).toBe('from A')
  })
})
