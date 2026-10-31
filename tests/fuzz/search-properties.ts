import assert from 'node:assert/strict'
import fc from 'fast-check'
import { createClient } from '@supabase/supabase-js'
import { canonicalizeSearchIntent, applyPreferAvoid } from '../../src/features/chat/api/tools/search-intent.ts'
import { searchEventsWithFilters, countEventsWithFilters, lexicalEventSearch, semanticEventSearch } from '../../src/shared/lib/db/client.server.ts'

// Exercise the actual PostgREST serializer against a synthetic transport. This
// proves filter propagation; production PostgreSQL query plans/RLS are separate.
const observed: URL[] = []
const observedRpc: Array<{ path: string; input: Record<string, unknown> }> = []
const rows = [{ id: 'free', is_free: true, facets: { genres: ['jazz'] } }, { id: 'paid', is_free: false, facets: { genres: ['jazz'] } }]
const database = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
  const url = new URL(request.url)
  if (url.pathname.startsWith('/rest/v1/rpc/')) {
    const input = await request.json() as Record<string, unknown>
    observedRpc.push({ path: url.pathname, input })
    return Response.json(input.filter_is_free === null ? rows : rows.filter(row => row.is_free === input.filter_is_free))
  }
  assert.equal(url.pathname, '/rest/v1/events_with_venues')
  observed.push(url)
  const filtered = url.searchParams.has('is_free') ? rows.filter(row => `eq.${row.is_free}` === url.searchParams.get('is_free')) : rows
  return new Response(request.method === 'HEAD' ? null : JSON.stringify(filtered), { headers: {
    'content-type': 'application/json', 'content-range': `0-${Math.max(0, filtered.length - 1)}/${filtered.length}`,
  } })
} })
process.env.SUPABASE_URL = `http://127.0.0.1:${database.port}`
process.env.SUPABASE_ANON_KEY = 'synthetic-key'
const client = createClient(process.env.SUPABASE_URL, 'synthetic-key', { auth: { persistSession: false, autoRefreshToken: false } })
try {
  const searchInput = fc.record({
    isFree: fc.option(fc.boolean(), { nil: undefined }),
    maxPrice: fc.integer({ min: 0, max: 100000 }), minAge: fc.integer({ min: 0, max: 99 }),
    neighborhoods: fc.subarray(['Palermo', 'Recoleta', 'Belgrano'], { minLength: 1 }),
    categories: fc.subarray(['music', 'art', 'food'], { minLength: 1 }),
    avoid: fc.subarray(['techno', 'house', 'electronic'], { minLength: 1 }),
  })
  const zeroCase = { maxPrice: 0, minAge: 0, neighborhoods: ['Palermo'], categories: ['music'], avoid: ['techno'] }
  await fc.assert(fc.asyncProperty(searchInput, async (input) => {
    const { isFree, maxPrice, minAge, neighborhoods, categories, avoid } = input
    const intent = await canonicalizeSearchIntent({ ...input, objective: 'search' }, new Date(2026, 9, 31, 12))
    const filters = applyPreferAvoid(intent)
    const expected = isFree === undefined ? ['free', 'paid'] : isFree ? ['free'] : ['paid']
    observed.length = 0
    observedRpc.length = 0
    const actual = await searchEventsWithFilters(filters, 50)
    assert.deepEqual(actual.map(row => row.id), expected)
    assert.equal(await countEventsWithFilters(filters), expected.length)
    assert.equal(await countEventsWithFilters({ ...filters, avoidGenres: undefined }), expected.length)
    assert.equal(observed.length, 3)
    for (const url of observed) {
      assert.equal(url.searchParams.get('is_free'), isFree === undefined ? null : `eq.${isFree}`)
      assert.equal(url.searchParams.get('price'), `lte.${maxPrice}`)
      assert.equal(url.searchParams.get('or'), `(min_age.is.null,min_age.lte.${minAge})`)
      assert.equal(url.searchParams.get('venue_neighborhood'), `in.(${neighborhoods.join(',')})`)
      assert.equal(url.searchParams.get('categories'), `ov.{${categories.join(',')}}`)
    }
    assert.deepEqual((await lexicalEventSearch('synthetic', filters, 50, undefined, { client })).map(row => row.id), expected)
    assert.deepEqual((await semanticEventSearch('synthetic', filters, 50, undefined, { client, embedQuery: async () => [0.1] })).map(row => row.id), expected)
    assert.deepEqual(observedRpc.map(call => call.path), ['/rest/v1/rpc/lexical_match_events_with_venues', '/rest/v1/rpc/match_events_with_venues_filtered'])
    for (const { input: body } of observedRpc) {
      assert.equal(body.filter_is_free, isFree ?? null)
      assert.equal(body.filter_max_price, maxPrice)
      assert.equal(body.filter_min_age, minAge)
      assert.deepEqual(body.filter_neighborhoods, neighborhoods)
      assert.deepEqual(body.filter_categories, categories)
      assert.deepEqual(body.filter_avoid_genres, avoid)
      assert.equal(body.match_count, 50)
    }
  }), { examples: [[{ ...zeroCase, isFree: false }], [{ ...zeroCase, isFree: true }], [{ ...zeroCase, isFree: undefined }]], numRuns: 120, seed: Number(process.env.FC_SEED ?? 20261031) })
  console.log('120 generated searches passed filter-only, both counts, lexical and semantic transport checks')
} finally { database.stop(true) }
