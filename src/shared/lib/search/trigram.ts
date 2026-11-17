/**
 * A port of Postgres pg_trgm `similarity(a, b)` for venue names on D1, which has no pg_trgm.
 *
 * pg_trgm lowercases the text, splits it into words of letters and digits, pads each word with two spaces in front and
 * one behind, and takes every run of three characters. Similarity is the number of trigrams the two texts share over
 * the number in either, computed in single precision as Postgres' `real`. `trigram.test.ts` holds this equal to
 * production on 500 captured name pairs.
 */

const WORD = /[\p{L}\p{N}]+/gu

/** The distinct trigrams of `text`, as pg_trgm's `show_trgm` would list them. */
export function trigrams(text: string): Set<string> {
  const result = new Set<string>()
  for (const word of text.toLowerCase().match(WORD) ?? []) {
    const padded = [' ', ' ', ...word, ' ']
    for (let index = 0; index + 3 <= padded.length; index++) result.add(padded.slice(index, index + 3).join(''))
  }
  return result
}

/** pg_trgm `similarity(a, b)`: shared trigrams over all trigrams, 0 when either side has none. */
export function trigramSimilarity(a: string, b: string): number {
  const left = trigrams(a)
  const right = trigrams(b)
  if (left.size === 0 || right.size === 0) return 0
  let shared = 0
  for (const trigram of left) if (right.has(trigram)) shared++
  return Math.fround(shared / (left.size + right.size - shared))
}
