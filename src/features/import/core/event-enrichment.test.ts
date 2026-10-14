/**
 * Unit tests for the enrichment facets-only backfill path and terminal
 * `skipped` handling.
 *
 * Phase 5 forbade re-embedding a previously-completed event whose `facets` is
 * `{}` — but that left newly-extracted vibe tags invisible to search. The rule
 * is now: non-empty facets trigger a re-embed of the canonical search document;
 * empty facets keep the facets-only write (no re-embed). Also, sources that are
 * permanently ineligible for the server job (client-side-only, or a 404 page)
 * are marked `skipped` — terminal — instead of `failed` (retryable).
 *
 * These tests are mocked end-to-end — no DeepSeek, no embed model, no network.
 *
 * IMPORTANT: `extractEventFacets` is injected (not module-mocked) so the
 * `extract-facets` module stays untouched — its mock would leak the shared
 * vitest mock registry into extract-facets.test.ts when both files run in one
 * `bun test` process.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('#shared/lib/ai/embeddings.ts', () => ({
  embedEventWithDocument: vi.fn(),
  CURRENT_EMBEDDING_VERSION: 2,
}))

vi.mock('#features/import/adapters/enrichment/registry.ts', () => ({
  getEnrichmentAdapter: vi.fn(),
}))

import { enrichSingleEvent, countEventsNeedingEnrichment, getEventsNeedingEnrichment } from './event-enrichment.ts'
import { embedEventWithDocument, CURRENT_EMBEDDING_VERSION } from '#shared/lib/ai/embeddings.ts'
import { getEnrichmentAdapter } from '#features/import/adapters/enrichment/registry.ts'
import { HttpError } from '#shared/lib/errors.ts'
import { ENRICHMENT_VERSION, type EnrichmentStageRecord } from './enrichment-provenance.ts'

const embedEventWithDocumentMock = embedEventWithDocument as unknown as Mock
const getEnrichmentAdapterMock = getEnrichmentAdapter as unknown as Mock

/** Minimal fake Supabase client that records the update calls it receives. */
function makeClient() {
  const updates: Array<{ table: string; data: unknown }> = []
  const client = {
    updates,
    from: (table: string) => ({
      update: vi.fn((data: unknown) => {
        updates.push({ table, data })
        return { eq: vi.fn().mockResolvedValue({ error: null }) }
      }),
    }),
  }
  return client
}

/** A stub that never touches the real (or module-mocked) extract-facets code. */
function makeExtractFacetsMock() {
  return vi.fn()
}

/**
 * Recorder fake for the Supabase query-builder chain: every chained method
 * returns the builder and records its args, and the builder is awaitable at
 * the end (resolves to the supplied `result`).
 */
function makeQueryClient(result: unknown) {
  const calls: Array<{ method: string; args: unknown[] }> = []
  const builder: Record<string, unknown> = {
    then: (resolve: (v: unknown) => void) => resolve(result),
  }
  for (const method of ['select', 'in', 'neq', 'gte', 'not', 'eq', 'limit', 'order']) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args })
      return builder
    }
  }
  const from = (table: string) => {
    calls.push({ method: 'from', args: [table] })
    return builder
  }
  return { client: { from } as unknown as SupabaseClient, calls }
}

const queryArgsFor = (calls: Array<{ method: string; args: unknown[] }>, method: string) =>
  calls.filter((c) => c.method === method).map((c) => c.args)

describe('enrichSingleEvent facets-only path', () => {
  beforeEach(() => {
    embedEventWithDocumentMock.mockReset()
    embedEventWithDocumentMock.mockResolvedValue({
      embedding: [0.1, 0.2, 0.3],
      searchDocument: 'Noche de Jazz. Jazz en vivo íntimo. Intimate live jazz. Genres: jazz',
    })
    getEnrichmentAdapterMock.mockReset()
  })

  it('re-embeds when facets-only backfill extracts non-empty facets', async () => {
    const full = {
      version: 'previous-revision', textModel: 'previous-model', processedAt: '2026-10-01T12:00:00.000Z',
      sourceMode: 'detail' as const, sourceObservedAt: '2026-10-01T10:00:00.000Z', sourceValidatedAt: null,
    }
    const extractEventFacets = makeExtractFacetsMock()
    extractEventFacets.mockResolvedValue({ genres: ['jazz'] })
    const client: ReturnType<typeof makeClient> = makeClient()

    const result = await enrichSingleEvent(
      client as never,
      {
        id: 'evt-1',
        name: 'Noche de Jazz',
        link: 'https://example.com/jazz',
        source: 'eventbrite',
        categories: ['music'],
        description_es: 'Jazz en vivo íntimo.',
        description_en: 'Intimate live jazz.',
        enrichment_status: 'completed',
        enrichment_provenance: { full },
      },
      { extractFacets: extractEventFacets as never }
    )

    // Successfully routed through the facets-only path.
    expect(result.success).toBe(true)

    // Non-empty facets MUST re-embed the canonical search document.
    expect(embedEventWithDocumentMock).toHaveBeenCalledTimes(1)

    // extractEventFacets WAS called (that's the point of this path).
    expect(extractEventFacets).toHaveBeenCalledTimes(1)

    // The single write includes facets AND the rebuilt embedding columns.
    expect(client.updates).toHaveLength(1)
    const written = client.updates[0].data as Record<string, unknown>
    expect(written.facets).toEqual({ genres: ['jazz'] })
    expect(written).toHaveProperty('embedding')
    expect(written).toHaveProperty('search_document')
    expect(written.embedding_version).toBe(CURRENT_EMBEDDING_VERSION)
    expect((written.enrichment_provenance as { full: EnrichmentStageRecord }).full).toEqual(full)
    expect(written.enrichment_provenance).toMatchObject({ facets: {
      version: ENRICHMENT_VERSION, sourceMode: 'stored_description',
      sourceObservedAt: null, sourceValidatedAt: null, embeddingVersion: CURRENT_EMBEDDING_VERSION,
    } })
    expect(written).not.toHaveProperty('enrichment_status')
    expect(written).not.toHaveProperty('description_es')
  })

  it('treats a present embedding as already-enriched even without status=completed', async () => {
    const extractEventFacets = makeExtractFacetsMock()
    extractEventFacets.mockResolvedValue({ vibes: ['intimate'] })
    const client: ReturnType<typeof makeClient> = makeClient()

    await enrichSingleEvent(
      client as never,
      {
        id: 'evt-2',
        name: 'Milonga',
        link: 'https://example.com/milonga',
        source: 'eventbrite',
        description_es: 'Milonga tradicional.',
        description_en: 'Traditional milonga.',
        // status missing but embedding present -> still facets-only
        embedding: Array.from({ length: 384 }, (_, i) => i * 0.001),
      },
      { extractFacets: extractEventFacets as never }
    )

    expect(embedEventWithDocumentMock).toHaveBeenCalledTimes(1)
    expect(client.updates[0].data).toHaveProperty('facets')
    expect(client.updates[0].data).toHaveProperty('embedding')
  })

  it('does NOT embed when facets-only backfill extracts empty facets', async () => {
    const extractEventFacets = makeExtractFacetsMock()
    extractEventFacets.mockResolvedValue({})
    const client: ReturnType<typeof makeClient> = makeClient()

    const result = await enrichSingleEvent(
      client as never,
      {
        id: 'evt-3',
        name: 'Milonga sin señales',
        link: 'https://example.com/milonga',
        source: 'eventbrite',
        description_es: 'Milonga tradicional.',
        description_en: 'Traditional milonga.',
        enrichment_status: 'completed',
      },
      { extractFacets: extractEventFacets as never }
    )

    expect(result.success).toBe(true)
    expect(embedEventWithDocumentMock).not.toHaveBeenCalled()

    // Empty facets keep the facets-only write (no embedding/status/description).
    expect(client.updates).toHaveLength(1)
    const written = client.updates[0].data as Record<string, unknown>
    expect(written.facets).toEqual({})
    expect(written.enrichment_provenance).toMatchObject({ facets: {
      version: ENRICHMENT_VERSION, sourceObservedAt: null, sourceValidatedAt: null,
    } })
    expect((written.enrichment_provenance as { facets: unknown }).facets).not.toHaveProperty('embeddingVersion')
    expect(written).not.toHaveProperty('embedding')
    expect(written).not.toHaveProperty('enrichment_status')
    expect(written).not.toHaveProperty('description_es')
  })
})

describe('enrichSingleEvent source provenance', () => {
  it('persists a detail observation separately from processing time and keeps stored input age unknown', async () => {
    const sourceObservedAt = '2026-10-01T10:00:00.000Z'
    const sourceValidatedAt = '2026-10-02T10:00:00.000Z'
    embedEventWithDocumentMock.mockResolvedValue({ embedding: [0.1], searchDocument: 'Jazz' })
    getEnrichmentAdapterMock.mockReturnValue({
      config: { requiresClientSide: false },
      serverEnrich: async () => ({ description_es: 'Jazz en vivo.', description_en: 'Live jazz.', venue_name: null, sourceObservedAt, sourceValidatedAt }),
    })
    for (const stored of [false, true]) {
      const client = makeClient()
      const result = await enrichSingleEvent(client as never, {
        id: 'provenance', name: 'Jazz', link: 'https://example.com/jazz', source: 'meetup',
        ...(stored ? { description_es: 'Jazz en vivo.', description_en: 'Live jazz.' } : {}),
      }, {
        extractFacets: async () => ({ eventType: [], genres: [], activities: [], vibes: [], audience: [], setting: [] }),
        buildPresentationFields: async () => ({ description_display_es: 'Jazz en vivo.', description_display_en: 'Live jazz.', description_summary_es: null, description_summary_en: null }),
      })
      expect(result.success).toBe(true)
      const written = client.updates[0].data as { enriched_at: string; enrichment_provenance: { full: EnrichmentStageRecord } }
      expect(written.enrichment_provenance.full).toMatchObject({
        version: ENRICHMENT_VERSION, sourceMode: stored ? 'stored_description' : 'detail',
        sourceObservedAt: stored ? null : sourceObservedAt,
        sourceValidatedAt: stored ? null : sourceValidatedAt,
        embeddingVersion: CURRENT_EMBEDDING_VERSION,
      })
      expect(written.enrichment_provenance.full.processedAt).toBe(written.enriched_at)
      expect(Date.parse(written.enriched_at)).toBeGreaterThan(Date.parse(sourceValidatedAt))
    }
  })
})

describe('enrichSingleEvent terminal skipped handling', () => {
  beforeEach(() => {
    embedEventWithDocumentMock.mockReset()
    getEnrichmentAdapterMock.mockReset()
  })

  it('writes skipped for a client-side-only source without serverEnrich', async () => {
    getEnrichmentAdapterMock.mockReturnValue({
      source: 'passline',
      config: { requiresClientSide: true },
      // no serverEnrich
    })
    const client: ReturnType<typeof makeClient> = makeClient()

    const result = await enrichSingleEvent(client as never, {
      id: 'evt-4',
      name: 'Evento Passline',
      link: 'https://www.passline.com/evento/1',
      source: 'passline',
    })

    expect(result.success).toBe(true)
    expect(result.enriched).toBe(false)
    expect(client.updates).toHaveLength(1)
    const written = client.updates[0].data as Record<string, unknown>
    expect(written.enrichment_status).toBe('skipped')
    expect(written.enrichment_error).toBe('passline requires client-side extraction')
  })

  it('writes skipped + canceled on a 404 page', async () => {
    getEnrichmentAdapterMock.mockReturnValue({
      source: 'eventbrite',
      config: { requiresClientSide: false },
      serverEnrich: async () => {
        throw new HttpError(404, 'Not Found', 'https://example.com/gone')
      },
    })
    const client: ReturnType<typeof makeClient> = makeClient()

    const result = await enrichSingleEvent(client as never, {
      id: 'evt-5',
      name: 'Evento muerto',
      link: 'https://example.com/gone',
      source: 'eventbrite',
    })

    expect(result.canceled).toBe(true)
    expect(client.updates).toHaveLength(1)
    const written = client.updates[0].data as Record<string, unknown>
    expect(written.status).toBe('canceled')
    expect(written.enrichment_status).toBe('skipped')
    expect(written.enrichment_error).toBe('HTTP 404 - Event page not found')
  })
})

describe('countEventsNeedingEnrichment', () => {
  it('returns the exact count', async () => {
    const { client } = makeQueryClient({ count: 42 })
    await expect(countEventsNeedingEnrichment(client)).resolves.toBe(42)
  })

  it('scopes to createdAfter via created_at >= when provided', async () => {
    const { client, calls } = makeQueryClient({ count: 0 })
    await countEventsNeedingEnrichment(client, { createdAfter: '2026-08-18T09:00:00.000Z' })

    expect(queryArgsFor(calls, 'gte')).toContainEqual(['created_at', '2026-08-18T09:00:00.000Z'])
  })

  it('filters by source via eq when provided', async () => {
    const { client, calls } = makeQueryClient({ count: 0 })
    await countEventsNeedingEnrichment(client, { source: 'eventbrite' })

    expect(queryArgsFor(calls, 'eq')).toContainEqual(['source', 'eventbrite'])
  })

  it('applies the shared eligibility filters', async () => {
    const { client, calls } = makeQueryClient({ count: 0 })
    await countEventsNeedingEnrichment(client)

    expect(queryArgsFor(calls, 'in')).toContainEqual(['enrichment_status', ['pending', 'failed']])
    expect(queryArgsFor(calls, 'neq')).toContainEqual(['status', 'canceled'])
    expect(queryArgsFor(calls, 'neq')).toContainEqual(['status', 'past'])
    expect(queryArgsFor(calls, 'not')).toContainEqual(['link', 'is', null])
    expect(queryArgsFor(calls, 'gte').some((a) => a[0] === 'starts_at')).toBe(true)
  })

  it('counts only pending when statuses: ["pending"] (failed rows excluded)', async () => {
    const { client, calls } = makeQueryClient({ count: 0 })
    await countEventsNeedingEnrichment(client, { statuses: ['pending'] })

    expect(queryArgsFor(calls, 'in')).toContainEqual(['enrichment_status', ['pending']])
  })

  it('returns 0 on error instead of throwing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { client } = makeQueryClient({ error: { message: 'down' } })
    await expect(countEventsNeedingEnrichment(client)).resolves.toBe(0)
  })
})

describe('getEventsNeedingEnrichment failure-loop guard', () => {
  it('selects pending + failed by default (catch-up/remaining path)', async () => {
    const { client, calls } = makeQueryClient({ data: [], error: null })
    await getEventsNeedingEnrichment(client)

    expect(queryArgsFor(calls, 'in')).toContainEqual(['enrichment_status', ['pending', 'failed']])
  })

  it('selects pending only when statuses: ["pending"], so failed rows are not re-selected', async () => {
    const { client, calls } = makeQueryClient({ data: [], error: null })
    await getEventsNeedingEnrichment(client, { statuses: ['pending'] })

    expect(queryArgsFor(calls, 'in')).toContainEqual(['enrichment_status', ['pending']])
    expect(queryArgsFor(calls, 'in')).not.toContainEqual(['enrichment_status', ['pending', 'failed']])
  })

  it('orders oldest-first and limits the batch so later pending rows progress', async () => {
    const { client, calls } = makeQueryClient({ data: [], error: null })
    await getEventsNeedingEnrichment(client, { limit: 100, statuses: ['pending'] })

    expect(queryArgsFor(calls, 'order')).toContainEqual(['starts_at', { ascending: true }])
    expect(queryArgsFor(calls, 'limit')).toContainEqual([100])
  })

  it('returns rows unchanged (no client-side filtering)', async () => {
    const rows = [{ id: 'evt-1', name: 'A' }]
    const { client } = makeQueryClient({ data: rows, error: null })
    await expect(getEventsNeedingEnrichment(client)).resolves.toEqual(rows)
  })
})
