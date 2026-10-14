import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildRerankDocument,
  buildRerankQuery,
  rerankEvents,
  type RerankDocumentEvent,
} from './rerank.ts'

function mkEvent(id: string, overrides: Partial<RerankDocumentEvent> = {}): RerankDocumentEvent {
  return {
    id,
    name: id,
    venue_name: null,
    venue_neighborhood: null,
    categories: [],
    starts_at: '2026-08-16T02:00:00.000Z',
    is_free: false,
    price: null,
    ...overrides,
  }
}

function voyageResponse(data: unknown): Response {
  return new Response(
    JSON.stringify({ object: 'list', data, model: 'rerank-2.5-lite', usage: { total_tokens: 8 } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

// ============================================================================
// buildRerankQuery
// ============================================================================

describe('buildRerankQuery', () => {
  it('returns empty string when nothing subjective', () => {
    expect(buildRerankQuery({ semanticQuery: '', prefer: {}, avoid: [] })).toBe('')
    expect(buildRerankQuery({ semanticQuery: '   ', prefer: {}, avoid: [] })).toBe('')
  })

  it('omits the Preferences line when prefer is empty', () => {
    const q = buildRerankQuery({ semanticQuery: 'jazz', prefer: {}, avoid: [] })
    expect(q).toBe('Request: jazz')
  })

  it('includes a Preferences line for a prefer-only query (with fallback request)', () => {
    const q = buildRerankQuery({
      semanticQuery: '',
      prefer: { genres: ['jazz'], vibes: ['relaxed'] },
      avoid: [],
    })
    expect(q).toContain('Request: eventos en Buenos Aires')
    expect(q).toContain('Preferences: genres: jazz; vibes: relaxed')
  })

  it('serializes avoid terms and omits an empty Preferences line', () => {
    const q = buildRerankQuery({
      semanticQuery: 'jazz',
      prefer: { genres: ['jazz'] },
      avoid: ['techno', 'reggaeton'],
    })
    expect(q).toContain('Request: jazz')
    expect(q).toContain('Preferences: genres: jazz')
    expect(q).toContain('Avoid: techno, reggaeton')
  })
})

// ============================================================================
// buildRerankDocument
// ============================================================================

describe('buildRerankDocument', () => {
  it('omits Summary and facet lines when absent', () => {
    const doc = buildRerankDocument(mkEvent('a'))
    expect(doc).toContain('Name: a')
    expect(doc).not.toContain('Summary:')
    expect(doc).not.toContain('Genres:')
    expect(doc).not.toContain('Vibes:')
    expect(doc).not.toContain('Venue:')
    expect(doc).not.toContain('Neighborhood:')
  })

  it('falls back to a truncated description when there is no summary', () => {
    const doc = buildRerankDocument(mkEvent('a', { description_es: 'x'.repeat(500) }))
    const summaryLine = doc.split('\n').find((l) => l.startsWith('Summary: '))
    expect(summaryLine).toBeDefined()
    expect(summaryLine!.slice('Summary: '.length).length).toBe(300)
  })

  it('includes facet lines when present', () => {
    const doc = buildRerankDocument(
      mkEvent('a', { facets: { genres: ['jazz', 'tango'], vibes: ['intimate'] } })
    )
    expect(doc).toContain('Genres: jazz, tango')
    expect(doc).toContain('Vibes: intimate')
  })

  it('renders Cost: Free vs ARS price', () => {
    expect(buildRerankDocument(mkEvent('free', { is_free: true }))).toContain('Cost: Free')
    expect(buildRerankDocument(mkEvent('paid', { is_free: false, price: 12000 }))).toContain(
      'Cost: 12000 ARS'
    )
  })
})

// ============================================================================
// rerankEvents
// ============================================================================

describe('rerankEvents', () => {
  it('aborts a pending request on caller cancellation instead of returning ranking fallback', async () => {
    vi.stubEnv('VOYAGE_API_KEY', 'test-key')
    const controller = new AbortController()
    let received: AbortSignal | undefined
    let started: () => void = () => {}
    const ready = new Promise<void>((resolve) => { started = resolve })
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      received = init?.signal ?? undefined
      started()
      return new Promise<Response>((_resolve, reject) => {
        received!.addEventListener('abort', () => reject(received!.reason), { once: true })
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const running = rerankEvents([mkEvent('a'), mkEvent('b')], { semanticQuery: 'jazz', prefer: {}, avoid: [] }, controller.signal)
    const outcome = running.then(() => ({ rejected: false }), () => ({ rejected: true }))
    await ready
    controller.abort()
    expect((await outcome).rejected).toBe(true)
    expect(received?.aborted).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps caller cancellation active while consuming the response body', async () => {
    vi.stubEnv('VOYAGE_API_KEY', 'test-key')
    const controller = new AbortController()
    let started: () => void = () => {}
    const ready = new Promise<void>((resolve) => { started = resolve })
    let bodyAborted = false
    vi.stubGlobal('fetch', async (_input: unknown, init?: RequestInit) => new Response(new ReadableStream({
      start(body) {
        init!.signal!.addEventListener('abort', () => { bodyAborted = true; body.error(init!.signal!.reason) }, { once: true })
        started()
      },
    }), { status: 200 }))
    const running = rerankEvents([mkEvent('a'), mkEvent('b')], { semanticQuery: 'jazz', prefer: {}, avoid: [] }, controller.signal)
    const outcome = running.then(() => ({ rejected: false }), () => ({ rejected: true }))
    await ready
    controller.abort()
    expect((await outcome).rejected).toBe(true)
    expect(bodyAborted).toBe(true)
  })

  it('orders by pure Voyage rank, not the legacy weighted fusion', async () => {
    vi.stubEnv('VOYAGE_API_KEY', 'test-key')
    const fetchMock = vi.fn().mockResolvedValue(
      voyageResponse([
        { index: 3, relevance_score: 0.95 },
        { index: 0, relevance_score: 0.6 },
        { index: 1, relevance_score: 0.4 },
        { index: 2, relevance_score: 0.2 },
      ])
    )
    vi.stubGlobal('fetch', fetchMock)

    const candidates = [mkEvent('a'), mkEvent('b'), mkEvent('c'), mkEvent('d')]
    const { ordered, meta } = await rerankEvents(candidates, {
      semanticQuery: 'jazz',
      prefer: {},
      avoid: [],
    })

    // base ranks: a=1, b=2, c=3, d=4. Voyage returns input indexes [3,0,1,2],
    // so reranker ranks: d=1, a=2, b=3, c=4 — pure Voyage puts d first.
    // The legacy 2/(60+rerankerRank)+1/(60+baseRank) fusion would instead put
    // a first (0.0487 vs d's 0.0484), so this test fails against that formula.
    expect(ordered.map((e) => e.id)).toEqual(['d', 'a', 'b', 'c'])
    expect(meta.status).toBe('applied')
    // d is the reranker's #1 despite being the worst base rank.
    expect(meta.ranks?.get('d')?.baseRank).toBe(4)
    expect(meta.ranks?.get('d')?.rerankerRank).toBe(1)
    expect(meta.ranks?.get('d')?.finalRank).toBe(1)
    // a is base rank 1 but only reranker/final rank 2.
    expect(meta.ranks?.get('a')?.rerankerRank).toBe(2)
    expect(meta.ranks?.get('a')?.finalRank).toBe(2)
  })

  it('never drops or duplicates candidates', async () => {
    vi.stubEnv('VOYAGE_API_KEY', 'test-key')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        voyageResponse([
          { index: 1, relevance_score: 0.8 },
          { index: 0, relevance_score: 0.1 },
        ])
      )
    )

    const candidates = [mkEvent('a'), mkEvent('b')]
    const { ordered } = await rerankEvents(candidates, {
      semanticQuery: 'jazz',
      prefer: {},
      avoid: [],
    })
    expect(ordered).toHaveLength(candidates.length)
    expect(new Set(ordered.map((e) => e.id))).toEqual(new Set(['a', 'b']))
  })

  it('falls back to input order with status failed on HTTP 500', async () => {
    vi.stubEnv('VOYAGE_API_KEY', 'test-key')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 500 })))

    const candidates = [mkEvent('a'), mkEvent('b')]
    const { ordered, meta } = await rerankEvents(candidates, {
      semanticQuery: 'jazz',
      prefer: {},
      avoid: [],
    })
    expect(ordered.map((e) => e.id)).toEqual(['a', 'b'])
    expect(meta.status).toBe('failed')
    expect(meta.error).toBeDefined()
  })

  it('falls back to input order with status failed on abort/timeout', async () => {
    vi.stubEnv('VOYAGE_API_KEY', 'test-key')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new DOMException('The operation was aborted.', 'AbortError'))
    )

    const candidates = [mkEvent('a'), mkEvent('b')]
    const { ordered, meta } = await rerankEvents(candidates, {
      semanticQuery: 'jazz',
      prefer: {},
      avoid: [],
    })
    expect(ordered.map((e) => e.id)).toEqual(['a', 'b'])
    expect(meta.status).toBe('failed')
    expect(meta.error).toBeDefined()
  })

  it('is disabled without a VOYAGE_API_KEY and never calls fetch', async () => {
    vi.stubEnv('VOYAGE_API_KEY', undefined)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const candidates = [mkEvent('a'), mkEvent('b')]
    const { ordered, meta } = await rerankEvents(candidates, {
      semanticQuery: 'jazz',
      prefer: {},
      avoid: [],
    })
    expect(ordered.map((e) => e.id)).toEqual(['a', 'b'])
    expect(meta.status).toBe('disabled')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('falls back to input order with status failed on malformed data', async () => {
    vi.stubEnv('VOYAGE_API_KEY', 'test-key')
    // Second entry is missing its `index` — malformed.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        voyageResponse([{ index: 0, relevance_score: 0.9 }, { relevance_score: 0.5 }])
      )
    )

    const candidates = [mkEvent('a'), mkEvent('b')]
    const { ordered, meta } = await rerankEvents(candidates, {
      semanticQuery: 'jazz',
      prefer: {},
      avoid: [],
    })
    expect(ordered.map((e) => e.id)).toEqual(['a', 'b'])
    expect(meta.status).toBe('failed')
    expect(meta.error).toBeDefined()
  })

  it('returns input order with status empty_query for a single candidate', async () => {
    vi.stubEnv('VOYAGE_API_KEY', 'test-key')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const candidates = [mkEvent('only')]
    const { ordered, meta } = await rerankEvents(candidates, {
      semanticQuery: 'jazz',
      prefer: {},
      avoid: [],
    })
    expect(ordered.map((e) => e.id)).toEqual(['only'])
    expect(meta.status).toBe('empty_query')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
