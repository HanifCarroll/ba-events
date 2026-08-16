/**
 * search_events query span annotation.
 *
 * The single declarative annotator for search_events queries. It tokenizes the
 * normalized input once, matches a set of exact contiguous token-span rules,
 * resolves overlaps deterministically, and emits the leftover semantic query
 * plus a compact trace for tests/debug.
 *
 * This replaces the previous parallel query-removal mechanisms — a value-based
 * `strippedTokens` set, generic/temporal token-index sets, weekday token and
 * weekday-phrase deletion, filler deletion, and neighborhood token deletion —
 * with one mechanism. Semantic residue is computed by token INDEX only (never
 * by token value), so a title occurrence ("Stranger Things") survives while a
 * homonymous generic phrase ("things to do") is removed.
 */

import { normalizeText } from '#shared/lib/utils/normalize-text.ts'

export type QuerySpanKind =
  | 'generic_discovery'
  | 'temporal'
  | 'weekday'
  | 'weekday_range'
  | 'neighborhood'
  | 'free'
  | 'filler'

export interface QuerySpan {
  /** Inclusive first token index. */
  startToken: number
  /** Exclusive last token index. */
  endToken: number
  kind: QuerySpanKind
  /** Exact normalized matched text (space-joined tokens). */
  text: string
  /** Optional canonical value (e.g. weekday index, canonical neighborhood). */
  value?: string | number
  /** Whether this span removes its tokens from the semantic query. */
  consumesSemanticQuery: boolean
}

export interface QueryRule {
  /** Exact contiguous phrase tokens (already normalized). Whole tokens only. */
  phrase: string[]
  kind: QuerySpanKind
  /** Optional canonical value attached to every matched span. */
  value?: string | number
  /** Whether a match consumes semantic tokens. Default true. */
  consumes?: boolean
  /** Optional priority band. Higher wins overlaps. Default: filler 0, else 1. */
  priority?: number
  /**
   * If any candidate span of one of these kinds exists anywhere in the query,
   * this rule's matches are dropped entirely. Used to keep "a named weekday
   * wins over weekday-only phrasing" (weekday_range is suppressed by weekday).
   */
  suppressedBy?: QuerySpanKind[]
}

/** Compact span shape for the trace (drops `consumesSemanticQuery`). */
export interface QuerySpanTrace {
  kind: QuerySpanKind
  startToken: number
  endToken: number
  text: string
  value?: string | number
}

export interface QueryAnnotationTrace {
  normalizedQuery: string
  spans: QuerySpanTrace[]
  semanticQuery: string
}

export interface AnnotatedQuery {
  normalizedQuery: string
  tokens: string[]
  /** Resolved, mutually non-overlapping spans in token order. */
  spans: QuerySpan[]
  /** Ordered tokens not covered by a consuming span. */
  semanticQuery: string
  /** Compact normalization trace (tests/debug) — never user-visible. */
  trace: QueryAnnotationTrace
}

/** Structured/domain kinds (everything but filler) form the upper band. */
function band(kind: QuerySpanKind): number {
  return kind === 'filler' ? 0 : 1
}

/**
 * Annotate a raw query: normalize → tokenize once → match → resolve → residue.
 */
export function annotateQuery(rawQuery: string, rules: QueryRule[]): AnnotatedQuery {
  const normalizedQuery = normalizeText(rawQuery)
  const tokens = normalizedQuery ? normalizedQuery.split(' ').filter(Boolean) : []

  // 1. Match every rule against the token array — exact contiguous spans only
  //    (no substring matching: each phrase token must equal a whole token).
  interface Candidate {
    span: QuerySpan
    priority: number
    declOrder: number
  }
  const candidates: Candidate[] = []
  rules.forEach((rule, declOrder) => {
    const n = rule.phrase.length
    if (n === 0) return
    for (let i = 0; i + n <= tokens.length; i++) {
      let ok = true
      for (let j = 0; j < n; j++) {
        if (tokens[i + j] !== rule.phrase[j]) {
          ok = false
          break
        }
      }
      if (!ok) continue
      candidates.push({
        span: {
          startToken: i,
          endToken: i + n,
          kind: rule.kind,
          text: tokens.slice(i, i + n).join(' '),
          value: rule.value,
          consumesSemanticQuery: rule.consumes !== false,
        },
        priority: rule.priority ?? band(rule.kind),
        declOrder,
      })
    }
  })

  // 2. Suppression: drop a rule's matches when a suppressed-by kind is present
  //    anywhere (e.g. weekday phrasing loses to a named weekday).
  const presentKinds = new Set(candidates.map((c) => c.span.kind))
  const surviving = candidates.filter(
    (c) => !rules[c.declOrder].suppressedBy?.some((k) => presentKinds.has(k))
  )

  // 3. Deterministic overlap resolution, documented here:
  //      a. structured/domain spans beat filler (priority band);
  //      b. then the longer match wins;
  //      c. then the earlier start wins;
  //      d. declaration order is the final tie-break.
  surviving.sort(
    (a, b) =>
      b.priority - a.priority ||
      b.span.endToken - b.span.startToken - (a.span.endToken - a.span.startToken) ||
      a.span.startToken - b.span.startToken ||
      a.declOrder - b.declOrder
  )

  const spans: QuerySpan[] = []
  const reserved = new Array<boolean>(tokens.length).fill(false)
  for (const candidate of surviving) {
    let overlaps = false
    for (let i = candidate.span.startToken; i < candidate.span.endToken; i++) {
      if (reserved[i]) {
        overlaps = true
        break
      }
    }
    if (overlaps) continue
    for (let i = candidate.span.startToken; i < candidate.span.endToken; i++) reserved[i] = true
    spans.push(candidate.span)
  }
  spans.sort((a, b) => a.startToken - b.startToken)

  // 4. Semantic residue = tokens not covered by a consuming span, in order.
  //    Built by exact token index only — no value-based deletion.
  const consumed = new Array<boolean>(tokens.length).fill(false)
  for (const span of spans) {
    if (!span.consumesSemanticQuery) continue
    for (let i = span.startToken; i < span.endToken; i++) consumed[i] = true
  }
  const semanticQuery = tokens.filter((_, i) => !consumed[i]).join(' ')

  const trace: QueryAnnotationTrace = {
    normalizedQuery,
    spans: spans.map(({ kind, startToken, endToken, text, value }) => ({
      kind,
      startToken,
      endToken,
      text,
      value,
    })),
    semanticQuery,
  }

  return { normalizedQuery, tokens, spans, semanticQuery, trace }
}
