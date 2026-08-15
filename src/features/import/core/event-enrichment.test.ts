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

vi.mock('#shared/lib/ai/embeddings.ts', () => ({
  embedEventWithDocument: vi.fn(),
  CURRENT_EMBEDDING_VERSION: 2,
}))

vi.mock('#features/import/adapters/enrichment/registry.ts', () => ({
  getEnrichmentAdapter: vi.fn(),
}))

import { enrichSingleEvent } from './event-enrichment.ts'
import { embedEventWithDocument, CURRENT_EMBEDDING_VERSION } from '#shared/lib/ai/embeddings.ts'
import { getEnrichmentAdapter } from '#features/import/adapters/enrichment/registry.ts'
import { HttpError } from '#shared/lib/errors.ts'

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
    expect(written).toEqual({ facets: {} })
    expect(written).not.toHaveProperty('embedding')
    expect(written).not.toHaveProperty('enrichment_status')
    expect(written).not.toHaveProperty('description_es')
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
