import type { CatalogStore, EnrichmentRow, EventWrite } from './catalog-store.ts'
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

import { Effect } from 'effect'
import { enrichSingleEvent, enrichEventsEffect, getEventsNeedingEnrichmentEffect } from './event-enrichment.ts'
import { embedEventWithDocument, CURRENT_EMBEDDING_VERSION } from '#shared/lib/ai/embeddings.ts'
import { getEnrichmentAdapter } from '#features/import/adapters/enrichment/registry.ts'
import { HttpError } from '#shared/lib/errors.ts'
import { ENRICHMENT_VERSION, type EnrichmentStageRecord } from './enrichment-provenance.ts'

const embedEventWithDocumentMock = embedEventWithDocument as unknown as Mock
const getEnrichmentAdapterMock = getEnrichmentAdapter as unknown as Mock

function makeClient() {
  const updates: Array<{ id: string; data: EventWrite }> = []
  const catalog = { updateEvent: async (id, data) => { updates.push({ id, data }) } } satisfies Partial<CatalogStore>
  return { catalog: catalog as unknown as CatalogStore, updates }
}

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
    const full = {
      version: 'previous-revision', textModel: 'previous-model', processedAt: '2026-10-01T12:00:00.000Z',
      sourceMode: 'detail' as const, sourceObservedAt: '2026-10-01T10:00:00.000Z', sourceValidatedAt: null,
    }
    const extractEventFacets = makeExtractFacetsMock()
    extractEventFacets.mockResolvedValue({ genres: ['jazz'] })
    const client: ReturnType<typeof makeClient> = makeClient()

    const result = await enrichSingleEvent(
      client.catalog,
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

  it('does NOT embed when facets-only backfill extracts empty facets', async () => {
    const extractEventFacets = makeExtractFacetsMock()
    extractEventFacets.mockResolvedValue({})
    const client: ReturnType<typeof makeClient> = makeClient()

    const result = await enrichSingleEvent(
      client.catalog,
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

describe('imported pending rows leave the enrichment queue', () => {
  function eventsTable(rows: EnrichmentRow[]): CatalogStore {
    const catalog = {
      eventsNeedingEnrichment: async ({ statuses = ['pending', 'failed'] }) => rows.filter(row =>
        statuses.some(status => status === row.enrichment_status)).map(row => ({ ...row })),
      updateEvent: async (id, data) => { Object.assign(rows.find(row => row.id === id)!, data) },
    } satisfies Partial<CatalogStore>
    return catalog as unknown as CatalogStore
  }

  it('completes an imported row (embedding + Spanish description) once, then reselection and a retried batch spend nothing', async () => {
    embedEventWithDocumentMock.mockReset()
    embedEventWithDocumentMock.mockResolvedValue({ embedding: [0.4], searchDocument: 'Jazz' })
    getEnrichmentAdapterMock.mockReset()
    const extractFacets = vi.fn(async () => ({ genres: ['jazz'] }))
    const buildPresentationFields = vi.fn(async () => ({ description_display_es: 'Jazz.', description_display_en: 'Jazz.', description_summary_es: null, description_summary_en: null }))
    const rows: EnrichmentRow[] = [{
      id: 'imported', name: 'Jazz', link: 'https://example.com/jazz', source: 'meetup',
      description_es: 'Jazz en vivo.', description_en: 'Live jazz.', enrichment_status: 'pending',
    }]
    const client = eventsTable(rows)
    const batch = () => Effect.runPromise(Effect.gen(function* () {
      const events = yield* getEventsNeedingEnrichmentEffect(client, { statuses: ['pending'] })
      return yield* enrichEventsEffect(client, events, { extractFacets: extractFacets as never, buildPresentationFields })
    }))

    expect((await batch()).enriched).toBe(1)
    expect(rows[0].enrichment_status).toBe('completed')
    // The next batch reselects, and a Workflow retry reruns the same batch.
    expect((await batch()).total).toBe(0)
    expect((await batch()).total).toBe(0)
    expect(extractFacets).toHaveBeenCalledTimes(1)
    expect(embedEventWithDocumentMock).toHaveBeenCalledTimes(1)
    expect(buildPresentationFields).toHaveBeenCalledTimes(1)
  })

  it('keeps a Spanish-only row retryable when translation fails, then completes it on the catch-up retry', async () => {
    embedEventWithDocumentMock.mockReset()
    embedEventWithDocumentMock.mockResolvedValue({ embedding: [0.4], searchDocument: 'Tango' })
    getEnrichmentAdapterMock.mockReset()
    const extractFacets = vi.fn(async () => ({ genres: ['tango'] }))
    const buildPresentationFields = vi.fn(async () => ({ description_display_es: 'Tango.', description_display_en: 'Tango.', description_summary_es: null, description_summary_en: null }))
    const rows: EnrichmentRow[] = [{
      id: 'ba-tourism-1', name: 'Tango', link: 'https://example.com/tango', source: 'ba-tourism',
      description_es: 'Tango en la plaza.', description_en: null, enrichment_status: 'pending',
    }]
    const client = eventsTable(rows)
    const batch = (statuses: Array<'pending' | 'failed'>, translate: (text: string) => Promise<string | null>) =>
      Effect.runPromise(Effect.gen(function* () {
        const events = yield* getEventsNeedingEnrichmentEffect(client, { statuses })
        return yield* enrichEventsEffect(client, events, { extractFacets: extractFacets as never, buildPresentationFields, translate: translate as never })
      }))

    // Provider error: translateText resolves null.
    expect((await batch(['pending'], async () => null)).failed).toBe(1)
    expect(rows[0]).toMatchObject({ enrichment_status: 'failed', enrichment_error: 'Failed to translate description to English', description_es: 'Tango en la plaza.', description_en: null })
    expect(embedEventWithDocumentMock).not.toHaveBeenCalled()
    // The daily chain only reselects pending rows; the failed row waits for the catch-up.
    expect((await batch(['pending'], async () => 'unused')).total).toBe(0)

    // Catch-up batch 1 retries failed rows.
    expect((await batch(['pending', 'failed'], async () => 'Tango in the square.')).enriched).toBe(1)
    expect(rows[0]).toMatchObject({ enrichment_status: 'completed', enrichment_error: null, description_es: 'Tango en la plaza.', description_en: 'Tango in the square.' })
    expect(embedEventWithDocumentMock).toHaveBeenCalledTimes(1)
  })
})

describe('enrichSingleEvent source provenance', () => {
  it('starts presentation only after embedding succeeds and writes both results together', async () => {
    let releaseEmbedding!: () => void
    let releasePresentation!: () => void
    const embedding = new Promise<void>((resolve) => { releaseEmbedding = resolve })
    const presentation = new Promise<void>((resolve) => { releasePresentation = resolve })
    embedEventWithDocumentMock.mockReset()
    embedEventWithDocumentMock.mockImplementation(async () => { await embedding; return { embedding: [0.1], searchDocument: 'Synthetic Jazz' } })
    const buildPresentationFields = vi.fn(async () => {
      await presentation
      return { description_display_es: 'Jazz.', description_display_en: 'Jazz.', description_summary_es: null, description_summary_en: null }
    })
    const client = makeClient()
    const running = enrichSingleEvent(client.catalog, {
      id: 'ordered', name: 'Synthetic Jazz', link: 'https://example.com/jazz', source: 'meetup',
      description_es: 'Jazz.', description_en: 'Jazz.',
    }, { extractFacets: async () => ({ eventType: [], genres: [], activities: [], vibes: [], audience: [], setting: [] }), buildPresentationFields })
    try {
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(embedEventWithDocumentMock).toHaveBeenCalledTimes(1)
      expect(buildPresentationFields).not.toHaveBeenCalled()
      expect(client.updates).toHaveLength(0)
      releaseEmbedding()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(buildPresentationFields).toHaveBeenCalledTimes(1)
      expect(client.updates).toHaveLength(0)
    } finally {
      releaseEmbedding()
      releasePresentation()
      await running
    }
    expect((await running).success).toBe(true)
    expect(client.updates).toHaveLength(1)
    expect(client.updates[0].data).toMatchObject({ embedding: [0.1], search_document: 'Synthetic Jazz', description_display_es: 'Jazz.', enrichment_status: 'completed' })
  })

  it('does not start presentation when embedding fails', async () => {
    embedEventWithDocumentMock.mockReset()
    embedEventWithDocumentMock.mockRejectedValue(new Error('Synthetic embedding outage'))
    const buildPresentationFields = vi.fn().mockResolvedValue({
      description_display_es: 'Jazz.', description_display_en: 'Jazz.', description_summary_es: null, description_summary_en: null,
    })
    const client = makeClient()
    const result = await enrichSingleEvent(client.catalog, {
      id: 'failed-embedding', name: 'Synthetic Jazz', link: 'https://example.com/jazz', source: 'meetup',
      description_es: 'Jazz.', description_en: 'Jazz.',
    }, { extractFacets: async () => ({ eventType: [], genres: [], activities: [], vibes: [], audience: [], setting: [] }), buildPresentationFields })
    expect(result).toMatchObject({ success: false, enriched: false })
    expect(embedEventWithDocumentMock).toHaveBeenCalledTimes(1)
    expect(buildPresentationFields).not.toHaveBeenCalled()
    expect(client.updates).toHaveLength(1)
    expect(client.updates[0].data).toMatchObject({ enrichment_status: 'failed' })
    expect(client.updates[0].data).not.toHaveProperty('embedding')
    expect(client.updates[0].data).not.toHaveProperty('enrichment_provenance')
  })

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
      const result = await enrichSingleEvent(client.catalog, {
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

    const result = await enrichSingleEvent(client.catalog, {
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

    const result = await enrichSingleEvent(client.catalog, {
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

describe('enrichSingleEvent hidden locations', () => {
  const facets = async () => ({ eventType: [], genres: [], activities: [], vibes: [], audience: [], setting: [] })
  const presentation = async () => ({ description_display_es: 'Jazz.', description_display_en: 'Jazz.', description_summary_es: null, description_summary_en: null })
  /** Applies event updates to one stored row; any venue lookup finds the same existing venue, so settlement would match it. */
  function venueClient(stored: Record<string, unknown> = {}) {
    const row: Record<string, unknown> = { location_hidden: false, venue_id: null, ...stored }
    const updates: Array<Record<string, unknown>> = []
    const venueLookups: string[] = []
    const venue = { id: 'venue-existing', name: 'Sala Sintética', neighborhood: 'Retiro', address: 'Av. Ficticia 1234' }
    const client = {
      updateEvent: async (_id: string, data: EventWrite) => { updates.push(data); Object.assign(row, data) },
      venuesNamed: async () => { venueLookups.push('named'); return [{ ...venue, event_count: 0 }] },
      venueNameAndNeighborhood: async () => { venueLookups.push('by-id'); return venue },
    } as unknown as CatalogStore
    return { client, row, updates, venueLookups }
  }
  // Bilingual adapter output skips language detection; `english: null` is what a failed translation leaves.
  const adapter = (location_hidden: boolean | undefined, { spanish = 'Jazz en vivo.' as string | null, english = 'Live jazz.' as string | null } = {}) => getEnrichmentAdapterMock.mockReturnValue({
    config: { requiresClientSide: false },
    serverEnrich: async () => ({ description_es: spanish, description_en: english, venue_name: location_hidden ? null : 'Sala Sintética', ...(location_hidden === undefined ? {} : { location_hidden }) }),
  })
  const input = (venue_id: string | null) => ({ id: 'luma-1', name: 'Jazz', link: 'https://luma.com/synthetic', source: 'luma', venue_id })
  const options = () => ({ extractFacets: facets, buildPresentationFields: presentation })

  beforeEach(() => {
    embedEventWithDocumentMock.mockReset()
    embedEventWithDocumentMock.mockResolvedValue({ embedding: [0.1], searchDocument: 'Jazz' })
  })

  it('flags a hidden event and settles no venue, even when the name matches an existing venue', async () => {
    adapter(true)
    const { client, row, venueLookups } = venueClient()
    expect(await enrichSingleEvent(client, input(null), options())).toMatchObject({ success: true, venueSettlement: undefined })
    expect(venueLookups).toHaveLength(0)
    expect(row).toMatchObject({ location_hidden: true, venue_id: null, enrichment_status: 'completed' })
    expect(embedEventWithDocumentMock.mock.calls[0]![0]).toMatchObject({ venue_name: null, venue_neighborhood: null })
  })

  it('drops a venue an event already had once the source hides the address', async () => {
    adapter(true)
    const { client, row } = venueClient({ venue_id: 'venue-existing' })
    await enrichSingleEvent(client, input('venue-existing'), options())
    expect(row).toMatchObject({ location_hidden: true, venue_id: null })
  })

  it('unhides an event that turns public and settles its venue normally', async () => {
    adapter(false)
    const { client, row } = venueClient({ location_hidden: true })
    await enrichSingleEvent(client, input(null), options())
    expect(row).toMatchObject({ location_hidden: false, venue_id: 'venue-existing' })
  })

  it('leaves location_hidden alone when the source cannot tell', async () => {
    adapter(undefined)
    const { client, row, updates } = venueClient({ location_hidden: true })
    await enrichSingleEvent(client, input(null), options())
    expect(updates.some(update => 'location_hidden' in update)).toBe(false)
    expect(row.location_hidden).toBe(true)
  })

  it('still hides a newly obfuscated event and clears its venue when the description is empty', async () => {
    adapter(true, { spanish: null, english: null })
    const { client, row } = venueClient({ venue_id: 'venue-existing' })
    expect(await enrichSingleEvent(client, input('venue-existing'), options())).toMatchObject({ success: false })
    expect(row).toMatchObject({ location_hidden: true, venue_id: null, enrichment_status: 'failed' })
  })

  it('still hides a newly obfuscated event and clears its venue when translation fails', async () => {
    adapter(true, { english: null })
    const { client, row } = venueClient({ venue_id: 'venue-existing' })
    expect(await enrichSingleEvent(client, input('venue-existing'), options())).toMatchObject({ success: false })
    expect(row).toMatchObject({ location_hidden: true, venue_id: null, enrichment_status: 'failed' })
  })

  it('still hides a newly obfuscated event and clears its venue when embedding fails', async () => {
    adapter(true)
    embedEventWithDocumentMock.mockRejectedValue(new Error('Synthetic embedding outage'))
    const { client, row } = venueClient({ venue_id: 'venue-existing' })
    expect(await enrichSingleEvent(client, input('venue-existing'), options())).toMatchObject({ success: false })
    expect(row).toMatchObject({ location_hidden: true, venue_id: null, enrichment_status: 'failed' })
  })
})
