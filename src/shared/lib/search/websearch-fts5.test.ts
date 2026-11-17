import { describe, expect, it } from 'vitest'
import { tsRankCd, websearchToFts5 } from './websearch-fts5.ts'

// Each case lists the query, what Postgres 16's websearch_to_tsquery('simple', query) returned for it, and the FTS5
// expression with the same meaning.
const cases: Array<[query: string, postgres: string, fts5: string | null]> = [
  ['tango class', `'tango' & 'class'`, '("tango" AND "class")'],
  ['"tango class"', `'tango' <-> 'class'`, '("tango class")'],
  ['"unclosed phrase', `'unclosed' <-> 'phrase'`, '("unclosed phrase")'],
  ['tango or salsa', `'tango' | 'salsa'`, '("tango") OR ("salsa")'],
  ['tango OR salsa jazz', `'tango' | 'salsa' & 'jazz'`, '("tango") OR ("salsa" AND "jazz")'],
  ['a b or c d', `'a' & 'b' | 'c' & 'd'`, '("a" AND "b") OR ("c" AND "d")'],
  ['a "b c" or d', `'a' & 'b' <-> 'c' | 'd'`, '("a" AND "b c") OR ("d")'],
  ['or tango', `'or' & 'tango'`, '("or" AND "tango")'],
  ['tango or', `'tango' & 'or'`, '("tango" AND "or")'],
  ['or', `'or'`, '("or")'],
  ['a or or b', `'a' | 'or' & 'b'`, '("a") OR ("or" AND "b")'],
  ['"a or b"', `'a' <-> 'or' <-> 'b'`, '("a or b")'],
  ['tango -salsa', `'tango' & !'salsa'`, '("tango" NOT "salsa")'],
  ['a - b', `'a' & !'b'`, '("a" NOT "b")'],
  ['x -"a b"', `'x' & !( 'a' <-> 'b' )`, '("x" NOT "a b")'],
  ['a -or b', `'a' & !'or' & 'b'`, '("a" AND "b" NOT "or")'],
  ['a -b or c', `'a' & !'b' | 'c'`, '("a" NOT "b") OR ("c")'],
  ['rock-and-roll', `'rock-and-roll' <-> 'rock' <-> 'and' <-> 'roll'`, '("rock and roll")'],
  ["o'brien", `'o' <-> 'brien'`, '("o brien")'],
  ['a_b', `'a' <-> 'b'`, '("a b")'],
  ['tango, salsa; jazz!', `'tango' & 'salsa' & 'jazz'`, '("tango" AND "salsa" AND "jazz")'],
  ['jazz & (rock | !pop)', `'jazz' & 'rock' & 'pop'`, '("jazz" AND "rock" AND "pop")'],
  ['a" b', `'a' & 'b'`, '("a" AND "b")'],
  ['música', `'música'`, '("música")'],
  ['-', '', null],
  ['""', '', null],
  ['   ', '', null],
]

describe('websearchToFts5', () => {
  it.each(cases)('%s (Postgres: %s)', (query, _postgres, fts5) => {
    expect(websearchToFts5(query)).toBe(fts5)
  })

  it('drops an OR branch with only negated words, which FTS5 cannot express', () => {
    expect(websearchToFts5('-salsa')).toBeNull()
    expect(websearchToFts5('tango or -salsa')).toBe('("tango")')
  })

  it('never passes FTS5 syntax through', () => {
    expect(websearchToFts5('name:tango NEAR(a b) ^x * AND NOT')).toBe('("name tango" AND "NEAR a" AND "b" AND "x" AND "AND" AND "NOT")')
  })
})

// Each case lists the text, the query, and what Postgres 16 returned for
// ts_rank_cd(to_tsvector('simple', text), websearch_to_tsquery('simple', query)).
const ranks: Array<[text: string, query: string, postgres: number]> = [
  ['tango tango x tango', 'tango', 0.3],
  ['a b c a x x b', 'a b', 0.18333334],
  ['a b c a x x b', 'a or b', 0.4],
  ['a b c a x x b', '"a b"', 0.1],
  ['a x x x b a', 'a b', 0.125],
  ['b a', 'a b', 0.1],
  ['Stand up comedy. COMEDIA fina stand', 'stand up comedia', 0.083333336],
  ['x y z', 'a or y', 0.1],
  ['a b a b a b', 'a b c or b', 0.3],
  ['Tango class. Tango & amigos social dance tango', 'tango', 0.3],
]

describe('tsRankCd', () => {
  it.each(ranks)('%s / %s = %f', (text, query, postgres) => {
    expect(Math.fround(tsRankCd(text, query))).toBe(Math.fround(postgres))
  })

  it('compares words folded, as the index matches them, and ignores negated words', () => {
    expect(tsRankCd('Música en vivo', 'MUSICA')).toBe(0.1)
    expect(tsRankCd('tango salsa', 'tango -jazz')).toBe(0.1)
  })
})
