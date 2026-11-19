import assert from 'node:assert/strict'
import fc from 'fast-check'
import { canonicalizeSearchIntent, applyPreferAvoid } from '../../src/features/chat/api/tools/search-intent.ts'
import { searchEventsWithFilters, countEventsWithFilters, lexicalEventSearch, semanticEventSearch } from '../../src/shared/lib/db/client.server.ts'
import { useCloudflareBindings } from '../../src/shared/lib/db/search-bindings.server.ts'
import { freshD1 } from '../support/d1.ts'

const { db, dispose } = await freshD1()
const rows = [
  { id: 'free', isFree: true, genre: 'jazz', price: 0, age: 0, neighborhood: 'Palermo', category: 'music' },
  { id: 'paid', isFree: false, genre: 'techno', price: 10, age: 18, neighborhood: 'Recoleta', category: 'arts' },
  { id: 'other', isFree: false, genre: 'house', price: 0, age: 0, neighborhood: 'Palermo', category: 'food' },
]
const vectors = {
  query: async () => ({ matches: rows.map(({ id }) => ({ id })) }),
  getByIds: async (ids: string[]) => ids.map(id => ({ id, values: [1] })),
}
useCloudflareBindings({ DB: db, VECTORIZE: vectors })
try {
  await db.batch(rows.flatMap((row, i) => [
    db.prepare('INSERT INTO venues (id, name, neighborhood) VALUES (?, ?, ?)').bind(`venue-${row.id}`, 'Synthetic venue', row.neighborhood),
    db.prepare(`INSERT INTO events (id, name, starts_at, source, status, venue_id, is_free, price, min_age, categories, facets, scope)
      VALUES (?, 'Synthetic', ?, 'fixture', 'scheduled', ?, ?, ?, ?, ?, ?, 'in')`)
      .bind(row.id, `2026-11-01T0${i}:00:00.000Z`, `venue-${row.id}`, +row.isFree, row.price, row.age,
        JSON.stringify([row.category]), JSON.stringify({ genres: [row.genre] })),
  ]))
  const searchInput = fc.record({
    isFree: fc.option(fc.boolean(), { nil: undefined }),
    maxPrice: fc.integer({ min: 0, max: 100000 }), minAge: fc.integer({ min: 0, max: 99 }),
    neighborhoods: fc.subarray(['Palermo', 'Recoleta', 'Belgrano'], { minLength: 1 }),
    categories: fc.subarray(['music', 'arts', 'food'], { minLength: 1 }),
    avoid: fc.subarray(['techno', 'house', 'electronic'], { minLength: 1 }),
  })
  const zeroCase = { maxPrice: 0, minAge: 0, neighborhoods: ['Palermo'], categories: ['music'], avoid: ['techno'] }
  await fc.assert(fc.asyncProperty(searchInput, async (input) => {
    const { isFree, maxPrice, minAge, neighborhoods, categories, avoid } = input
    const intent = await canonicalizeSearchIntent({ ...input, objective: 'search' }, new Date(2026, 9, 31, 12))
    const filters = applyPreferAvoid(intent)
    const withoutAvoid = rows.filter(row => (isFree === undefined || row.isFree === isFree) && row.price <= maxPrice && row.age <= minAge
      && neighborhoods.includes(row.neighborhood) && categories.includes(row.category))
    const expected = withoutAvoid.filter(row => !avoid.includes(row.genre)).map(row => row.id).sort()
    const ids = (results: { id: string }[]) => results.map(row => row.id).sort()
    assert.deepEqual(ids(await searchEventsWithFilters(filters, 50)), expected)
    assert.equal(await countEventsWithFilters(filters), expected.length)
    assert.equal(await countEventsWithFilters({ ...filters, avoidGenres: undefined }), withoutAvoid.length)
    assert.deepEqual(ids(await lexicalEventSearch('synthetic', filters, 50)), expected)
    assert.deepEqual(ids(await semanticEventSearch('synthetic', filters, 50, undefined, { embedQuery: async () => [1] })), expected)
  }), { examples: [[{ ...zeroCase, isFree: false }], [{ ...zeroCase, isFree: true }], [{ ...zeroCase, isFree: undefined }]], numRuns: 120, seed: Number(process.env.FC_SEED ?? 20261031) })
  console.log('120 generated searches passed filter-only, both counts, lexical and semantic D1 checks')
} finally { await dispose() }
