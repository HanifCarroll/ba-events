import { describe, expect, it } from 'vitest'
import {
  annotateQuery,
  type AnnotatedQuery,
  type QuerySpan,
  type QuerySpanKind,
} from './search-query-annotations.ts'
import { buildQueryAnnotationRules } from './search-query-rules.ts'

function annotate(
  query: string,
  timeFilter?: Parameters<typeof buildQueryAnnotationRules>[0]
): AnnotatedQuery {
  return annotateQuery(query, buildQueryAnnotationRules(timeFilter))
}

function spansOfKind(annotated: AnnotatedQuery, kind: QuerySpanKind): QuerySpan[] {
  return annotated.spans.filter((s) => s.kind === kind)
}

function expectSpan(
  annotated: AnnotatedQuery,
  kind: QuerySpanKind,
  startToken: number,
  endToken: number,
  text: string,
  value?: string | number
): void {
  const span = annotated.spans.find(
    (s) => s.kind === kind && s.startToken === startToken && s.endToken === endToken
  )
  expect(
    span,
    `expected ${kind} span [${startToken},${endToken}) in "${annotated.normalizedQuery}"`
  ).toBeDefined()
  expect(span!.text).toBe(text)
  if (value !== undefined) expect(span!.value).toBe(value)
}

// Invariants every annotation must hold.
function checkInvariants(annotated: AnnotatedQuery): void {
  const { tokens, spans, semanticQuery } = annotated

  // Span bounds + exact normalized text.
  for (const s of spans) {
    expect(s.startToken).toBeGreaterThanOrEqual(0)
    expect(s.endToken).toBeGreaterThan(s.startToken)
    expect(s.endToken).toBeLessThanOrEqual(tokens.length)
    expect(s.text).toBe(tokens.slice(s.startToken, s.endToken).join(' '))
  }

  // Consuming spans never overlap.
  const consuming = spans
    .filter((s) => s.consumesSemanticQuery)
    .sort((a, b) => a.startToken - b.startToken)
  for (let i = 0; i + 1 < consuming.length; i++) {
    expect(consuming[i].endToken).toBeLessThanOrEqual(consuming[i + 1].startToken)
  }

  // semanticQuery = ordered unconsumed tokens.
  const consumed = new Set<number>()
  for (const s of spans) {
    if (!s.consumesSemanticQuery) continue
    for (let i = s.startToken; i < s.endToken; i++) consumed.add(i)
  }
  expect(semanticQuery).toBe(tokens.filter((_, i) => !consumed.has(i)).join(' '))

  // Trace mirrors the resolved spans and residue.
  expect(annotated.trace.normalizedQuery).toBe(annotated.normalizedQuery)
  expect(annotated.trace.semanticQuery).toBe(semanticQuery)
  expect(annotated.trace.spans).toEqual(
    spans.map(({ kind, startToken, endToken, text, value }) => ({
      kind,
      startToken,
      endToken,
      text,
      value,
    }))
  )
}

const INVARIANT_QUERIES = [
  'qué hay',
  'a la gorra',
  'are there any events on Monday?',
  'Stranger Things — things to do in Belgrano',
  "what's on tonight",
  'jazz night',
  'planes en Recoleta',
  'eventos en Palermo',
  'qué hay en San Telmo',
  'things to do in Belgrano',
  'eventos',
  "what's on",
  'things to do',
  'el sábado',
  'Monday or Friday',
  'eventos de ópera gratis en Recoleta',
  'planes culturales gratis en Recoleta',
  'things to do alone tonight',
  'freestyle rap',
]

describe('annotateQuery — overlap resolution (complete phrases beat nested)', () => {
  it('"qué hay" resolves to a single generic span, no filler "que" leak', () => {
    const res = annotate('qué hay')
    expect(res.tokens).toEqual(['que', 'hay'])
    expectSpan(res, 'generic_discovery', 0, 2, 'que hay')
    expect(spansOfKind(res, 'filler')).toHaveLength(0)
    expect(res.semanticQuery).toBe('')
    checkInvariants(res)
  })

  it('"a la gorra" resolves to a single free span (beats filler "a"/"la")', () => {
    const res = annotate('a la gorra')
    expect(res.tokens).toEqual(['a', 'la', 'gorra'])
    expectSpan(res, 'free', 0, 3, 'a la gorra', 'free')
    expect(spansOfKind(res, 'filler')).toHaveLength(0)
    expect(res.semanticQuery).toBe('')
    checkInvariants(res)
  })

  it('"are there any events on Monday?" keeps the longest generic phrase + the weekday', () => {
    const res = annotate('are there any events on Monday?')
    expect(res.tokens).toEqual(['are', 'there', 'any', 'events', 'on', 'monday'])
    // The full 5-token phrase wins over its nested "any events" / "any events on".
    expectSpan(res, 'generic_discovery', 0, 5, 'are there any events on')
    expectSpan(res, 'weekday', 5, 6, 'monday', 1)
    expect(spansOfKind(res, 'generic_discovery')).toHaveLength(1)
    expect(res.semanticQuery).toBe('')
    checkInvariants(res)
  })
})

describe('annotateQuery — repeated token (index, not value)', () => {
  it('preserves the "Stranger Things" title and strips only the generic phrase', () => {
    const res = annotate('Stranger Things — things to do in Belgrano')
    expect(res.tokens).toEqual([
      'stranger',
      'things',
      'things',
      'to',
      'do',
      'in',
      'belgrano',
    ])
    // Only the phrase's token *indexes* (2..4) are stripped; the title's
    // "things" at index 1 survives.
    expectSpan(res, 'generic_discovery', 2, 5, 'things to do')
    expectSpan(res, 'filler', 5, 6, 'in')
    expectSpan(res, 'neighborhood', 6, 7, 'belgrano', 'Belgrano')
    expect(res.semanticQuery).toBe('stranger things')
    checkInvariants(res)
  })
})

describe('annotateQuery — active vs inactive temporal', () => {
  it('"what\'s on tonight" with tonight strips both phrases', () => {
    const res = annotate("what's on tonight", 'tonight')
    expectSpan(res, 'generic_discovery', 0, 3, 'what s on')
    expectSpan(res, 'temporal', 3, 4, 'tonight', 'tonight')
    expect(res.semanticQuery).toBe('')
    checkInvariants(res)
  })

  it('"jazz night" without a filter stays semantic (no temporal span)', () => {
    const res = annotate('jazz night')
    expect(spansOfKind(res, 'temporal')).toHaveLength(0)
    expect(res.semanticQuery).toBe('jazz night')
    checkInvariants(res)
  })
})

describe('annotateQuery — generic discovery queries', () => {
  it.each([
    ['planes en Recoleta', ['planes', 'en', 'recoleta']],
    ['eventos en Palermo', ['eventos', 'en', 'palermo']],
    ['qué hay en San Telmo', ['que', 'hay', 'en', 'san', 'telmo']],
    ['things to do in Belgrano', ['things', 'to', 'do', 'in', 'belgrano']],
    ['qué hay', ['que', 'hay']],
    ['eventos', ['eventos']],
    ["what's on", ['what', 's', 'on']],
    ['things to do', ['things', 'to', 'do']],
  ])('%s consumes every token → empty semantic query', (query, tokens) => {
    const res = annotate(query)
    expect(res.tokens).toEqual(tokens)
    expect(spansOfKind(res, 'generic_discovery').length).toBeGreaterThan(0)
    expect(res.semanticQuery).toBe('')
    checkInvariants(res)
  })

  it.each([
    ['planes en Recoleta', 'Recoleta'],
    ['eventos en Palermo', 'Palermo'],
    ['qué hay en San Telmo', 'San Telmo'],
    ['things to do in Belgrano', 'Belgrano'],
  ])('%s resolves the canonical neighborhood span', (query, neighborhood) => {
    const res = annotate(query)
    expect(spansOfKind(res, 'neighborhood').map((s) => s.value)).toEqual([neighborhood])
  })
})

describe('annotateQuery — weekday wording', () => {
  it.each([
    ['lunes', 1],
    ['monday', 1],
    ['martes', 2],
    ['miercoles', 3],
    ['viernes', 5],
    ['friday', 5],
    ['sabado', 6],
    ['domingo', 0],
  ])('%s resolves to weekday index %s', (token, day) => {
    const res = annotate(token)
    expectSpan(res, 'weekday', 0, 1, token, day)
    expect(res.semanticQuery).toBe('')
    checkInvariants(res)
  })

  it('"Monday or Friday" resolves two disjoint weekday spans', () => {
    const res = annotate('Monday or Friday')
    expect(res.tokens).toEqual(['monday', 'or', 'friday'])
    expectSpan(res, 'weekday', 0, 1, 'monday', 1)
    expectSpan(res, 'filler', 1, 2, 'or')
    expectSpan(res, 'weekday', 2, 3, 'friday', 5)
    expect(res.semanticQuery).toBe('')
    checkInvariants(res)
  })

  it('consumes weekday-range syntax while the named weekday retains precedence', () => {
    const res = annotate('Monday during the week')
    expectSpan(res, 'weekday', 0, 1, 'monday', 1)
    expectSpan(res, 'weekday_range', 1, 4, 'during the week')
    expect(res.semanticQuery).toBe('')
    checkInvariants(res)
  })

  it('weekday-only phrasing resolves a weekday_range span without a named day', () => {
    const res = annotate('during the week')
    expectSpan(res, 'weekday_range', 0, 3, 'during the week')
    expect(res.semanticQuery).toBe('')
    checkInvariants(res)
  })
})

describe('annotateQuery — production weekday phrases (generic + filler + weekday)', () => {
  it('"Any events on Monday or Tuesday?" resolves full generic, two weekdays, filler', () => {
    const res = annotate('Any events on Monday or Tuesday?')
    expect(res.tokens).toEqual(['any', 'events', 'on', 'monday', 'or', 'tuesday'])
    expectSpan(res, 'generic_discovery', 0, 3, 'any events on')
    expectSpan(res, 'weekday', 3, 4, 'monday', 1)
    expectSpan(res, 'filler', 4, 5, 'or')
    expectSpan(res, 'weekday', 5, 6, 'tuesday', 2)
    expect(spansOfKind(res, 'generic_discovery')).toHaveLength(1)
    expect(res.semanticQuery).toBe('')
    checkInvariants(res)
  })

  it('"¿Hay eventos el lunes o martes?" resolves hay-eventos, Spanish fillers, two weekdays', () => {
    const res = annotate('¿Hay eventos el lunes o martes?')
    expect(res.tokens).toEqual(['hay', 'eventos', 'el', 'lunes', 'o', 'martes'])
    expectSpan(res, 'generic_discovery', 0, 2, 'hay eventos')
    expectSpan(res, 'filler', 2, 3, 'el')
    expectSpan(res, 'weekday', 3, 4, 'lunes', 1)
    expectSpan(res, 'filler', 4, 5, 'o')
    expectSpan(res, 'weekday', 5, 6, 'martes', 2)
    expect(spansOfKind(res, 'generic_discovery')).toHaveLength(1)
    expect(res.semanticQuery).toBe('')
    checkInvariants(res)
  })
})

describe('annotateQuery — semantic residue', () => {
  it('"eventos de ópera gratis en Recoleta" → opera', () => {
    const res = annotate('eventos de ópera gratis en Recoleta')
    expectSpan(res, 'generic_discovery', 0, 1, 'eventos')
    expectSpan(res, 'free', 3, 4, 'gratis', 'free')
    expectSpan(res, 'neighborhood', 5, 6, 'recoleta', 'Recoleta')
    expect(res.semanticQuery).toBe('opera')
    checkInvariants(res)
  })

  it('"planes culturales gratis en Recoleta" → culturales', () => {
    const res = annotate('planes culturales gratis en Recoleta')
    expectSpan(res, 'generic_discovery', 0, 1, 'planes')
    expectSpan(res, 'free', 2, 3, 'gratis', 'free')
    expectSpan(res, 'neighborhood', 4, 5, 'recoleta', 'Recoleta')
    expect(res.semanticQuery).toBe('culturales')
    checkInvariants(res)
  })

  it('"things to do alone tonight" + tonight → alone', () => {
    const res = annotate('things to do alone tonight', 'tonight')
    expectSpan(res, 'generic_discovery', 0, 3, 'things to do')
    expectSpan(res, 'temporal', 4, 5, 'tonight', 'tonight')
    expect(res.semanticQuery).toBe('alone')
    checkInvariants(res)
  })
})

describe('annotateQuery — separated-token phrase regressions (contiguous only)', () => {
  it.each<[string, QuerySpanKind]>([
    // A phrase is only ever matched as exact adjacent tokens.
    // Reversed (wrong order).
    ['costo sin', 'free'], // reversed "sin costo"
    ['telmo san', 'neighborhood'], // reversed "san telmo"
    // Correct order but non-contiguous (separated by an unrelated token).
    ['sin jazz costo', 'free'], // "sin costo" split by "jazz"
    ['san jazz telmo', 'neighborhood'], // "san telmo" split by "jazz"
    ['things alone to do', 'generic_discovery'], // "things to do" split
    ['cosas que hacer', 'generic_discovery'], // "cosas para hacer" split by "que"
  ])('%s produces no %s span', (query, absentKind) => {
    const res = annotate(query)
    expect(spansOfKind(res, absentKind)).toHaveLength(0)
    checkInvariants(res)
  })
})

describe('annotateQuery — invariants across a query corpus', () => {
  it('holds span bounds, non-overlap, and ordered residue for every query', () => {
    for (const query of INVARIANT_QUERIES) {
      checkInvariants(annotate(query))
      // Also under the "tonight" filter where the temporal rules are active.
      checkInvariants(annotate(query, 'tonight'))
    }
  })

  it('is deterministic on a second run', () => {
    for (const query of INVARIANT_QUERIES) {
      const a = annotate(query, 'tonight')
      const b = annotate(query, 'tonight')
      expect(b.spans).toEqual(a.spans)
      expect(b.semanticQuery).toBe(a.semanticQuery)
      expect(b.trace).toEqual(a.trace)
    }
  })

  it('does not substring-match ("free" ⊄ "freestyle")', () => {
    const res = annotate('freestyle rap')
    expect(spansOfKind(res, 'free')).toHaveLength(0)
    expect(res.semanticQuery).toBe('freestyle rap')
    checkInvariants(res)
  })
})
