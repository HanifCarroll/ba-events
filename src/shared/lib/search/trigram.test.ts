import { describe, expect, it } from 'vitest'
import { trigramSimilarity, trigrams } from './trigram.ts'
import fixture from './trigram.fixture.json' with { type: 'json' }

describe('trigramSimilarity', () => {
  it('equals Postgres similarity() on every captured production pair', () => {
    expect(fixture.pairs).toHaveLength(500)
    const mismatches = fixture.pairs
      .map(pair => ({ ...pair, port: trigramSimilarity(pair.a, pair.b) }))
      .filter(pair => pair.port !== Math.fround(pair.similarity))
    expect(mismatches).toEqual([])
  })

  it('pads words the way pg_trgm does', () => {
    expect([...trigrams('Cat')].sort()).toEqual(['  c', ' ca', 'at ', 'cat'])
    expect(trigrams('a-B')).toEqual(new Set(['  a', ' a ', '  b', ' b ']))
  })

  it('is 0 when either side has no letters or digits, and symmetric', () => {
    expect(trigramSimilarity('', 'Bebop')).toBe(0)
    expect(trigramSimilarity('🍻 —', 'Bebop')).toBe(0)
    expect(trigramSimilarity('Bebop Club', 'bebop')).toBe(trigramSimilarity('bebop', 'Bebop Club'))
  })
})
