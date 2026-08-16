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
const TUESDAY = new Date(2026, 7, 18, 0, 0, 0) // Aug 18 00:00 BA
const WEDNESDAY_AUG19 = new Date(2026, 7, 19, 0, 0, 0) // Aug 19 00:00 BA
const FRIDAY = new Date(2026, 7, 21, 0, 0, 0) // Aug 21 00:00 BA
const SATURDAY_AUG22 = new Date(2026, 7, 22, 0, 0, 0) // Aug 22 00:00 BA
const NEXT_MONDAY = new Date(2026, 7, 24, 0, 0, 0) // Aug 24 00:00 BA
const NEXT_TUESDAY = new Date(2026, 7, 25, 0, 0, 0) // Aug 25 00:00 BA
const NEXT_WEEK_NOON = new Date(2026, 7, 19, 12, 0, 0) // Aug 19 12:00 BA (Wed + 7d)

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
    // "eventos" is a generic discovery phrase — the clean cutover leaves an
    // empty semantic query so this routes to filter-only search, not to an
    // embedding of the word "eventos".
    expect(intent.semanticQuery).toBe('')
    expect(intent.objective).toBe('search')
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

  it('keeps adjacent "Monday or Tuesday" as two exact day windows', async () => {
    const intent = await canonicalizeSearchIntent({ query: 'Monday or Tuesday' }, SUNDAY)
    expect(intent.must.weekdayWindows).toEqual([
      { startsAfter: baToUTC(MONDAY), startsBefore: baToUTC(TUESDAY) },
      { startsAfter: baToUTC(TUESDAY), startsBefore: baToUTC(WEDNESDAY_AUG19) },
    ])
    expect(intent.must.startsAfter).toBeUndefined()
    expect(intent.must.startsBefore).toBeUndefined()
    expect(intent.semanticQuery).toBe('')
    expect(intent.objective).toBe('search')
  })

  it('keeps nonconsecutive "Monday or Friday" as disjoint day windows', async () => {
    const intent = await canonicalizeSearchIntent({ query: 'Monday or Friday' }, SUNDAY)
    expect(intent.must.weekdayWindows).toEqual([
      { startsAfter: baToUTC(MONDAY), startsBefore: baToUTC(TUESDAY) },
      { startsAfter: baToUTC(FRIDAY), startsBefore: baToUTC(SATURDAY_AUG22) },
    ])
  })

  it('handles a week boundary without spanning Tuesday through next Monday', async () => {
    const tuesdayNoon = new Date(2026, 7, 18, 12, 0, 0)
    const intent = await canonicalizeSearchIntent({ query: 'Monday or Tuesday' }, tuesdayNoon)
    expect(intent.must.weekdayWindows).toEqual([
      { startsAfter: baToUTC(tuesdayNoon), startsBefore: baToUTC(WEDNESDAY_AUG19) },
      { startsAfter: baToUTC(NEXT_MONDAY), startsBefore: baToUTC(NEXT_TUESDAY) },
    ])
  })

  it('explicit surprise cannot override a multi-weekday constraint', async () => {
    const intent = await canonicalizeSearchIntent(
      { query: 'Monday or Tuesday', objective: 'surprise' },
      SUNDAY
    )
    expect(intent.objective).toBe('search')
    expect(intent.must.weekdayWindows).toEqual([
      { startsAfter: baToUTC(MONDAY), startsBefore: baToUTC(TUESDAY) },
      { startsAfter: baToUTC(TUESDAY), startsBefore: baToUTC(WEDNESDAY_AUG19) },
    ])
    expect(intent.semanticQuery).toBe('')
  })

  it('consumes redundant weekday-range syntax while keeping the named-day window', async () => {
    const intent = await canonicalizeSearchIntent(
      { query: 'Monday during the week' },
      SUNDAY
    )
    expect(intent.must.startsAfter).toBe(baToUTC(MONDAY))
    expect(intent.must.startsBefore).toBe(baToUTC(TUESDAY))
    expect(intent.semanticQuery).toBe('')
    expect(intent.objective).toBe('search')
  })

  it('maps "during the week" on a Wednesday to a now → Saturday weekday window (not week)', async () => {
    const intent = await canonicalizeSearchIntent({ query: 'during the week' }, WEDNESDAY_NOON)
    expect(intent.must.startsAfter).toBe(baToUTC(WEDNESDAY_NOON))
    expect(intent.must.startsBefore).toBe(baToUTC(SATURDAY))
    expect(intent.semanticQuery).toBe('')
  })

  it('maps "entre semana" on a Saturday to the coming Monday → Friday weekday window', async () => {
    const intent = await canonicalizeSearchIntent({ query: 'entre semana' }, SATURDAY)
    expect(intent.must.startsAfter).toBe(baToUTC(MONDAY))
    expect(intent.must.startsBefore).toBe(baToUTC(SATURDAY_AUG22))
  })

  it('keeps timeFilter "week" as the next 7 days (now → +7 days)', async () => {
    const intent = await canonicalizeSearchIntent({ timeFilter: 'week' }, WEDNESDAY_NOON)
    expect(intent.must.startsAfter).toBe(baToUTC(WEDNESDAY_NOON))
    expect(intent.must.startsBefore).toBe(baToUTC(NEXT_WEEK_NOON))
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

describe('canonicalizeSearchIntent — prefer extraction', () => {
  it('extracts romantic vibe and jazz genre from "romantic jazz"', async () => {
    const intent = await canonicalizeSearchIntent({ query: 'romantic jazz' }, WEDNESDAY_NOON)
    expect(intent.prefer.vibes).toContain('romantic')
    expect(intent.prefer.genres).toContain('jazz')
  })

  it('extracts techno genre from "techno"', async () => {
    const intent = await canonicalizeSearchIntent({ query: 'techno' }, WEDNESDAY_NOON)
    expect(intent.prefer.genres).toContain('techno')
  })

  it('keeps chill detection and fills relaxed vibe for "chill tonight"', async () => {
    const intent = await canonicalizeSearchIntent({ query: 'chill tonight' }, WEDNESDAY_NOON)
    expect(detectChillIntent(intent.semanticQuery)).toBe(true)
    expect(intent.prefer.vibes).toContain('relaxed')
  })

  it('does NOT turn "recital" into an intimate vibe', async () => {
    const intent = await canonicalizeSearchIntent({ query: 'recital' }, WEDNESDAY_NOON)
    expect(intent.prefer.vibes ?? []).not.toContain('intimate')
  })

  it('does NOT classify "dark comedy" as techno', async () => {
    const intent = await canonicalizeSearchIntent({ query: 'dark comedy' }, WEDNESDAY_NOON)
    expect(intent.prefer.genres ?? []).not.toContain('techno')
  })
})

describe('canonicalizeSearchIntent — display limit defaults', () => {
  it('timeFilter tonight defaults to displayLimit 3 and objective search', async () => {
    const intent = await canonicalizeSearchIntent({ timeFilter: 'tonight' }, WEDNESDAY_NOON)
    expect(intent.displayLimit).toBe(3)
    expect(intent.objective).toBe('search')
  })

  it('vibe-only "chill" defaults to displayLimit 3', async () => {
    const intent = await canonicalizeSearchIntent({ query: 'chill' }, WEDNESDAY_NOON)
    expect(intent.displayLimit).toBe(3)
  })

  it('romantic vibe-only defaults to displayLimit 3', async () => {
    const intent = await canonicalizeSearchIntent({ query: 'romantic' }, WEDNESDAY_NOON)
    expect(intent.displayLimit).toBe(3)
  })

  it('surprise / empty input stays at displayLimit 1', async () => {
    const surprise = await canonicalizeSearchIntent({ objective: 'surprise' }, WEDNESDAY_NOON)
    expect(surprise.displayLimit).toBe(1)
    expect(surprise.objective).toBe('surprise')

    const empty = await canonicalizeSearchIntent({}, WEDNESDAY_NOON)
    expect(empty.displayLimit).toBe(1)
    expect(empty.objective).toBe('surprise')
  })

  it('tonight + neighborhood stays at displayLimit 1', async () => {
    const intent = await canonicalizeSearchIntent(
      { timeFilter: 'tonight', neighborhoods: ['Palermo'] },
      WEDNESDAY_NOON
    )
    expect(intent.displayLimit).toBe(1)
  })

  it('tonight + explicit limit 1 stays 1', async () => {
    const intent = await canonicalizeSearchIntent(
      { timeFilter: 'tonight', limit: 1 },
      WEDNESDAY_NOON
    )
    expect(intent.displayLimit).toBe(1)
  })

  it('tonight + explicit limit 5 stays 5', async () => {
    const intent = await canonicalizeSearchIntent(
      { timeFilter: 'tonight', limit: 5 },
      WEDNESDAY_NOON
    )
    expect(intent.displayLimit).toBe(5)
  })
})

describe('canonicalizeSearchIntent — generic discovery + temporal stripping', () => {
  const locationAsks: Array<{ query: string; neighborhood: string[] }> = [
    { query: 'planes en Recoleta', neighborhood: ['Recoleta'] },
    { query: 'eventos en Palermo', neighborhood: ['Palermo'] },
    { query: 'qué hay en San Telmo', neighborhood: ['San Telmo'] },
    { query: 'things to do in Belgrano', neighborhood: ['Belgrano'] },
  ]

  it.each(locationAsks)(
    '$query resolves the neighborhood, empties semanticQuery, and searches',
    async ({ query, neighborhood }) => {
      const intent = await canonicalizeSearchIntent({ query }, WEDNESDAY_NOON)
      expect(intent.must.neighborhoodIds).toEqual(neighborhood)
      expect(intent.semanticQuery).toBe('')
      expect(intent.objective).toBe('search')
    }
  )

  it.each(['qué hay', 'eventos', "what's on", 'things to do'])(
    '%s is filter-only discovery: empty semantic query, search, display limit 3',
    async (query) => {
      const intent = await canonicalizeSearchIntent({ query }, WEDNESDAY_NOON)
      expect(intent.semanticQuery).toBe('')
      expect(intent.objective).toBe('search')
      expect(intent.displayLimit).toBe(3)
    }
  )

  it.each(['Any events on Monday or Tuesday?', '¿Hay eventos el lunes o martes?'])(
    '%s canonicalizes to filter-only search with exact day windows',
    async (query) => {
      const intent = await canonicalizeSearchIntent({ query }, SUNDAY)
      expect(intent.semanticQuery).toBe('')
      expect(intent.objective).toBe('search')
      expect(intent.must.weekdayWindows).toEqual([
        { startsAfter: baToUTC(MONDAY), startsBefore: baToUTC(TUESDAY) },
        { startsAfter: baToUTC(TUESDAY), startsBefore: baToUTC(WEDNESDAY_AUG19) },
      ])
    }
  )

  it('explicit objective surprise still yields exactly one surprise pick', async () => {
    const intent = await canonicalizeSearchIntent({ objective: 'surprise' }, WEDNESDAY_NOON)
    expect(intent.objective).toBe('surprise')
    expect(intent.displayLimit).toBe(1)
    expect(intent.semanticQuery).toBe('')
  })

  it('"what\'s on tonight" with timeFilter tonight strips both phrases and keeps the tonight window', async () => {
    const intent = await canonicalizeSearchIntent(
      { query: "what's on tonight", timeFilter: 'tonight' },
      WEDNESDAY_NOON
    )
    expect(intent.semanticQuery).toBe('')
    expect(intent.objective).toBe('search')
    expect(intent.displayLimit).toBe(3)
    expect(intent.must.startsAfter).toBe(baToUTC(new Date(2026, 7, 12, 18, 0, 0)))
    expect(intent.must.startsBefore).toBe(baToUTC(new Date(2026, 7, 13, 6, 0, 0)))
  })

  it('"chill tonight" with timeFilter tonight keeps semantic "chill" and relaxed prefer', async () => {
    const intent = await canonicalizeSearchIntent(
      { query: 'chill tonight', timeFilter: 'tonight' },
      WEDNESDAY_NOON
    )
    expect(intent.semanticQuery).toBe('chill')
    expect(intent.prefer.vibes).toContain('relaxed')
  })

  it('keeps specific residue: "ópera gratis en Recoleta" → semantic opera + free + Recoleta', async () => {
    const intent = await canonicalizeSearchIntent(
      { query: 'ópera gratis en Recoleta' },
      WEDNESDAY_NOON
    )
    expect(intent.semanticQuery).toBe('opera')
    expect(intent.must.isFree).toBe(true)
    expect(intent.must.neighborhoodIds).toEqual(['Recoleta'])
  })

  it('keeps specific residue: "eventos de ópera gratis en Recoleta" → semantic opera, not empty', async () => {
    const intent = await canonicalizeSearchIntent(
      { query: 'eventos de ópera gratis en Recoleta' },
      WEDNESDAY_NOON
    )
    expect(intent.semanticQuery).toBe('opera')
  })

  it('preserves the "Stranger Things" title and strips only the generic phrase', async () => {
    // The em-dash normalizes away, so this becomes
    // "stranger things things to do in belgrano": "things" appears both in the
    // title and in the generic phrase. Only the phrase's token *indexes* are
    // stripped, so the title's "things" survives — a value-based stripper
    // would delete both occurrences and fail this assertion.
    const intent = await canonicalizeSearchIntent(
      { query: 'Stranger Things — things to do in Belgrano' },
      WEDNESDAY_NOON
    )
    expect(intent.semanticQuery).toBe('stranger things')
    expect(intent.must.neighborhoodIds).toEqual(['Belgrano'])
    expect(intent.objective).toBe('search')
  })

  it('keeps a temporal word as semantic when no structured filter exists ("jazz night")', async () => {
    const intent = await canonicalizeSearchIntent({ query: 'jazz night' }, WEDNESDAY_NOON)
    expect(intent.semanticQuery).toBe('jazz night')
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
