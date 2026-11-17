/**
 * The three importers on Miniflare D1, run by importers-d1.test.ts in one child `bun` process so these module mocks stay
 * out of the other suites. One process and one Miniflare for all three sources keeps the suite's CPU load low. Real transformers, settlement, duplicate detection, and catalog store; synthetic catalogs and
 * no network: scrapers, AI calls, Nominatim, and delays are mocked.
 */
import assert from 'node:assert/strict'
// @ts-expect-error Bun-only fixture; application type checking has no Bun test declarations.
import { mock } from 'bun:test'
import { Effect } from 'effect'
import { freshD1 } from '../../../../tests/support/d1.ts'
import { fakeVectorize } from '../../../../tests/support/vectorize.ts'

// The exit code is the result (tests/support/run-fixture.ts): anything short of the last assertion fails.
process.exitCode = 3
const day = (offset: number, hour = 20) => new Date(Date.UTC(2030, 0, 10 + offset, hour + 3)).toISOString()
let embeds = 0
mock.module('#shared/lib/ai/embeddings.ts', () => ({
  CURRENT_EMBEDDING_VERSION: 2,
  generateEmbedding: async () => { throw new Error('not in this fixture') },
  embedEventWithDocument: async (event: { name: string }) => { embeds++; return { embedding: [embeds, 0.5], searchDocument: `doc ${event.name}` } },
}))
mock.module('#features/events/lib/description-presentation.server.ts', () => ({
  buildDescriptionPresentationFields: async () => ({ description_display_es: 'Texto.', description_display_en: 'Text.', description_summary_es: null, description_summary_en: null }),
}))
mock.module('#features/import/scrapers/ai-categorizer.ts', () => ({
  categorizeEventsBatchWithStats: async (events: unknown[]) => ({ categories: events.map(() => 'music'), stats: { successful: events.length, fallback: 0 } }),
}))
mock.module('#features/import/core/nominatim.ts', () => ({
  delayEffect: () => Effect.void,
  isAddressLikeVenueName: () => false,
  lookupBusinessAtAddressEffect: () => Effect.succeed({ name: null, neighborhood: null, fullAddress: null }),
  lookupNeighborhoodTieredEffect: (input: { neighborhood?: string | null }) => Effect.succeed({ neighborhood: input.neighborhood ?? null, method: 'direct' }),
}))

// Synthetic catalogs: a public venue, a hidden-location event, a barrio-named venue with and without an address, a
// blocklisted event. Each source maps them to its own shape.
const luma = (hiddenNow: boolean) => [
  { api_id: 'evt-public', url: 'https://luma.com/public', name: 'Noche Sintética', description: 'Jazz.', start_at: day(0), end_at: null, timezone: 'America/Argentina/Buenos_Aires',
    venue: { name: 'Sala Sintética', address: 'Calle Norte 100', city: 'Palermo', latitude: null, longitude: null, full_address: 'Calle Norte 100, CABA' }, location_hidden: false,
    cover_url: null, is_free: true, price: null, host: null, guest_count: 1 },
  { api_id: 'evt-hidden', url: 'https://luma.com/hidden', name: 'Cena Privada Sintética', description: 'Cena.', start_at: day(1), end_at: null, timezone: 'America/Argentina/Buenos_Aires',
    venue: hiddenNow ? null : { name: 'Sala Sintética', address: 'Calle Norte 100', city: 'Palermo', latitude: null, longitude: null, full_address: 'Calle Norte 100, CABA' },
    location_hidden: hiddenNow, cover_url: null, is_free: true, price: null, host: null, guest_count: 1 },
  { api_id: 'evt-barrio', url: 'https://luma.com/barrio', name: 'Feria Sintética', description: 'Feria.', start_at: day(2), end_at: null, timezone: 'America/Argentina/Buenos_Aires',
    venue: { name: 'San Telmo', address: null, city: 'San Telmo', latitude: null, longitude: null, full_address: null }, location_hidden: false,
    cover_url: null, is_free: true, price: null, host: null, guest_count: 1 },
  { api_id: 'evt-blocked', url: 'https://luma.com/blocked', name: 'Gran PROMO Sintética', description: 'x', start_at: day(3), end_at: null, timezone: 'America/Argentina/Buenos_Aires',
    venue: null, location_hidden: null, cover_url: null, is_free: true, price: null, host: null, guest_count: 1 },
]
const meetupEvent = (id: string, name: string, offset: number, venue: { name: string; address: string | null } | null) => ({
  id, name, description: 'Meetup sintético.', dateTime: day(offset), endTime: null, timezone: 'America/Argentina/Buenos_Aires',
  eventUrl: `https://www.meetup.com/synthetic/events/${id}/`, imageUrl: null, isOnline: false, status: 'scheduled',
  venue: venue && { ...venue, city: 'Buenos Aires', lat: null, lng: null }, group: { name: 'Synthetic', urlname: 'synthetic', rating: null },
  attendeeCount: 1, category: null, isRecurring: false, recurrencePattern: null, price: null, currency: null,
})
const meetup = (hiddenNow: boolean) => [
  meetupEvent('101', 'Noche Sintética', 0, { name: 'Sala Sintética', address: 'Calle Norte 100' }),
  meetupEvent('102', 'Cena Privada Sintética', 1, hiddenNow ? { name: 'Register to See Address', address: null } : { name: 'Sala Sintética', address: 'Calle Norte 100' }),
  meetupEvent('103', 'Feria Sintética', 2, { name: 'San Telmo', address: null }),
  meetupEvent('104', 'Gran PROMO Sintética', 3, null),
]
const tourismEvent = (name: string, whenText: string, venueName: string, address: string | null, neighborhood = 'Palermo') => ({
  name, category: 'Música', isFree: true, whenText, venueName, neighborhood, address, coordinates: null, description: 'Turismo sintético.',
  moreInfoUrl: `https://turismo.buenosaires.gob.ar/es/${encodeURIComponent(name)}`,
})
const tourism = (hiddenNow: boolean) => [
  tourismEvent('Noche Sintética', 'Lunes 10, 20:30 h.', 'Sala Sintética', 'Calle Norte 100'),
  tourismEvent('Cena Privada Sintética', 'Martes 11, 20:30 h.', hiddenNow ? 'TBA' : 'Sala Sintética', hiddenNow ? null : 'Calle Norte 100'),
  tourismEvent('Feria Sintética', 'Miércoles 12, 20:30 h.', 'San Telmo', null, 'San Telmo'),
  tourismEvent('Gran PROMO Sintética', 'Jueves 13, 20:30 h.', 'Sala Sintética', 'Calle Norte 100'),
]

let hiddenNow = false
mock.module('#features/import/scrapers/luma/api.ts', () => ({ fetchLumaEvents: async () => luma(hiddenNow) }))
mock.module('#features/import/scrapers/meetup/browser-scraper.ts', () => ({
  scrapeMeetupCatalog: async () => ({ events: meetup(hiddenNow), observedAt: null }),
  filterInPersonEvents: <T extends { isOnline: boolean }>(events: T[]) => events.filter(event => !event.isOnline),
  filterByDateRange: <T>(events: T[]) => events,
}))
mock.module('#features/import/scrapers/meetup/detail.ts', () => ({ enrichMeetupEventsWithDetails: async () => {} }))
mock.module('#features/import/scrapers/ba-tourism/browser-scraper.ts', () => ({
  scrapeBATourismEventsWithBrowser: async () => ({ events: tourism(hiddenNow), weekContext: { startDate: new Date(2030, 0, 10), endDate: new Date(2030, 0, 16) } }),
}))

const { d1Catalog } = await import('./catalog-store-d1.ts')
const coordinators = {
  luma: async (catalog: never) => Effect.runPromise((await import('./luma.ts')).processLumaImportEffect(catalog, { scrapeRunId: null })),
  meetup: async (catalog: never) => Effect.runPromise((await import('./meetup.ts')).processMeetupImportEffect(catalog, { startDate: '2030-01-01', endDate: '2030-02-01', expandRecurringWeeks: 0, openBrowser: () => Promise.reject(new Error('mocked')) })),
  'ba-tourism': async (catalog: never) => Effect.runPromise((await import('./ba-tourism.ts')).processBATourismImportEffect(catalog, { referenceDate: new Date(2030, 0, 10), openBrowser: () => Promise.reject(new Error('mocked')) })),
}
const { db, dispose } = await freshD1()
const passed: string[] = []
try {
for (const [source, run] of Object.entries(coordinators)) {
  hiddenNow = false
  await db.batch(['venue_review_queue', 'events', 'venues', 'import_blocklist'].map(table => db.prepare(`DELETE FROM ${table}`)))
  const { index, vectors } = fakeVectorize()
  await db.prepare("INSERT INTO import_blocklist (id, pattern, target_field, source) VALUES ('b', 'promo', 'event_name', 'all')").run()
  const events = () => db.prepare('SELECT e.id, e.name, e.venue_id, e.location_hidden, e.location_tba, e.enrichment_status, e.search_document, e.embedding_version, e.categories, e.status, v.name AS venue_name FROM events e LEFT JOIN venues v ON v.id = e.venue_id ORDER BY e.starts_at').all<Record<string, unknown>>().then(r => r.results)

  const first = await run(d1Catalog(db, index) as never) as { eventsInserted: number; eventsSkipped: number; venuesAutoCreated: number }
  let rows = await events()
  assert.equal(first.eventsSkipped, 0, 'nothing skipped')
  assert.deepEqual(rows.map(row => row.name), ['Noche Sintética', 'Cena Privada Sintética', 'Feria Sintética'], 'the blocklisted event is filtered out')
  assert.equal(first.eventsInserted, 3)
  const [publicEvent, hiddenEvent, barrioEvent] = rows
  assert.equal(publicEvent.venue_name, 'Sala Sintética')
  assert.equal(hiddenEvent.venue_id, publicEvent.venue_id, 'same name and address share one venue')
  assert.equal(barrioEvent.venue_id, null, 'a barrio name without its own street address gets no venue (PR #48)')
  assert.equal(await db.prepare('SELECT count(*) AS n FROM venues').first('n'), 1)
  for (const row of rows) {
    assert.equal(row.enrichment_status, 'pending')
    assert.equal(row.embedding_version, 2)
    assert.equal(row.categories, '["music"]')
    const vector = vectors.get(row.id as string)
    assert(vector, `vector for ${row.name}`)
    assert.deepEqual(vector.metadata, { status: 'scheduled', starts_at: Date.parse((await db.prepare('SELECT starts_at FROM events WHERE id = ?').bind(row.id).first<string>('starts_at'))!) })
  }

  // Second run: the same catalog changes nothing; then the host hides the second event's address.
  const embedsBefore = embeds
  const second = await run(d1Catalog(db, index) as never) as { eventsInserted: number; eventsUpdated: number }
  assert.equal(second.eventsInserted, 0)
  assert.equal(second.eventsUpdated, 0)
  assert.equal(embeds, embedsBefore, 'an unchanged event is not re-embedded')

  hiddenNow = true
  await run(d1Catalog(db, index) as never)
  rows = await events()
  assert.equal(rows.length, 3, 'still one row per event')
  const hidden = rows[1]
  if (source === 'luma') {
    // Luma says the address is shared after registration: hidden, and the venue goes (PR #48).
    assert.equal(hidden.location_hidden, 1)
    assert.equal(hidden.venue_id, null)
  } else {
    // Meetup and BA Tourism show a placeholder: the event keeps its venue (an empty scrape never clears one) and is TBA.
    assert.equal(hidden.location_tba, 1)
    assert.equal(hidden.venue_id, publicEvent.venue_id)
  }
  assert.equal(await db.prepare('SELECT count(*) AS n FROM venues').first('n'), 1, 'a placeholder never becomes a venue')
  passed.push(source)
}
  assert.deepEqual(passed, ['luma', 'meetup', 'ba-tourism'])
  console.log(JSON.stringify({ passed }))
  process.exitCode = 0
} finally {
  await dispose()
}
