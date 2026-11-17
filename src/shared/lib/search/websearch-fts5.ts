/**
 * Turns a search box query into an FTS5 MATCH expression with the meaning Postgres' `websearch_to_tsquery` gives it,
 * which lexical search used on Supabase:
 *
 * - Words are ANDed: `tango class` needs both.
 * - `"tango class"` is a phrase. An unclosed quote runs to the end.
 * - `or` between two operands is OR, and binds looser than AND: `a b or c` is `(a AND b) OR c`. An `or` at either end,
 *   or right after another `or`, is a plain word.
 * - A leading `-` negates the next operand: `tango -salsa`, `tango - salsa`, `-"a b"`.
 * - Other punctuation is not an operator. A word is split into tokens the way the index splits text, so `rock-and-roll`
 *   and `o'brien` become phrases, as in Postgres.
 *
 * FTS5 has no unary NOT, so an OR branch with only negated terms is dropped (Postgres would match every event
 * without the word). Returns null when nothing searchable is left, and the caller returns no rows.
 */

type Operand = { kind: 'term'; tokens: string[]; negated: boolean }
type Item = Operand | { kind: 'or' }

// The index's tokenizer (unicode61) keeps letters, digits, and private-use characters together and splits on the rest.
const TOKEN = /[\p{L}\p{N}\p{Co}]+/gu

const tokensOf = (text: string) => text.match(TOKEN) ?? []

function scan(query: string): Item[] {
  const items: Item[] = []
  let negate = false
  let index = 0
  const push = (text: string) => {
    const tokens = tokensOf(text)
    if (tokens.length) items.push({ kind: 'term', tokens, negated: negate })
    negate = false
  }
  while (index < query.length) {
    const char = query[index]
    if (/\s/u.test(char)) {
      index++
    } else if (char === '"') {
      const end = query.indexOf('"', index + 1)
      push(query.slice(index + 1, end === -1 ? query.length : end))
      index = end === -1 ? query.length : end + 1
    } else {
      let end = index
      while (end < query.length && !/\s/u.test(query[end]) && query[end] !== '"') end++
      let word = query.slice(index, end)
      index = end
      if (word.startsWith('-')) {
        negate = true
        word = word.replace(/^-+/, '')
        if (!word) continue
      }
      if (!negate && word.toLowerCase() === 'or') items.push({ kind: 'or' })
      else push(word)
    }
  }
  return items
}

/** The query's OR branches, each the operands that must all appear in an event, with negated ones dropped. */
function branches(query: string): Operand[][] {
  const items = scan(query)
  // Resolve each `or`: an operator only between an operand before it and anything after it; otherwise the word "or".
  const groups: Operand[][] = [[]]
  for (let index = 0; index < items.length; index++) {
    const item = items[index]
    const previous = items[index - 1]
    if (item.kind === 'or' && previous?.kind === 'term' && index + 1 < items.length) {
      groups.push([])
      const next = items[index + 1]
      // "a or or b": the second `or` is a word.
      if (next.kind === 'or') items[index + 1] = { kind: 'term', tokens: ['or'], negated: false }
      continue
    }
    groups[groups.length - 1].push(item.kind === 'or' ? { kind: 'term', tokens: ['or'], negated: false } : item)
  }
  return groups.filter(group => group.some(operand => !operand.negated))
}

/** The FTS5 expression for `query`, or null when it has nothing to search for. */
export function websearchToFts5(query: string): string | null {
  const phrase = (operand: Operand) => `"${operand.tokens.join(' ')}"`
  const expression = branches(query).map(group => {
    const positive = group.filter(operand => !operand.negated)
    const negative = group.filter(operand => operand.negated)
    return `(${positive.map(phrase).join(' AND ')}${negative.map(operand => ` NOT ${phrase(operand)}`).join('')})`
  })
  return expression.length ? expression.join(' OR ') : null
}

/** Lowercase and without accents, as the index compares words. */
export const foldWord = (word: string) => word.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/**
 * Postgres' `ts_rank_cd(to_tsvector('simple', text), websearch_to_tsquery('simple', query))` with default weights and
 * no normalization, which lexical search ranked by. It walks the minimal runs of the text (covers) that satisfy the
 * query, in order, and adds 0.1 / (1 + the other words inside each). A phrase counts only where its words are adjacent.
 * Negated words are left out (a matching event never contains them), and words compare folded, as the index matches.
 */
export function tsRankCd(text: string, query: string): number {
  const groups = branches(query).map(group => group.filter(operand => !operand.negated).map(operand => operand.tokens.map(foldWord)))
  const keys = new Map(groups.flat().map(tokens => [tokens.join(' '), tokens]))
  const words = tokensOf(text).map(foldWord)
  // Every occurrence of every query operand, in text order.
  const doc: Array<{ key: string; start: number; end: number }> = []
  for (let position = 0; position < words.length; position++) {
    for (const [key, tokens] of keys) {
      if (tokens.every((token, offset) => words[position + offset] === token)) doc.push({ key, start: position, end: position + tokens.length - 1 })
    }
  }
  const needs = groups.map(group => group.map(tokens => tokens.join(' ')))
  const satisfied = (from: number, to: number) => {
    const present = new Set(doc.slice(from, to + 1).map(entry => entry.key))
    return needs.some(group => group.every(key => present.has(key)))
  }
  let rank = 0
  let start = 0
  while (start < doc.length) {
    let end = start
    while (end < doc.length && !satisfied(start, end)) end++
    if (end === doc.length) break
    let begin = end
    while (!satisfied(begin, end)) begin--
    const inside = doc.slice(begin, end + 1).reduce((sum, entry) => sum + entry.end - entry.start + 1, 0)
    rank += 0.1 / (1 + Math.max(0, doc[end].end - doc[begin].start + 1 - inside))
    start = begin + 1
  }
  return rank
}
