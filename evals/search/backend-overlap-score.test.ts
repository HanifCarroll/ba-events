import { describe, expect, it } from 'vitest'
import { overlapFailures, topKOverlap } from './backend-overlap-score.ts'

const rows = (...ids: string[]) => ids.map(id => ({ id }))

describe('backend overlap scoring', () => {
  it('scores the shared share of the top 10', () => {
    expect(topKOverlap(rows('a', 'b', 'c', 'd'), rows('d', 'c', 'x', 'y'))).toBe(0.5)
    expect(topKOverlap(rows('a'), rows('a'))).toBe(1)
    expect(topKOverlap([], [])).toBe(1)
    expect(topKOverlap(rows(...'abcdefghijkl'), rows(...'abcdefghijXY'))).toBe(1)
  })

  it('fails one query below a threshold even when the means pass', () => {
    const results = [
      { query: 'tango', lexical: 1, semantic: 1 },
      { query: 'teatro', lexical: 1, semantic: 0.6 },
      { query: 'stand up', lexical: 0.5, semantic: 1 },
    ]
    expect(results.reduce((sum, row) => sum + row.lexical, 0) / results.length).toBeGreaterThanOrEqual(0.7)
    expect(results.reduce((sum, row) => sum + row.semantic, 0) / results.length).toBeGreaterThanOrEqual(0.8)
    expect(overlapFailures(results)).toEqual(['teatro: semantic 60%', 'stand up: lexical 50%'])
    expect(overlapFailures([{ query: 'ok', lexical: 0.7, semantic: 0.8 }])).toEqual([])
  })
})
