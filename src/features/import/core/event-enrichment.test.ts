/**
 * Unit tests for the enrichment facets-only backfill path.
 *
 * Phase 5 forbids re-embedding: a previously-completed event whose `facets`
 * is `{}` must get facets WITHOUT calling `generateEventEmbedding`. These
 * tests are mocked end-to-end — no DeepSeek, no embed model, no network.
 *
 * IMPORTANT: `extractEventFacets` is injected (not module-mocked) so the
 * `extract-facets` module stays untouched — its mock would leak the shared
 * vitest mock registry into extract-facets.test.ts when both files run in one
 * `bun test` process.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('@/shared/lib/ai/embeddings', () => ({
  generateEventEmbedding: vi.fn(),
}))

import { enrichSingleEvent } from './event-enrichment'
import { generateEventEmbedding } from '@/shared/lib/ai/embeddings'

const generateEventEmbeddingMock = generateEventEmbedding as unknown as Mock

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
    generateEventEmbeddingMock.mockReset()
  })

  it('does NOT embed when the event is already completed but has empty facets', async () => {
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

    // Phase 5: MUST NOT re-embed.
    expect(generateEventEmbeddingMock).not.toHaveBeenCalled()

    // extractEventFacets WAS called (that's the point of this path).
    expect(extractEventFacets).toHaveBeenCalledTimes(1)

    // The only write was facets, never an embedding, status, or description.
    expect(client.updates).toHaveLength(1)
    const written = client.updates[0].data as Record<string, unknown>
    expect(written).toEqual({ facets: { genres: ['jazz'] } })
    expect(written).not.toHaveProperty('embedding')
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

    expect(generateEventEmbeddingMock).not.toHaveBeenCalled()
    expect(client.updates[0].data).toHaveProperty('facets')
  })
})
