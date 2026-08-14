import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { searchEventsTool } from './search-events'
import { VIBE_FIXTURES } from '../../../../../evals/search/vibe-fixtures'
import {
  getEventsHappeningNow,
  getFurthestEventDate,
} from '@/shared/lib/db/client'

vi.mock('@/shared/lib/db/client', () => ({
  getEventsHappeningNow: vi.fn(),
  searchEventsWithFilters: vi.fn(),
  countEventsWithFilters: vi.fn(),
  getFurthestEventDate: vi.fn(),
  hybridEventSearch: vi.fn(),
}))

// The mocked module exports ARE the mock fns; cast only for typing
// (bun test does not provide vi.mocked).
const mockedGetEventsHappeningNow = getEventsHappeningNow as unknown as Mock
const mockedGetFurthestEventDate = getFurthestEventDate as unknown as Mock

const context = { userContext: { userId: null, isAuthenticated: false }, locale: 'en' as const }

describe('search_events mode semantics (timeFilter "now")', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockedGetEventsHappeningNow.mockResolvedValue(VIBE_FIXTURES)
    mockedGetFurthestEventDate.mockResolvedValue('2026-12-31T00:00:00.000Z')
  })

  it('reports vibe mode and the relevance note when a now search is vibe-ranked', async () => {
    const result = await searchEventsTool.execute(
      { query: 'chill tonight', timeFilter: 'now', limit: 3 },
      context
    )

    expect(result.success).toBe(true)
    // The vibe path must be visible in telemetry/formatting, not hidden as "now".
    expect(result.metadata?.searchMode).toBe('vibe')
    expect(result.formatted).toContain('relevanceNote')

    // The window is still "now" — it travels via toolInput (telemetry
    // time_filter), so the mode change loses no information.
    const toolInput = result.metadata?.toolInput as { timeFilter?: string } | undefined
    expect(toolInput?.timeFilter).toBe('now')

    // Only calm fixtures clear the strong-evidence gate; the loud ones don't.
    const ids = (result.events ?? []).map((event) => event.id).sort()
    expect(ids).toEqual(['brunch-domingo', 'yoga-palermo'])
  })

  it('keeps plain now mode for a non-vibe now search (chronological slice)', async () => {
    const result = await searchEventsTool.execute(
      { query: 'jazz', timeFilter: 'now', limit: 3 },
      context
    )

    expect(result.metadata?.searchMode).toBe('now')
    expect(result.formatted).not.toContain('relevanceNote')
    expect((result.events ?? []).map((event) => event.id)).toEqual(
      VIBE_FIXTURES.slice(0, 3).map((event) => event.id)
    )
  })
})
