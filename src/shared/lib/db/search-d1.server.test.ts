import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { D1Database, VectorizeIndex, VectorizeQueryOptions } from '@cloudflare/workers-types'
import { freshD1 } from '../../../../tests/support/d1.ts'
import {
  countEventsWithFiltersD1,
  getEventsHappeningNowD1,
  getFurthestEventDateD1,
  lexicalEventSearchD1,
  searchEventsWithFiltersD1,
  searchVenuesByNameD1,
  semanticEventSearchD1,
} from './search-d1.server.ts'
import { cloudflareSearchBackend, useCloudflareBindings } from './search-bindings.server.ts'
import { lexicalEventSearch, semanticEventSearch } from './client.server.ts'
import { searchEventsTool, type SearchEventsInput } from '#features/chat/api/tools/search-events.ts'
import { orchestrate, type AgentRunner } from '#features/chat/api/agent/orchestrate.ts'
import { searchContextFromCanonical } from '#features/chat/api/agent/search-context.ts'
import { canonicalizeSearchIntent, mustToFilters } from '#features/chat/api/tools/search-intent.ts'
import { getNowInBA } from '#features/chat/api/tools/utils.ts'
import { runSharedChatTurn } from '#features/chat/api/agent/shared-turn.server.ts'
import { findSimilarVenueD1, intakeSimilarVenuesD1, mostSimilarVenue } from '#features/import/core/venue-similarity-d1.ts'

let db: D1Database
let dispose: () => Promise<void>
beforeAll(async () => ({ db, dispose } = await freshD1()), 60_000)
afterAll(async () => {
  useCloudflareBindings({})
  await dispose()
})

const at = (iso: string) => new Date(iso).toISOString()
let counter = 0
const id = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`

async function venue(name: string, fields: { neighborhood?: string; address?: string; created_at?: string } = {}) {
  const venueId = id()
  await db.prepare('INSERT INTO venues (id, name, neighborhood, address, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(venueId, name, fields.neighborhood ?? null, fields.address ?? null, fields.created_at ?? at('2026-01-01T00:00:00Z')).run()
  return venueId
}

type EventFields = Partial<{ search_document: string | null; description_es: string; starts_at: string; ends_at: string;
  time_tba: boolean; is_all_day: boolean; status: string; venue_id: string; categories: string[]; price: number; is_free: boolean; min_age: number; facets: object; scope: 'in' | 'out' | null }>
async function event(name: string, fields: EventFields = {}) {
  const eventId = id()
  await db.prepare(`INSERT INTO events (id, name, search_document, description_es, starts_at, ends_at, status, venue_id,
    categories, price, is_free, min_age, facets, time_tba, is_all_day, source, scope)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'luma', ?)`).bind(
    eventId, name, fields.search_document === undefined ? name : fields.search_document, fields.description_es ?? null,
    at(fields.starts_at ?? '2026-12-01T22:00:00Z'), fields.ends_at ? at(fields.ends_at) : null, fields.status ?? 'scheduled',
    fields.venue_id ?? null, JSON.stringify(fields.categories ?? []), fields.price ?? null, fields.is_free ? 1 : 0,
    fields.min_age ?? null, JSON.stringify(fields.facets ?? {}), fields.time_tba ? 1 : 0, fields.is_all_day ? 1 : 0, fields.scope === undefined ? 'in' : fields.scope).run()
  return eventId
}

const ids = (rows: Array<{ id: string }>) => rows.map(row => row.id)

beforeEach(async () => {
  await db.batch([db.prepare('DELETE FROM events'), db.prepare('DELETE FROM venues')])
})

it('leaves out-of-scope and unjudged events out of all discovery results and coverage', async () => {
  const inScope = await event('Agenda sintética', { starts_at: '2026-12-01T20:00:00Z' })
  const out = await event('Agenda sintética', { starts_at: '2026-12-01T19:00:00Z', scope: 'out' })
  const unjudged = await event('Agenda sintética', { starts_at: '2026-12-01T21:00:00Z', scope: null })
  const { index, getByIds } = fakeVectorize([out, unjudged, inScope].map(id => ({
    id, values: [1, 0], status: 'scheduled', starts_at: '2026-12-01T20:00:00Z',
  })))
  expect(ids(await lexicalEventSearchD1(db, 'agenda', {}, 1))).toEqual([inScope])
  expect(ids(await semanticEventSearchD1(db, index, [1, 0], {}, 3))).toEqual([inScope])
  expect(getByIds).toHaveBeenCalledWith([inScope])
  expect(ids(await searchEventsWithFiltersD1(db, {}, 1))).toEqual([inScope])
  expect(await countEventsWithFiltersD1(db, {})).toBe(1)
  expect(ids(await getEventsHappeningNowD1(db, new Date('2026-12-01T22:00:00Z')))).toEqual([inScope])
  expect(await getFurthestEventDateD1(db)).toBe('2026-12-01T20:00:00.000Z')
})

it('replays today and alternatives against a fixture catalog without repeating cards', async () => {
  useCloudflareBindings({ DB: db })
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-24T11:30:00Z'))
  try {
    const starts = '2026-11-24T03:00:00Z'
    const blues = await event('Blues time pending', { starts_at: starts, time_tba: true, description_es: 'Puertas a las 21:00.', is_free: true })
    const afternoon = await event('Printmaking workshop', { starts_at: '2026-11-24T13:00:00Z', is_free: true })
    await event('Short dance class', { starts_at: '2026-11-24T15:00:00Z', ends_at: '2026-11-24T16:00:00Z', is_free: true })
    const evening = await event('Outdoor film', { starts_at: '2026-11-24T23:00:00Z', is_free: true })
    const late = await event('Late drawing session', { starts_at: '2026-11-25T06:00:00Z', is_free: true })
    await event('Paid show', { starts_at: '2026-11-24T20:00:00Z' })
    await event('Tomorrow only', { starts_at: '2026-11-25T13:00:00Z', is_free: true })

    const turn = (requestId: string, text: string, toolInput: SearchEventsInput, previous: Awaited<ReturnType<typeof runSharedChatTurn>>[] = []) => {
      const runAgentFn: AgentRunner = async ({ tools, messages }) => {
        const toolCallId = `${requestId}-search`
        const output = await tools.search_events.execute!(toolInput, { toolCallId, messages, context: undefined })
        return { text: 'I found another option.', responseId: null, steps: [{
          toolCalls: [{ toolCallId, toolName: 'search_events', input: toolInput }],
          toolResults: [{ toolCallId, toolName: 'search_events', output }],
        }] }
      }
      return runSharedChatTurn({ requestId, text, locale: 'en', userContext: { userId: null, isAuthenticated: false },
        lastSearch: previous.length ? searchContextFromCanonical(previous[previous.length - 1].canonical) : null,
        priorHints: previous.map(({ canonical }) => ({ assistantMessageId: canonical.requestId, requestId: canonical.requestId,
          createdAt: null, events: canonical.events.map(row => ({ eventId: row.id, saved: row.saved })), operations: [] })),
      }, { orchestrateFn: input => orchestrate({ ...input, runAgentFn }) })
    }

    const first = await turn('today', "What's on today?", { objective: 'search', timeFilter: 'now', isFree: true, limit: 2 })
    expect(ids(first.canonical.events)).toEqual([blues, afternoon])
    expect(first.canonical.suggestions.map(s => s.id)).toContain('show-alternatives')

    // Preserve the free/today filters, but don't offer a class that ended before the follow-up.
    vi.setSystemTime(new Date('2026-11-24T18:30:00Z'))
    const second = await turn('alternatives', 'show me a few alternative options',
      { objective: 'search', query: "what's on today alternative options", timeFilter: 'now', limit: 5 }, [first])
    expect(ids(second.canonical.events)).toEqual([evening, late])
    expect(searchContextFromCanonical(second.canonical)).toMatchObject({ searchAnchor: '2026-11-24T18:30:00.000Z',
      input: { timeFilter: 'today', isFree: true } })
    expect(second.reads[0]?.input).not.toHaveProperty('query')
    expect(second.canonical.suggestions.map(s => s.id)).not.toContain('show-alternatives')

    const third = await turn('exhausted', 'muéstrame algunas opciones alternativas', { objective: 'search', timeFilter: 'future' }, [first, second])
    expect(third.canonical).toMatchObject({ kind: 'no_results', text: 'No encontré otras opciones que coincidan con tu búsqueda.', events: [], suggestions: [] })
  } finally {
    vi.useRealTimers()
    useCloudflareBindings({})
  }
})

it.each([
  ['now', 'What is happening right now?', 'Still running'],
  ['tonight', "What's on tonight?", 'Later this night'],
  ['week', "What's on this week?", 'Later this night'],
  ['future', 'What events are coming up?', 'Later this night'],
] as const)('re-resolves the %s window when the chip is tapped', async (timeFilter, originalQuery, expected) => {
  useCloudflareBindings({ DB: db })
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-25T05:00:00Z'))
  try {
    await event('Already ended', { starts_at: '2026-11-25T01:00:00Z', ends_at: '2026-11-25T03:00:00Z' })
    await event('Still running', { starts_at: '2026-11-25T04:30:00Z', ends_at: '2026-11-25T07:00:00Z' })
    await event('Later this night', { starts_at: '2026-11-25T06:00:00Z' })
    const result = await orchestrate({
      requestId: 'repeat-current-window', locale: 'en', originalQuery: 'Other options?',
      userContext: { userId: null, isAuthenticated: false }, priorDisplayedEvents: [],
      lastSearch: { originalQuery, input: { timeFilter }, searchAnchor: '2026-11-25T01:30:00.000Z' },
      runAgentFn: async ({ tools, messages }) => {
        expect(tools.get_directions).toBeDefined()
        const toolCallId = 'search'
        const output = await tools.search_events.execute!({ objective: 'search', limit: 5 }, { toolCallId, messages, context: undefined })
        return { text: 'Here’s another option.', responseId: null, steps: [{ toolResults: [{ toolCallId, output }] }] }
      },
    })
    expect(result.canonical.events.map(row => row.name)).toEqual([expected])
    expect(searchContextFromCanonical(result.canonical)?.searchAnchor).toBe('2026-11-25T05:00:00.000Z')
  } finally {
    vi.useRealTimers()
    useCloudflareBindings({})
  }
})

it('applies local calendar dates and live overlap to today across all retrieval paths', async () => {
  const timestamps = [
    ['Previous date only', '2026-11-23T03:00:00Z', { time_tba: true }],
    ['Overnight', '2026-11-24T02:00:00Z', { ends_at: '2026-11-24T05:00:00Z' }],
    ['Already ended', '2026-11-24T02:30:00Z', { ends_at: '2026-11-24T04:00:00Z' }],
    ['Today date only', '2026-11-24T03:00:00Z', { time_tba: true }],
    ['Today all day', '2026-11-24T03:00:00Z', { is_all_day: true }],
    ['Early morning', '2026-11-24T06:00:00Z', { ends_at: '2026-11-24T07:00:00Z' }],
    ['Evening', '2026-11-24T23:00:00Z', { ends_at: '2026-11-25T04:00:00Z' }],
    ['Tomorrow date only', '2026-11-25T03:00:00Z', { time_tba: true }],
    ['Tomorrow all day', '2026-11-25T03:00:00Z', { is_all_day: true }],
    ['After midnight', '2026-11-25T06:00:00Z', {}],
    ['At cutoff', '2026-11-25T09:00:00Z', {}],
    ['Tomorrow afternoon', '2026-11-25T16:00:00Z', {}],
  ] as const
  const rows = await Promise.all(timestamps.map(async ([name, starts_at, flags]) => ({
    id: await event(`Agenda ${name}`, { ...flags, starts_at }), starts_at, status: 'scheduled', values: [1, 0],
  })))
  const { index, query } = fakeVectorize(rows)
  const selected = (indices: readonly number[]) => new Set(indices.map(i => rows[i].id))
  const filtersAt = async (timeFilter: 'today' | 'tonight' | 'tomorrow', now: string, dateFrom?: string) =>
    mustToFilters((await canonicalizeSearchIntent({ timeFilter, ...(dateFrom ? { dateFrom } : {}) }, getNowInBA(new Date(now)))).must)

  // Local 01:00, 15:00, and 22:00. Tonight/tomorrow retain their existing start-only windows.
  for (const [now, today, tonight] of [
    ['2026-11-24T04:00:00Z', [1, 3, 4, 5], [5]],
    ['2026-11-24T18:00:00Z', [3, 4, 6, 9], [6, 7, 8, 9, 10]],
    ['2026-11-25T01:00:00Z', [3, 4, 6, 9], [6, 7, 8, 9, 10]],
  ] as const) {
    const filters = await filtersAt('today', now)
    const expected = selected(today)
    expect(new Set(ids(await searchEventsWithFiltersD1(db, filters, 20))), now).toEqual(expected)
    expect(new Set(ids(await lexicalEventSearchD1(db, 'agenda', filters, 20))), now).toEqual(expected)
    expect(new Set(ids(await semanticEventSearchD1(db, index, [1, 0], filters, 20))), now).toEqual(expected)
    expect(await countEventsWithFiltersD1(db, filters), now).toBe(expected.size)
    expect(new Set(ids(await searchEventsWithFiltersD1(db, await filtersAt('tonight', now), 20)))).toEqual(selected(tonight))
    expect(new Set(ids(await searchEventsWithFiltersD1(db, await filtersAt('tomorrow', now), 20)))).toEqual(selected([7, 8, 9, 10, 11]))
  }
  // Before-midnight matches survive even though Vectorize's nearest-neighbor pool starts at midnight.
  expect(query).toHaveBeenNthCalledWith(1, [1, 0], expect.objectContaining({ filter: {
    status: 'scheduled', starts_at: { $gte: Date.parse('2026-11-24T03:00:00Z'), $lte: Date.parse('2026-11-24T09:00:00Z') },
  } }))
  const explicit = await filtersAt('today', '2026-11-24T04:00:00Z', '2026-11-24')
  expect(new Set(ids(await searchEventsWithFiltersD1(db, explicit, 20)))).toEqual(selected([3, 4, 5]))
})


describe('events_fts', () => {
  it('follows inserts, updates of the indexed columns, and deletes', async () => {
    const tango = await event('Milonga del sábado', { search_document: 'Milonga del sábado. Tango social' })
    expect(ids(await lexicalEventSearchD1(db, 'tango', {}, 10))).toEqual([tango])

    await db.prepare(`UPDATE events SET search_document = 'Milonga del sábado. Salsa' WHERE id = ?`).bind(tango).run()
    expect(await lexicalEventSearchD1(db, 'tango', {}, 10)).toEqual([])
    expect(ids(await lexicalEventSearchD1(db, 'salsa', {}, 10))).toEqual([tango])

    // An update that leaves the indexed text alone keeps the row findable.
    await db.prepare(`UPDATE events SET image_width = 100 WHERE id = ?`).bind(tango).run()
    expect(ids(await lexicalEventSearchD1(db, 'salsa', {}, 10))).toEqual([tango])

    await db.prepare('DELETE FROM events WHERE id = ?').bind(tango).run()
    expect(await lexicalEventSearchD1(db, 'salsa', {}, 10)).toEqual([])
    expect(await db.prepare(`SELECT count(*) AS n FROM events_fts WHERE events_fts MATCH 'salsa OR tango'`).first('n')).toBe(0)
  })

  it('falls back to name and description when an event has no search document', async () => {
    const bare = await event('Feria de diseño', { search_document: null, description_es: 'Artesanos y cerámica' })
    expect(ids(await lexicalEventSearchD1(db, 'ceramica', {}, 10))).toEqual([bare])
    expect(ids(await lexicalEventSearchD1(db, 'feria diseno', {}, 10))).toEqual([bare])
  })

  it('a rebuild reproduces the trigger-maintained index', async () => {
    await event('Jazz en el patio', { search_document: 'Jazz en el patio. Venue: Bebop Club in Palermo' })
    await db.prepare(`INSERT INTO events_fts (events_fts) VALUES ('rebuild')`).run()
    await db.prepare(`INSERT INTO events_fts (events_fts) VALUES ('integrity-check')`).run()
    expect(await lexicalEventSearchD1(db, 'bebop', {}, 10)).toHaveLength(1)
  })
})

describe('lexicalEventSearchD1', () => {
  it('folds case and accents, needs every word, and ranks the better match first', async () => {
    // ts_rank_cd: "Jazz y música" is one tight cover (0.1/2), "música ... jazz" twice is two looser ones (0.1/3 each).
    const weak = await event('Noche', { search_document: 'Noche de jazz y música', starts_at: '2026-12-01T22:00:00Z' })
    const strong = await event('Música en vivo', { search_document: 'Música en vivo. Jazz, más música en vivo. Jazz', starts_at: '2026-12-09T22:00:00Z' })
    await event('Solo jazz', { search_document: 'Solo jazz' })
    const rows = await lexicalEventSearchD1(db, 'MUSICA jazz', {}, 10)
    expect(ids(rows)).toEqual([strong, weak])
    expect((rows[1] as unknown as { similarity: number }).similarity).toBe(Math.fround(0.05))
  })

  it('supports phrases, or, and negation', async () => {
    const tango = await event('Clase de tango', { search_document: 'Clase de tango para principiantes' })
    const salsa = await event('Clase de salsa', { search_document: 'Clase de salsa' })
    expect(ids(await lexicalEventSearchD1(db, '"clase de tango"', {}, 10))).toEqual([tango])
    expect(new Set(ids(await lexicalEventSearchD1(db, 'tango or salsa', {}, 10)))).toEqual(new Set([tango, salsa]))
    expect(ids(await lexicalEventSearchD1(db, 'clase -tango', {}, 10))).toEqual([salsa])
    expect(await lexicalEventSearchD1(db, '-tango', {}, 10)).toEqual([])
  })

  it('returns scheduled events only, with the public search payload fields', async () => {
    const venueId = await venue('Bebop Club', { neighborhood: 'Palermo', address: 'Uriarte 1658' })
    await event('Jazz pasado', { status: 'past' })
    const live = await event('Jazz hoy', { venue_id: venueId, categories: ['music'], price: 5000, facets: { genres: ['jazz'] } })
    const [row] = await lexicalEventSearchD1(db, 'jazz', {}, 10)
    expect(row).toMatchObject({
      id: live, name: 'Jazz hoy', categories: ['music'], price: 5000, is_free: false, is_all_day: false, time_tba: false,
      location_hidden: false, location_tba: false, status: 'scheduled', venue_name: 'Bebop Club',
      venue_neighborhood: 'Palermo', venue_address: 'Uriarte 1658', facets: { genres: ['jazz'] },
    })
    expect(typeof (row as unknown as { similarity: number }).similarity).toBe('number')
    expect(row).not.toHaveProperty('embedding')
  })

  it('applies every filter the RPC does', async () => {
    const palermo = await venue('Sala A', { neighborhood: 'Palermo' })
    const boedo = await venue('Sala B', { neighborhood: 'Boedo' })
    const free = await event('Feria libre', { venue_id: palermo, is_free: true, categories: ['market'] })
    const paid = await event('Feria paga', { venue_id: boedo, price: 8000, categories: ['music'], min_age: 18, starts_at: '2026-12-05T22:00:00Z' })
    const unpriced = await event('Feria rock', { venue_id: boedo, categories: ['music'], facets: { genres: ['rock'] }, starts_at: '2026-12-10T22:00:00Z' })
    const search = async (filters: Parameters<typeof lexicalEventSearchD1>[2]) => new Set(ids(await lexicalEventSearchD1(db, 'feria', filters, 10)))

    expect(await search({ isFree: true })).toEqual(new Set([free]))
    expect(await search({ isFree: false })).toEqual(new Set([paid, unpriced]))
    expect(await search({ neighborhoods: ['Boedo'] })).toEqual(new Set([paid, unpriced]))
    expect(await search({ venueIds: [palermo] })).toEqual(new Set([free]))
    expect(await search({ categories: ['market', 'film'] })).toEqual(new Set([free]))
    expect(await search({ maxPrice: 5000 })).toEqual(new Set([free, unpriced]))
    expect(await search({ minAge: 16 })).toEqual(new Set([free, unpriced]))
    expect(await search({ avoidGenres: ['rock'] })).toEqual(new Set([free, paid]))
    expect(await search({ startsAfter: '2026-12-04T00:00:00Z', startsBefore: '2026-12-06T00:00:00-03:00' })).toEqual(new Set([paid]))
  })

  it('handles more listed values than D1 allows binds', async () => {
    const venueId = await venue('Sala')
    const wanted = await event('Ciclo de cine', { venue_id: venueId })
    const venueIds = [...Array.from({ length: 300 }, id), venueId]
    expect(ids(await lexicalEventSearchD1(db, 'cine', { venueIds }, 10))).toEqual([wanted])
  })
})

/**
 * A Vectorize stand-in: `query` returns the nearest vectors that pass the metadata filter, with `approximate` added to
 * each score (Vectorize's scores are approximate), and `getByIds` returns stored values, at most 20 ids per call.
 */
function fakeVectorize(vectors: Array<{ id: string; values: number[]; status: string; starts_at: string }>,
  approximate: (id: string) => number = () => 0) {
  const norm = (values: number[]) => Math.hypot(...values)
  const cosine = (a: number[], b: number[]) => a.reduce((sum, value, index) => sum + value * b[index], 0) / (norm(a) * norm(b))
  const query = vi.fn(async (vector: number[], options?: VectorizeQueryOptions) => {
    const filter = (options?.filter ?? {}) as { status?: string; starts_at?: { $gte?: number; $lte?: number } }
    const matches = vectors
      .filter(item => !filter.status || item.status === filter.status)
      .filter(item => filter.starts_at?.$gte === undefined || Date.parse(item.starts_at) >= filter.starts_at.$gte)
      .filter(item => filter.starts_at?.$lte === undefined || Date.parse(item.starts_at) <= filter.starts_at.$lte)
      .map(item => ({ id: item.id, score: cosine(item.values, vector) + approximate(item.id) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, options?.topK ?? 5)
    return { matches, count: matches.length }
  })
  const getByIds = vi.fn(async (ids: string[]) => {
    if (ids.length > 20) throw new Error('too many ids in payload; max id count is 20')
    return vectors.filter(item => ids.includes(item.id)).map(({ id, values }) => ({ id, values }))
  })
  return { index: { query, getByIds } as unknown as VectorizeIndex, query, getByIds }
}

describe('semanticEventSearchD1', () => {
  it('asks Vectorize for 100 scheduled events in the window, then filters and orders in D1', async () => {
    const boedo = await venue('Sala B', { neighborhood: 'Boedo' })
    const near = await event('Cerca', { starts_at: '2026-12-02T22:00:00Z' })
    const nearPaid = await event('Cerca paga', { starts_at: '2026-12-02T23:00:00Z', price: 9000, venue_id: boedo })
    const far = await event('Lejos', { starts_at: '2026-12-03T22:00:00Z' })
    const unrelated = await event('Nada que ver', { starts_at: '2026-12-02T22:00:00Z' })
    const vectors = [
      { id: near, values: [1, 0.1, 0], status: 'scheduled', starts_at: '2026-12-02T22:00:00Z' },
      { id: nearPaid, values: [1, 0.2, 0], status: 'scheduled', starts_at: '2026-12-02T23:00:00Z' },
      { id: far, values: [1, 0, 0], status: 'scheduled', starts_at: '2026-12-03T22:00:00Z' },
      { id: unrelated, values: [0, 0, 1], status: 'scheduled', starts_at: '2026-12-02T22:00:00Z' },
    ]
    const { index, query } = fakeVectorize(vectors)
    const filters = { startsAfter: '2026-12-02T00:00:00Z', startsBefore: '2026-12-02T23:59:59Z' }

    const rows = await semanticEventSearchD1(db, index, [1, 0, 0], filters, 10)
    expect(ids(rows)).toEqual([near, nearPaid])
    expect(rows[0]).toMatchObject({ name: 'Cerca', categories: [], is_free: false })
    expect((rows[0] as unknown as { similarity: number }).similarity).toBeGreaterThan(0.9)
    expect(query).toHaveBeenCalledWith([1, 0, 0], {
      topK: 100, returnValues: false, returnMetadata: 'none',
      filter: { status: 'scheduled', starts_at: { $gte: Date.parse(filters.startsAfter), $lte: Date.parse(filters.startsBefore) } },
    })

    expect(ids(await semanticEventSearchD1(db, index, [1, 0, 0], { ...filters, neighborhoods: ['Boedo'] }, 10))).toEqual([nearPaid])
    expect(ids(await semanticEventSearchD1(db, index, [1, 0, 0], filters, 1))).toEqual([near])
  })

  it('orders by exact cosine similarity, not by Vectorize\'s approximate score, across getByIds batches of 20', async () => {
    const vectors: Array<{ id: string; values: number[]; status: string; starts_at: string }> = []
    for (let n = 0; n < 45; n++) {
      const eventId = await event(`Evento ${n}`)
      vectors.push({ id: eventId, values: [1, n / 100, 0], status: 'scheduled', starts_at: '2026-12-01T22:00:00Z' })
    }
    // Vectorize's scores rank the vectors backwards; the exact order is by n.
    const { index, getByIds } = fakeVectorize(vectors, id => vectors.findIndex(item => item.id === id) / 10)
    const rows = await semanticEventSearchD1(db, index, [1, 0, 0], {}, 5)
    expect(rows.map(row => row.name)).toEqual(['Evento 0', 'Evento 1', 'Evento 2', 'Evento 3', 'Evento 4'])
    expect((rows[0] as unknown as { similarity: number }).similarity).toBe(1)
    expect(getByIds).toHaveBeenCalledTimes(3)
  })

  it('drops matches at or below the 0.2 threshold and events no longer scheduled in D1', async () => {
    const stale = await event('Ya pasó', { status: 'past' })
    const live = await event('Sigue')
    const { index } = fakeVectorize([
      { id: stale, values: [1, 0], status: 'scheduled', starts_at: '2026-12-01T22:00:00Z' },
      { id: live, values: [0.1, 1], status: 'scheduled', starts_at: '2026-12-01T22:00:00Z' },
    ])
    expect(await semanticEventSearchD1(db, index, [1, 0], {}, 10)).toEqual([])
  })
})

describe('filter-only reads', () => {
  it('apply strict price cap, status, counts, and the furthest date', async () => {
    await event('Gratis', { is_free: true, starts_at: '2026-12-01T22:00:00Z' })
    const priced = await event('Barato', { price: 1000, starts_at: '2026-12-02T22:00:00Z' })
    await event('Sin precio', { starts_at: '2026-12-03T22:00:00Z', facets: { genres: ['rock'] } })
    await event('Pasado', { status: 'past', starts_at: '2027-02-01T22:00:00Z' })
    const last = await event('Último', { starts_at: '2027-01-15T22:00:00Z', facets: { genres: ['rock'] } })

    expect(ids(await searchEventsWithFiltersD1(db, { maxPrice: 5000 }, 50))).toEqual([priced])
    expect(ids(await searchEventsWithFiltersD1(db, {}, 2))).toHaveLength(2)
    expect(await countEventsWithFiltersD1(db, {})).toBe(4)
    expect(await countEventsWithFiltersD1(db, { avoidGenres: ['rock'] })).toBe(2)
    expect(await countEventsWithFiltersD1(db, { status: 'past' })).toBe(1)
    expect(await getFurthestEventDateD1(db)).toBe(at('2027-01-15T22:00:00Z'))
    expect(ids(await searchEventsWithFiltersD1(db, { startsAfter: '2027-01-01T00:00:00Z' }, 50))).toEqual([last])
  })

  it('counts only provably ongoing, recent unknown-end, and local all-day events as happening now', async () => {
    const allDay = await event('Exposición de día completo', { starts_at: '2026-12-01T03:00:00Z', is_all_day: true })
    const running = await event('En curso', { starts_at: '2026-12-01T16:00:00Z', ends_at: '2026-12-01T23:00:00Z' })
    const open = await event('Sin fin', { starts_at: '2026-12-01T20:00:00Z' })
    await event('Todo el día anterior', { starts_at: '2026-11-30T03:00:00Z', is_all_day: true })
    await event('Hora desconocida', { starts_at: '2026-12-01T03:00:00Z', time_tba: true })
    await event('Fin desconocido hace tres horas', { starts_at: '2026-12-01T19:00:00Z' })
    await event('Terminó', { starts_at: '2026-12-01T18:00:00Z', ends_at: '2026-12-01T22:00:00Z' })
    await event('Más tarde', { starts_at: '2026-12-01T23:30:00Z' })
    expect(ids(await getEventsHappeningNowD1(db, new Date('2026-12-01T22:00:00Z')))).toEqual([allDay, running, open])
  })

  it('finds venues by part of their name, with % and _ as plain characters', async () => {
    const bebop = await venue('Bebop Club')
    await venue('Club 100 Sur')
    expect(ids(await searchVenuesByNameD1(db, 'BEBOP'))).toEqual([bebop])
    expect(await searchVenuesByNameD1(db, 'Club 10_')).toEqual([])
    expect(await searchVenuesByNameD1(db, '%')).toEqual([])
  })

  it('folds the case of accented letters, like ilike, and keeps accents distinct', async () => {
    const gomez = await venue('CASA GÓMEZ', { neighborhood: 'Palermo' })
    const nunez = await venue('Teatro de Núñez')
    expect(await searchVenuesByNameD1(db, 'casa gómez')).toEqual([expect.objectContaining({ id: gomez, name: 'CASA GÓMEZ', neighborhood: 'Palermo' })])
    expect(ids(await searchVenuesByNameD1(db, 'ÑUÑEZ'))).toEqual([])
    expect(ids(await searchVenuesByNameD1(db, 'NÚÑEZ'))).toEqual([nunez])
    // ilike doesn't fold accents either: production finds nothing for "casa gomez".
    expect(await searchVenuesByNameD1(db, 'casa gomez')).toEqual([])
  })

  it('returns at most 20 venues, ordered by name', async () => {
    for (const name of ['sala b', 'Sala a', ...Array.from({ length: 25 }, (_, n) => `Sala z${String(n).padStart(2, '0')}`)]) await venue(name)
    const found = await searchVenuesByNameD1(db, 'SALA')
    expect(found).toHaveLength(20)
    expect(found.slice(0, 3).map(row => row.name)).toEqual(['Sala a', 'sala b', 'Sala z00'])
  })

  it('lets search_events keep an accented venue as a hard constraint on D1', async () => {
    const gomez = await venue('CASA GÓMEZ')
    const other = await venue('Otro lugar')
    const there = await event('Noche de boleros', { venue_id: gomez, starts_at: '2099-01-10T23:00:00Z' })
    await event('Noche de boleros en otro lado', { venue_id: other, starts_at: '2099-01-10T23:00:00Z' })
    useCloudflareBindings({ DB: db })
    try {
      const result = await searchEventsTool.execute({ venueName: 'casa gómez', timeFilter: 'future' },
        { userContext: { userId: null, isAuthenticated: false }, locale: 'es' })
      expect(result.success).toBe(true)
      expect(result.formatted).not.toContain('unknown venue')
      expect(ids(result.events ?? [])).toEqual([there])
    } finally {
      useCloudflareBindings({})
    }
  })
})

describe('the backend seam', () => {
  it('requires DB and requires Vectorize for semantic search', async () => {
    useCloudflareBindings({})
    expect(cloudflareSearchBackend).toThrow('Missing DB binding')

    const live = await event('Peña folklórica', { search_document: 'Peña folklórica con empanadas' })
    const { index } = fakeVectorize([{ id: live, values: [1, 0], status: 'scheduled', starts_at: '2026-12-01T22:00:00Z' }])
    useCloudflareBindings({ DB: db, VECTORIZE: index })
    expect(ids(await lexicalEventSearch('empanadas', {}))).toEqual([live])
    expect(ids(await semanticEventSearch('folk', {}, 10, undefined, { embedQuery: async () => [1, 0] }))).toEqual([live])

    useCloudflareBindings({ DB: db })
    await expect(semanticEventSearch('folk', {}, 10, undefined, { embedQuery: async () => [1, 0] })).rejects.toThrow('VECTORIZE')
    useCloudflareBindings({})
  })
})

describe('venue similarity on D1', () => {
  it('find_similar_venue: the best match at or above the threshold, oldest first on a tie', async () => {
    await venue('Bebop Club', { created_at: at('2026-02-01T00:00:00Z') })
    const older = await venue('BEBOP CLUB', { created_at: at('2026-01-01T00:00:00Z') })
    await venue('Teatro Distinto')
    expect(await findSimilarVenueD1(db, 'bebop club')).toEqual({ id: older, name: 'BEBOP CLUB', similarity: 1 })
    // "Bebop" against "Bebop Club" is 0.545454... in production, below the importers' 0.6.
    expect(await findSimilarVenueD1(db, 'Bebop')).toBeNull()
    expect((await findSimilarVenueD1(db, 'Bebop', 0.5))?.similarity).toBe(Math.fround(0.545454561710358))
    expect(mostSimilarVenue([], 'x')).toBeNull()
  })

  it('intake_similar_venues: same-name aliases, bands, no truncation, unrelated names', async () => {
    const sala = await venue('Sala Sintética', { address: 'Av. Ficticia 1234', neighborhood: 'Almagro' })
    await venue('SALA SINTÉTICA')
    expect((await intakeSimilarVenuesD1(db, 'sala sintética')).filter(row => row.similarity === 1)).toHaveLength(2)
    expect((await intakeSimilarVenuesD1(db, 'Sala Sintetica'))[0]).toMatchObject({ id: sala, address: 'Av. Ficticia 1234', neighborhood: 'Almagro' })
    expect(Math.max(...(await intakeSimilarVenuesD1(db, 'Sala Sintética Bar Cultural', 0.3)).map(row => row.similarity))).toBeLessThan(0.85)
    for (let n = 1; n <= 7; n++) await venue(`Sala Sintética ${n}`)
    expect((await intakeSimilarVenuesD1(db, 'Sala Sintética')).length).toBeGreaterThanOrEqual(9)
    expect(await intakeSimilarVenuesD1(db, 'Teatro Distinto')).toEqual([])
  })
})


it('does not follow an aborted Vectorize result with a SQL read', async () => {
  const controller = new AbortController()
  const prepare = vi.fn()
  const index = { query: async () => {
    controller.abort('canceled')
    return { matches: [{ id: 'synthetic' }] }
  } }
  await expect(semanticEventSearchD1({ prepare } as never, index as never, [1], {}, 5, controller.signal)).rejects.toBe('canceled')
  expect(prepare).not.toHaveBeenCalled()
})
