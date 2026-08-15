import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import type { ToolDefinition } from './types.ts'
import { searchEventsTool } from './search-events.ts'
import { applyDiversity } from './quality-diversity.ts'
import {
  getEventsHappeningNow,
  getFurthestEventDate,
  searchEventsWithFilters,
  countEventsWithFilters,
  hybridEventSearch,
  searchVenuesByName,
} from '#shared/lib/db/client.server.ts'

vi.mock('#shared/lib/db/client.server.ts', () => ({
  getEventsHappeningNow: vi.fn(),
  searchEventsWithFilters: vi.fn(),
  countEventsWithFilters: vi.fn(),
  getFurthestEventDate: vi.fn(),
  hybridEventSearch: vi.fn(),
  searchVenuesByName: vi.fn(),
}))

// The mocked module exports ARE the mock fns; cast only for typing
// (bun test does not provide vi.mocked).
const mockedGetEventsHappeningNow = getEventsHappeningNow as unknown as Mock
const mockedGetFurthestEventDate = getFurthestEventDate as unknown as Mock
const mockedSearchEventsWithFilters = searchEventsWithFilters as unknown as Mock
const mockedCountEventsWithFilters = countEventsWithFilters as unknown as Mock
const mockedHybridEventSearch = hybridEventSearch as unknown as Mock
const mockedSearchVenuesByName = searchVenuesByName as unknown as Mock

const context = { userContext: { userId: null, isAuthenticated: false }, locale: 'en' as const }

// Local deterministic "happening now" corpus (no vibe fixtures — the vibe
// scorer is deleted). All starts_at are in Dec 2026 so the now-mode date-bounds
// tests can shrink the window to zero without ever intersecting the fixtures.
const NOW_FIXTURES = [
  {
    id: 'brunch-domingo',
    name: 'Brunch del Domingo',
    starts_at: '2026-12-20T11:00:00.000Z',
    venue_name: null,
    venue_id: null,
    venue_neighborhood: null,
    venue_address: null,
    categories: ['food'],
    is_free: false,
    price: null,
  },
  {
    id: 'yoga-palermo',
    name: 'Yoga Palermo',
    starts_at: '2026-12-19T10:00:00.000Z',
    venue_name: null,
    venue_id: null,
    venue_neighborhood: 'Palermo',
    venue_address: null,
    categories: ['sports'],
    is_free: true,
    price: 0,
  },
  {
    id: 'techno-fabrik',
    name: 'Techno Fabrik',
    starts_at: '2026-12-19T23:00:00.000Z',
    venue_name: null,
    venue_id: null,
    venue_neighborhood: 'Palermo',
    venue_address: null,
    categories: ['music'],
    is_free: false,
    price: 12000,
  },
]

// ============================================================================
// Phase 1 — candidateLimit ≠ displayLimit
//
// A limit-1 recommendation must still retrieve CANDIDATE_LIMIT (50) candidates
// before slicing down to the display limit, on both the semantic and
// filter-only paths.
// ============================================================================

describe('search_events Phase 1 — candidate limit vs display limit', () => {
  let tool: ToolDefinition

  // 50 minimal candidates so the tool under test can see a full candidate set.
  // Each carries a distinct category signature (and null venue) so the
  // Phase 9 diversity caps never collapse them — this suite isolates the
  // display-limit behavior, not diversity.
  const candidates = Array.from({ length: 50 }, (_, i) => ({
    id: `candidate-${i}`,
    name: `Candidate ${i}`,
    starts_at: `2026-01-01T00:00:00.000Z`,
    venue_name: null,
    venue_neighborhood: null,
    venue_address: null,
    categories: [`cat-${i % 50}`],
    is_free: false,
    price: null,
  }))

  beforeEach(async () => {
    vi.resetAllMocks()
    mockedGetFurthestEventDate.mockResolvedValue('2026-12-31T00:00:00.000Z')
    tool = searchEventsTool
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('semantic path with limit 1 calls hybridEventSearch with 50, not 1', async () => {
    mockedHybridEventSearch.mockResolvedValue(candidates)

    const result = await tool.execute(
      { query: 'orchestra concert', limit: 1 },
      context
    )

    expect(result.success).toBe(true)
    expect(mockedHybridEventSearch).toHaveBeenCalledTimes(1)
    expect(mockedHybridEventSearch).toHaveBeenCalledWith(
      'orchestra concert',
      expect.anything(),
      50
    )
  })

  it('returns exactly 1 event when the semantic candidate set is 50', async () => {
    mockedHybridEventSearch.mockResolvedValue(candidates)

    const result = await tool.execute(
      { query: 'museum exhibition', limit: 1 },
      context
    )

    expect(result.success).toBe(true)
    expect((result.events ?? []).length).toBe(1)
    // The returned event is the first candidate (top by vector order).
    expect((result.events ?? [])[0]?.id).toBe('candidate-0')
  })

  it('keeps the display limit honored for a limit-5 request on the semantic path', async () => {
    mockedHybridEventSearch.mockResolvedValue(candidates)

    const result = await tool.execute(
      { query: 'art gallery opening', limit: 5 },
      context
    )

    expect(result.success).toBe(true)
    expect(mockedHybridEventSearch).toHaveBeenCalledWith(
      'art gallery opening',
      expect.anything(),
      50
    )
    expect((result.events ?? []).length).toBe(5)
  })

  it('clamps an out-of-range display limit to DISPLAY_LIMIT_MAX', async () => {
    mockedHybridEventSearch.mockResolvedValue(candidates)

    const result = await tool.execute(
      { query: 'book reading club', limit: 10 },
      context
    )

    expect(result.success).toBe(true)
    expect((result.events ?? []).length).toBe(5)
  })

  it('filter-only path calls searchEventsWithFilters with 50 before slicing', async () => {
    mockedSearchEventsWithFilters.mockResolvedValue(candidates)

    const result = await tool.execute({ timeFilter: 'tonight', limit: 1 }, context)

    expect(result.success).toBe(true)
    expect(mockedSearchEventsWithFilters).toHaveBeenCalledTimes(1)
    expect(mockedSearchEventsWithFilters).toHaveBeenCalledWith(
      expect.anything(),
      50
    )
    expect((result.events ?? []).length).toBe(1)
  })
})

// Phase 2 — canonicalized constraints become SQL filters, and an unknown
// venue is reported (not silently dropped).

describe('search_events Phase 2 — canonicalized constraints', () => {
  let tool: ToolDefinition

  const candidates = Array.from({ length: 5 }, (_, i) => ({
    id: `candidate-${i}`,
    name: `Candidate ${i}`,
    starts_at: `2026-01-01T00:00:00.000Z`,
    venue_name: null,
    venue_neighborhood: null,
    venue_address: null,
    categories: [],
    is_free: false,
    price: null,
  }))

  beforeEach(async () => {
    vi.resetAllMocks()
    mockedGetFurthestEventDate.mockResolvedValue('2026-12-31T00:00:00.000Z')
    tool = searchEventsTool
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('free + neighborhood arrive as SQL filters on the filter-only path', async () => {
    mockedSearchVenuesByName.mockResolvedValue([])
    mockedSearchEventsWithFilters.mockResolvedValue(candidates)

    // "gratis en palermo" must canonicalize isFree + a Palermo neighborhood
    // filter, leaving no semantic text, and route to filter-only search.
    const result = await tool.execute(
      { query: 'gratis en palermo', limit: 2 },
      context
    )

    expect(result.success).toBe(true)
    expect(mockedSearchEventsWithFilters).toHaveBeenCalledTimes(1)
    const filters = mockedSearchEventsWithFilters.mock.calls[0][0]
    expect(filters.isFree).toBe(true)
    expect(filters.neighborhoods).toEqual(['Palermo'])
    expect(mockedHybridEventSearch).not.toHaveBeenCalled()
    expect((result.events ?? []).length).toBe(2)
  })

  it('an unknown venue returns zero events + a note and skips retrieval', async () => {
    mockedSearchVenuesByName.mockResolvedValue([])

    const result = await tool.execute({ venueName: 'NonExistent Venue' }, context)

    expect(result.success).toBe(true)
    expect(result.events ?? []).toEqual([])
    expect(result.formatted).toContain('unknown venue: NonExistent Venue')
    // No retrieval was attempted after canonicalize found zero venues.
    expect(mockedHybridEventSearch).not.toHaveBeenCalled()
    expect(mockedSearchEventsWithFilters).not.toHaveBeenCalled()
  })
})

// ============================================================================
// Token-boundary semantic routing
//
// Queries whose words are substrings of unrelated tokens (freestyle → "free",
// recital → "cita", dark comedy → techno) must NOT trip a skipped path — the
// vibe scorer is gone, so they simply stay on the semantic (hybrid) path.
// ============================================================================

describe('search_events token-boundary semantic routing', () => {
  let tool: ToolDefinition

  beforeEach(async () => {
    vi.resetAllMocks()
    mockedGetFurthestEventDate.mockResolvedValue('2026-12-31T00:00:00.000Z')
    mockedSearchEventsWithFilters.mockResolvedValue([])
    tool = searchEventsTool
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([
    // raw input query → canonicalized semanticQuery passed to retrieval
    ['freestyle rap', 'freestyle rap'],
    ['recital de rock', 'recital rock'],
    ['dark comedy', 'dark comedy'],
  ])('%s must route to semantic (hybridEventSearch)', async (query, semanticQuery) => {
    mockedHybridEventSearch.mockResolvedValue([])

    const result = await tool.execute({ query }, context)

    expect(result.success).toBe(true)
    // No vibe path exists anymore — all query text takes the semantic path.
    expect(result.metadata?.searchMode).toBe('semantic')
    expect(mockedHybridEventSearch).toHaveBeenCalledTimes(1)
    expect(mockedHybridEventSearch).toHaveBeenCalledWith(
      semanticQuery,
      expect.anything(),
      50
    )
  })

  it('vibe-y queries (chill/techno/tranqui) now route to semantic too', async () => {
    mockedHybridEventSearch.mockResolvedValue([])

    for (const query of ['chill tonight', 'algo tranqui', 'techno party']) {
      mockedHybridEventSearch.mockClear()
      const result = await tool.execute({ query }, context)
      expect(result.metadata?.searchMode, `"${query}" must route to semantic`).toBe('semantic')
      expect(mockedHybridEventSearch).toHaveBeenCalledTimes(1)
    }
  })

  it('categories pass through to the filter-only search (mocked searchEventsWithFilters)', async () => {
    mockedSearchEventsWithFilters.mockResolvedValue([])

    // A categories-only request (no semantic text) is filter-only; the
    // canonicalized categories must arrive on filters.categories.
    const result = await tool.execute({ categories: ['music'], limit: 2 }, context)

    expect(result.success).toBe(true)
    expect(mockedSearchEventsWithFilters).toHaveBeenCalledTimes(1)
    const filters = mockedSearchEventsWithFilters.mock.calls[0][0]
    expect(filters.categories).toEqual(['music'])
    expect(mockedHybridEventSearch).not.toHaveBeenCalled()
  })

  it('categories reach the candidate filter on the semantic path too', async () => {
    mockedHybridEventSearch.mockResolvedValue([])

    const result = await tool.execute({ query: 'concierto', categories: ['music'] }, context)

    expect(result.success).toBe(true)
    expect(result.metadata?.searchMode).toBe('semantic')
    expect(mockedHybridEventSearch).toHaveBeenCalledTimes(1)
    const filters = mockedHybridEventSearch.mock.calls[0][1] as Record<string, unknown>
    expect(filters.categories).toEqual(['music'])
  })
})

describe('search_events timeFilter "now" respects explicit date bounds', () => {
  let tool: ToolDefinition

  beforeEach(async () => {
    vi.resetAllMocks()
    mockedGetEventsHappeningNow.mockResolvedValue(NOW_FIXTURES)
    mockedGetFurthestEventDate.mockResolvedValue('2026-12-31T00:00:00.000Z')
    tool = searchEventsTool
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns zero now-events when dateFrom/dateTo are entirely in the future', async () => {
    // The mocked happening-now fixtures all start in Dec 2026 (in the past
    // relative to the requested window). The in-memory now filter must apply
    // the canonicalized startsAfter/startsBefore bounds and shrink to zero
    // (never widen back to the full happening-now set).
    const result = await tool.execute(
      {
        timeFilter: 'now',
        dateFrom: '2099-01-01',
        dateTo: '2099-01-05',
        limit: 3,
      },
      context
    )

    expect(result.success).toBe(true)
    expect((result.events ?? []).length).toBe(0)
    expect(mockedGetEventsHappeningNow).toHaveBeenCalledTimes(1)
  })

  it('returns zero now-events when the explicit window is entirely in the past', async () => {
    // A window whose bounds are entirely before every fixture start also
    // yields an empty intersection — no widening to the happening-now set.
    const result = await tool.execute(
      {
        timeFilter: 'now',
        dateFrom: '2026-01-01',
        dateTo: '2026-01-02',
        limit: 3,
      },
      context
    )

    expect(result.success).toBe(true)
    expect((result.events ?? []).length).toBe(0)
  })
})

// ============================================================================
// Phase 9 — Surprise-me (quality + near-term, NOT "the soonest") and list
// diversity (cap per venue / per category signature). Quality must never
// reorder the semantic path's relevance order; diversity only caps on lists.
// ============================================================================

describe('search_events Phase 9 — surprise-me and diversity', () => {
  let tool: ToolDefinition

  beforeEach(async () => {
    vi.resetAllMocks()
    mockedGetFurthestEventDate.mockResolvedValue('2026-12-31T00:00:00.000Z')
    mockedCountEventsWithFilters.mockResolvedValue(20)
    tool = searchEventsTool
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('surprise me is not the soonest when the soonest is location_tba / no image', async () => {
    const soon = Date.now() + 1 * 60 * 60 * 1000 // next hour
    const later = Date.now() + 48 * 60 * 60 * 1000 // two days out
    // Soonest = incomplete (no image, TBA location, no desc, no venue) → must lose.
    const incompleteSoonest = {
      id: 'incomplete-soonest',
      name: 'Mystery Warehouse Thing',
      starts_at: new Date(soon).toISOString(),
      image_url: null,
      venue_id: null,
      venue_name: null,
      location_tba: true,
      description_unavailable: true,
      categories: ['music'],
      is_free: false,
      price: null,
    }
    // Later = complete card → must beat the soonest via quality.
    const completeLater = {
      id: 'complete-later',
      name: 'Open-Air Jazz Session',
      starts_at: new Date(later).toISOString(),
      image_url: 'https://img/jazz.jpg',
      venue_id: 'venue-jazz',
      venue_name: 'Jazz Club',
      location_tba: false,
      description_unavailable: false,
      categories: ['music'],
      is_free: false,
      price: 5000,
    }
    mockedSearchEventsWithFilters.mockResolvedValue([incompleteSoonest, completeLater])

    const result = await tool.execute({ objective: 'surprise' }, context)

    expect(result.success).toBe(true)
    expect(result.metadata?.searchMode).toBe('surprise')
    expect(mockedHybridEventSearch).not.toHaveBeenCalled()
    const events = result.events ?? []
    expect(events.length).toBe(1)
    expect(events[0]?.id).toBe('complete-later')
  })

  it('a 4-event list does not return 4 events from the same venue if alternatives exist', async () => {
    const mk = (id: string, venueId: string, startsOffsetMs: number, categories: string[]) => ({
      id,
      name: id,
      starts_at: new Date(Date.now() + startsOffsetMs).toISOString(),
      image_url: null,
      venue_id: venueId,
      venue_name: venueId,
      location_tba: false,
      description_unavailable: false,
      categories,
      is_free: false,
      price: null,
    })
    // 4 events at venue A + 2 at venue B (different category signature so the
    // venue cap, not the category cap, is what constrains venue A to 2).
    const candidates = [
      mk('a-0', 'venue-a', 1, ['music']),
      mk('a-1', 'venue-a', 2, ['music']),
      mk('a-2', 'venue-a', 3, ['music']),
      mk('a-3', 'venue-a', 4, ['music']),
      mk('b-0', 'venue-b', 5, ['food']),
      mk('b-1', 'venue-b', 6, ['food']),
    ]
    mockedSearchEventsWithFilters.mockResolvedValue(candidates)

    const result = await tool.execute({ categories: ['music'], limit: 4 }, context)

    expect(result.success).toBe(true)
    const events = result.events ?? []
    expect(events.length).toBe(4)
    const venueCounts = events.reduce<Record<string, number>>((acc, e) => {
      acc[e.venue_id ?? 'none'] = (acc[e.venue_id ?? 'none'] ?? 0) + 1
      return acc
    }, {})
    expect(venueCounts['venue-a']).toBe(2)
    expect(venueCounts['venue-b']).toBe(2)
  })

  it('semantic path keeps relevance order and caps same-venue hits via diversity', async () => {
    // 5 same-venue candidates in vector/relevance order; quality must not
    // reorder them, diversity caps the list at 2 from one venue.
    const mk = (id: string, i: number) => ({
      id,
      name: id,
      starts_at: new Date(Date.now() + i * 3600_000).toISOString(),
      image_url: null,
      venue_id: 'venue-x',
      venue_name: 'Venue X',
      location_tba: false,
      description_unavailable: false,
      categories: ['music'],
      is_free: false,
      price: null,
    })
    const candidates = Array.from({ length: 5 }, (_, i) => mk(`candidate-${i}`, i))
    mockedHybridEventSearch.mockResolvedValue(candidates)

    const result = await tool.execute(
      { query: 'orchestra concert', categories: ['music'], limit: 4 },
      context
    )

    expect(result.success).toBe(true)
    expect(result.metadata?.searchMode).toBe('semantic')
    const events = result.events ?? []
    // 4 same-venue top hits are reduced by diversity (cap 2 per venue)…
    expect(events.length).toBeLessThanOrEqual(2)
    // …but the survivors stay in relevance (vector) order — quality did not reorder.
    expect(events.map((e) => e.id)).toEqual(['candidate-0', 'candidate-1'])
  })
})

// ============================================================================
// Phase 9 review blockers — surprise trigger/cardinality, `now` not surprise,
// now-list diversity, and diversity counter accounting.
// ============================================================================

describe('search_events Phase 9 review — surprise trigger + cardinality', () => {
  let tool: ToolDefinition

  const mk = (id: string, venueId: string | null, categories: string[]) => ({
    id,
    name: id,
    starts_at: new Date(Date.now() + 3600_000).toISOString(),
    image_url: 'https://img/' + id + '.jpg',
    venue_id: venueId,
    venue_name: venueId,
    location_tba: false,
    description_unavailable: false,
    categories,
    is_free: false,
    price: null,
  })

  beforeEach(async () => {
    vi.resetAllMocks()
    mockedGetFurthestEventDate.mockResolvedValue('2026-12-31T00:00:00.000Z')
    mockedCountEventsWithFilters.mockResolvedValue(20)
    tool = searchEventsTool
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('surprise with limit 3 still returns exactly 1 event', async () => {
    const candidates = [
      mk('s-0', 'venue-a', ['music']),
      mk('s-1', 'venue-b', ['food']),
      mk('s-2', 'venue-c', ['sports']),
      mk('s-3', 'venue-d', ['theater']),
    ]
    mockedSearchEventsWithFilters.mockResolvedValue(candidates)

    const result = await tool.execute({ objective: 'surprise', limit: 3 }, context)

    expect(result.success).toBe(true)
    expect(result.metadata?.searchMode).toBe('surprise')
    expect((result.events ?? []).length).toBe(1)
  })

  it('explicit objective search with an empty query stays chronological filter-only (never surprise)', async () => {
    const candidates = [
      mk('c-0', 'venue-a', ['music']),
      mk('c-1', 'venue-b', ['food']),
      mk('c-2', 'venue-c', ['sports']),
    ]
    mockedSearchEventsWithFilters.mockResolvedValue(candidates)

    const result = await tool.execute({ objective: 'search', limit: 2 }, context)

    expect(result.success).toBe(true)
    expect(result.metadata?.searchMode).toBe('filter_only')
    expect(mockedSearchEventsWithFilters).toHaveBeenCalledTimes(1)
    // filter-only chronological path is NOT quality/surprise-ranked.
    expect((result.events ?? []).length).toBe(2)
    expect((result.events ?? []).map((e) => e.id)).toEqual(['c-0', 'c-1'])
  })

  it('explicit objective surprise with a hard must (free) is NOT surprise', async () => {
    const candidates = [mk('f-0', 'venue-a', ['music'])]
    mockedSearchEventsWithFilters.mockResolvedValue(candidates)

    const result = await tool.execute({ objective: 'surprise', isFree: true, limit: 2 }, context)

    expect(result.success).toBe(true)
    expect(result.metadata?.searchMode).toBe('filter_only')
    expect(result.metadata?.hasFilters).toBe(true)
  })

  it('explicit objective surprise with a semantic query is NOT surprise', async () => {
    mockedHybridEventSearch.mockResolvedValue([])

    const result = await tool.execute(
      { objective: 'surprise', query: 'jazz night', limit: 2 },
      context
    )

    expect(result.success).toBe(true)
    expect(result.metadata?.searchMode).toBe('semantic')
    expect(mockedHybridEventSearch).toHaveBeenCalledTimes(1)
  })

  it('timeFilter now is not surprise even with limit > 1', async () => {
    mockedGetEventsHappeningNow.mockResolvedValue(NOW_FIXTURES)

    const result = await tool.execute({ timeFilter: 'now', limit: 2 }, context)

    expect(result.success).toBe(true)
    expect(result.metadata?.searchMode).toBe('now')
    // 'now' is a directed query, not a surprise pick.
    expect((result.events ?? []).length).toBe(2)
  })
})

describe('search_events Phase 9 review — now-list and diversity counters', () => {
  let tool: ToolDefinition

  const nowCand = (id: string, venueId: string | null, categories: string[]) => ({
    id,
    name: id,
    starts_at: '2026-12-20T11:00:00.000Z',
    image_url: null,
    venue_id: venueId,
    venue_name: venueId,
    venue_neighborhood: null,
    venue_address: null,
    location_tba: false,
    description_unavailable: false,
    categories,
    is_free: false,
    price: null,
  })

  beforeEach(async () => {
    vi.resetAllMocks()
    mockedGetFurthestEventDate.mockResolvedValue('2026-12-31T00:00:00.000Z')
    tool = searchEventsTool
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('now-list with a limit that would show >1 caps the number per venue', async () => {
    // 3 happening-now events, 2 from the same venue.
    mockedGetEventsHappeningNow.mockResolvedValue([
      nowCand('n-0', 'venue-x', ['music']),
      nowCand('n-1', 'venue-x', ['music']),
      nowCand('n-2', 'venue-y', ['food']),
    ])

    const result = await tool.execute({ timeFilter: 'now', limit: 3 }, context)

    expect(result.success).toBe(true)
    const events = result.events ?? []
    expect(events.length).toBe(3)
    expect(events.filter((e) => e.venue_id === 'venue-x').length).toBe(2)
    expect(events.filter((e) => e.venue_id === 'venue-y').length).toBe(1)
  })
})

describe('applyDiversity counters — rejected candidates must not consume capacity', () => {
  const mk = (id: string, venueId: string | null, categories: string[]) => ({
    id,
    name: id,
    starts_at: '2026-12-20T11:00:00.000Z',
    image_url: null,
    venue_id: venueId,
    venue_name: venueId,
    location_tba: false,
    description_unavailable: false,
    categories,
  })

  it('assigns an unused empty-category signature its own counting slot', async () => {
    const ranked = [
      mk('e-0', null, []),
      mk('e-1', null, []),
      mk('e-2', null, []),
      mk('e-3', null, []),
    ]
    const out = applyDiversity(ranked, 4)
    // Empty category signatures count toward the 3-per-signature cap.
    expect(out.map((e) => e.id)).toEqual(['e-0', 'e-1', 'e-2'])
  })

  it('category-rejected candidate does not consume an empty category slot either', async () => {
    // 4 empty-category events from 4 different venues.
    const ranked = [
      mk('v-0', 'venue-0', []),
      mk('v-1', 'venue-1', []),
      mk('v-2', 'venue-2', []),
      mk('v-3', 'venue-3', []),
    ]
    const out = applyDiversity(ranked, 4)
    expect(out.map((e) => e.id)).toEqual(['v-0', 'v-1', 'v-2'])
  })

  it('a candidate rejected on the category cap does not consume its venue slot', async () => {
    // Different venue ids but the SAME category signature 'music'. Because the
    // category cap (3) triggers before any venue slot, the 4th candidate must
    // be dropped without having consumed a venue slot — so a later same-venue
    // candidate with a different category can still be accepted up to the
    // per-venue cap.
    const ranked = [
      mk('m-0', 'venue-a', ['music']),
      mk('m-1', 'venue-b', ['music']),
      mk('m-2', 'venue-c', ['music']),
      mk('m-3', 'venue-d', ['music']), // category cap hit -> dropped
      mk('m-4', 'venue-a', ['food']), // venue-a still has room -> accepted
    ]
    const out = applyDiversity(ranked, 5)
    expect(out.map((e) => e.id)).toEqual(['m-0', 'm-1', 'm-2', 'm-4'])
  })
})
