import { describe, expect, it, vi, afterEach } from 'vitest'
import type { Mock } from 'vitest'
import { searchVenuesByName } from '#shared/lib/db/client.server.ts'
import { baToUTC } from './utils.ts'
import {
  canonicalizeSearchIntent,
  mustToFilters,
  applyPreferAvoid,
  detectChillIntent,
} from './search-intent.ts'

vi.mock('#shared/lib/db/client.server.ts', () => ({
  searchVenuesByName: vi.fn(),
}))

const mockedSearchVenuesByName = searchVenuesByName as unknown as Mock

// Pinned BA "now" (injected, never via getNowInBA): Wed 2026-08-12 12:00 BA.
// The functions treat the Date's local fields as BA wall-clock (via baToUTC),
// so constructing it directly keeps weekday/hour arithmetic deterministic.
const WEDNESDAY_NOON = new Date(2026, 7, 12, 12, 0, 0) // Wed, Aug 12 2026 12:00

const SATURDAY = new Date(2026, 7, 15, 0, 0, 0) // Aug 15 00:00 BA
const SUNDAY = new Date(2026, 7, 16, 0, 0, 0) // Aug 16 00:00 BA
const MONDAY = new Date(2026, 7, 17, 0, 0, 0) // Aug 17 00:00 BA

afterEach(() => {
  vi.clearAllMocks()
})

describe('canonicalizeSearchIntent — free language', () => {
  it('maps explicit isFree:true onto must.isFree', async () => {
    const intent = await canonicalizeSearchIntent({ isFree: true }, WEDNESDAY_NOON)
    expect(intent.must.isFree).toBe(true)
  })

  it('extracts "gratis" from the query and strips it from semanticQuery', async () => {
    const intent = await canonicalizeSearchIntent({ query: 'eventos gratis' }, WEDNESDAY_NOON)
    expect(intent.must.isFree).toBe(true)
    expect(intent.semanticQuery).not.toContain('gratis')
    expect(intent.semanticQuery).toBe('eventos')
  })

  it('does NOT set isFree from the substring "free" in "freestyle rap"', async () => {
    const intent = await canonicalizeSearchIntent({ query: 'freestyle rap' }, WEDNESDAY_NOON)
    expect(intent.must.isFree).toBeUndefined()
    expect(intent.semanticQuery).toBe('freestyle rap')
  })

  it('detects the "a la gorra" free phrase', async () => {
    const intent = await canonicalizeSearchIntent({ query: 'show a la gorra' }, WEDNESDAY_NOON)
    expect(intent.must.isFree).toBe(true)
    expect(intent.semanticQuery).not.toContain('gorra')
  })
})

describe('canonicalizeSearchIntent — date intent', () => {
  it('does NOT set a date window from the substring "cita" in "recital de rock"', async () => {
    const intent = await canonicalizeSearchIntent({ query: 'recital de rock' }, WEDNESDAY_NOON)
    expect(intent.must.startsAfter).toBeDefined() // just the upcoming default
    expect(intent.must.startsBefore).toBeUndefined() // no squeezed weekday window
  })

  it('maps timeFilter weekend on a Wednesday to Sat 00:00 → Mon 00:00 BA', async () => {
    const intent = await canonicalizeSearchIntent({ timeFilter: 'weekend' }, WEDNESDAY_NOON)
    expect(intent.must.startsAfter).toBe(baToUTC(SATURDAY))
    expect(intent.must.startsBefore).toBe(baToUTC(MONDAY))
  })

  it('maps query "el sábado" on a Wednesday to the next Saturday window', async () => {
    const intent = await canonicalizeSearchIntent({ query: 'el sábado' }, WEDNESDAY_NOON)
    expect(intent.must.startsAfter).toBe(baToUTC(SATURDAY))
    expect(intent.must.startsBefore).toBe(baToUTC(SUNDAY))
    // The weekday is a filter, not semantic text.
    expect(intent.semanticQuery).not.toContain('sabado')
  })

  it('intersects dateFrom/dateTo with timeFilter (immigration example)', async () => {
    const intent = await canonicalizeSearchIntent(
      { timeFilter: 'weekend', dateFrom: '2026-08-16', dateTo: '2026-08-20' },
      WEDNESDAY_NOON
    )
    // Later start: Sunday Aug 16 (dateFrom, a bare date → BA midnight) vs
    // Saturday Aug 15 (weekend). BA midnight Aug 16 = UTC 03:00.
    expect(intent.must.startsAfter).toBe(baToUTC(SUNDAY))
    // Earlier end: Monday Aug 17 (weekend) vs Aug 20 (dateTo).
    expect(intent.must.startsBefore).toBe(baToUTC(MONDAY))
  })

  it('produces an impossible window when the intersection is empty (does not widen)', async () => {
    const intent = await canonicalizeSearchIntent(
      { timeFilter: 'weekend', dateFrom: '2026-08-30', dateTo: '2026-08-31' },
      WEDNESDAY_NOON
    )
    // Weekend window ends Mon Aug 17; explicit range starts Aug 30 → after > before.
    expect(intent.must.startsBefore! < intent.must.startsAfter!).toBe(true)
  })
})

describe('canonicalizeSearchIntent — neighborhoods', () => {
  it('resolves explicit "palermo" to canonical Palermo', async () => {
    const intent = await canonicalizeSearchIntent({ neighborhoods: ['palermo'] }, WEDNESDAY_NOON)
    expect(intent.must.neighborhoodIds).toEqual(['Palermo'])
  })

  it('resolves "Palermo Soho" to Palermo', async () => {
    const intent = await canonicalizeSearchIntent({ neighborhoods: ['Palermo Soho'] }, WEDNESDAY_NOON)
    expect(intent.must.neighborhoodIds).toEqual(['Palermo'])
  })

  it('extracts San Telmo from the query when neighborhoods is empty', async () => {
    const intent = await canonicalizeSearchIntent({ query: 'planes en san telmo' }, WEDNESDAY_NOON)
    expect(intent.must.neighborhoodIds).toEqual(['San Telmo'])
  })
})

describe('canonicalizeSearchIntent — venues', () => {
  it('resolves venueName via searchVenuesByName to venue ids', async () => {
    mockedSearchVenuesByName.mockResolvedValue([
      { id: 'venue-niceto-1', name: 'Niceto Club' },
      { id: 'venue-niceto-2', name: 'Niceto Plaza' },
    ])
    const intent = await canonicalizeSearchIntent({ venueName: 'Niceto' }, WEDNESDAY_NOON)
    expect(mockedSearchVenuesByName).toHaveBeenCalledWith('Niceto')
    expect(intent.must.venueIds).toEqual(['venue-niceto-1', 'venue-niceto-2'])
  })

  it('leaves venueIds empty when the venue is unknown (constraint is not dropped)', async () => {
    mockedSearchVenuesByName.mockResolvedValue([])
    const intent = await canonicalizeSearchIntent({ venueName: 'NonExistent' }, WEDNESDAY_NOON)
    expect(intent.must.venueIds).toEqual([])
  })
})

describe('canonicalizeSearchIntent — avoid/negation', () => {
  it('keeps the negation in semanticQuery and sets no techno prefer', async () => {
    const intent = await canonicalizeSearchIntent(
      { query: 'anything except techno' },
      WEDNESDAY_NOON
    )
    expect(intent.semanticQuery).toContain('except techno')
    expect(intent.prefer.genres).toBeUndefined()
    expect(intent.avoid.genres).toBeUndefined()
  })

  it('does NOT classify "dark comedy" as techno', async () => {
    const intent = await canonicalizeSearchIntent({ query: 'dark comedy' }, WEDNESDAY_NOON)
    expect(intent.prefer.genres).toBeUndefined()
    expect(intent.avoid.genres).toBeUndefined()
    expect(intent.semanticQuery).toBe('dark comedy')
  })

  it('maps explicit avoid terms onto closed facet genre keys, ignoring unknown tokens', async () => {
    const intent = await canonicalizeSearchIntent(
      { avoid: ['techno', 'reggaetón', 'rave', 'house'] },
      WEDNESDAY_NOON
    )
    // 'techno' and 'house' are known keys; 'reggaetón' maps to 'reggaeton';
    // 'rave' is not a closed genre key and is ignored.
    expect(intent.avoid.genres).toEqual(['techno', 'reggaeton', 'house'])
  })
})

describe('canonicalizeSearchIntent — categories', () => {
  it('passes input categories onto must.categories', async () => {
    const intent = await canonicalizeSearchIntent(
      { query: 'concierto', categories: ['music'] },
      WEDNESDAY_NOON
    )
    expect(intent.must.categories).toEqual(['music'])
  })
})

describe('mustToFilters', () => {
  it('maps neighborhoodIds and venueIds to arrays', () => {
    const filters = mustToFilters({
      neighborhoodIds: ['Palermo', 'Villa Crespo'],
      venueIds: ['v1', 'v2'],
      isFree: true,
      maxPrice: 5000,
      attendeeAge: 18,
    })
    expect(filters.neighborhoods).toEqual(['Palermo', 'Villa Crespo'])
    expect(filters.venueIds).toEqual(['v1', 'v2'])
    expect(filters.isFree).toBe(true)
    expect(filters.maxPrice).toBe(5000)
    expect(filters.minAge).toBe(18)
  })

  it('maps input categories: ["music"] onto filters.categories', () => {
    const filters = mustToFilters({ categories: ['music'] })
    expect(filters.categories).toEqual(['music'])
  })

  it('omits categories when must carries none', () => {
    const filters = mustToFilters({})
    expect(filters.categories).toBeUndefined()
  })
})

describe('applyPreferAvoid', () => {
  it('threads avoid genres into EventFilters.avoidGenres (hard facet exclude)', async () => {
    const intent = await canonicalizeSearchIntent(
      { avoid: ['techno'], categories: ['music'] },
      WEDNESDAY_NOON
    )
    const filters = applyPreferAvoid(intent)
    expect(filters.avoidGenres).toEqual(['techno'])
    expect(filters.categories).toEqual(['music'])
  })

  it('leaves avoidGenres undefined when there are no avoids', async () => {
    const intent = await canonicalizeSearchIntent({ query: 'ciudad' }, WEDNESDAY_NOON)
    const filters = applyPreferAvoid(intent)
    expect(filters.avoidGenres).toBeUndefined()
  })
})

describe('detectChillIntent', () => {
  it.each([
    ['chill tonight'],
    ['algo tranquilo'],
    ['algo tranqui'],
    ['algo tranquila'],
    ['algo relajado'],
    ['algo relajada'],
    ['something relaxed'],
    ['something lowkey'],
    ['a low-key evening'],
    ['algo calmado'],
    ['jazz suave'],
  ])('detects %j as a chill ask', (query) => {
    expect(detectChillIntent(query)).toBe(true)
  })

  it.each([
    ['recital de rock'],
    ['chillout festival'],
    ['freestyle rap'],
    ['techno party'],
    [''],
    ['   '],
  ])('does NOT detect %j as a chill ask (token boundary, no substring)', (query) => {
    expect(detectChillIntent(query)).toBe(false)
  })
})
