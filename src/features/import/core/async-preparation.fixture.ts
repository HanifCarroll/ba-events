import assert from 'node:assert/strict'
// @ts-expect-error Bun-only fixture; application type checking has no Bun test declarations.
import { mock } from 'bun:test'
import { Effect } from 'effect'
import type { EventInsert } from '#shared/lib/types.ts'

// Isolated SDK doubles keep Bun's module mocks out of other deterministic suites.
const source = process.argv[2]
const event = { id: 'synthetic', api_id: 'synthetic', name: 'Synthetic Jazz', url: 'https://example.com/event', dateTime: '2026-12-01T20:00:00-03:00' }
const transformed: EventInsert = {
  name: event.name, external_id: 'synthetic', starts_at: event.dateTime,
  source, categories: ['music'], description_es: 'Jazz en vivo.', description_en: 'Live jazz.',
}
let mode = 'new'
let release: () => void
let gate: Promise<void>
let started: string[] = []
let writes: Record<string, unknown>[] = []
const presentation = { description_display_es: 'Jazz en vivo.', description_display_en: 'Live jazz.', description_summary_es: null, description_summary_en: null }
mock.module('#shared/lib/ai/embeddings.ts', () => ({
  CURRENT_EMBEDDING_VERSION: 2,
  embedEventWithDocument: async () => {
    started.push('embedding')
    if (mode === 'embedding-failure') throw new Error('Synthetic embedding outage')
    await gate
    return { embedding: [0.1], searchDocument: 'Synthetic Jazz' }
  },
}))
mock.module('#features/events/lib/description-presentation.server.ts', () => ({
  buildDescriptionPresentationFields: async () => {
    started.push('presentation')
    if (mode === 'presentation-failure') throw new Error('Synthetic presentation outage')
    await gate
    return presentation
  },
}))
mock.module('#shared/lib/db/blocklist.ts', () => ({ getBlocklistEntries: async () => [] }))
mock.module('#features/import/scrapers/ai-categorizer.ts', () => ({
  categorizeEventsBatchWithStats: async () => ({ categories: ['music'], stats: { successful: 1, fallback: 0 } }),
}))
mock.module('#features/import/api/duplicate-detection.ts', () => ({
  checkDuplicateEventsWithDataEffect: () => Effect.succeed(mode === 'changed' || mode === 'stale' || mode === 'unchanged' || mode === 'mutable'
    ? new Map([['synthetic', { ...transformed, id: 'existing' }]]) : new Map()),
}))
mock.module('#features/import/core/scraper-update.ts', () => ({
  classifyScraperUpdate: () => mode === 'unchanged' ? 'unchanged' : mode === 'mutable' ? 'mutable-only' : 'search-input/stale-embedding',
  sourceDescriptionsChanged: () => mode === 'changed',
  getChangedMutableFields: () => ({ status: 'scheduled' }),
}))
mock.module('#features/import/core/venue-settlement.ts', () => ({
  settleVenuesEffect: () => Effect.succeed({ results: new Map(), stats: { matched: 0, autoCreated: 0, queuedReview: 0 } }),
  getVenueIdFromResults: () => null, isPlaceholderResult: () => false, getVenueNeighborhoodFromResults: () => null,
}))
mock.module('#features/import/core/nominatim.ts', () => ({ delayEffect: () => Effect.void }))
const identity = <T>(events: T) => events
const transformer = { getAllVenueInfo: () => new Map(), getUniqueVenueNames: () => [], getVenueName: () => null }
for (const [name, transform] of [['luma', 'transformLumaEvent'], ['eventbrite', 'transformEventbriteEvent'], ['venti', 'transformVentiEvent']]) {
  mock.module(`#features/import/scrapers/${name}/transformer.ts`, () => ({ ...transformer, [transform]: () => ({ ...transformed }) }))
}
mock.module('#features/import/scrapers/meetup/transformer.ts', () => ({ ...transformer, transformMeetupEventWithExpansion: () => [{ ...transformed }] }))
mock.module('#features/import/scrapers/ba-tourism/transformer.ts', () => ({ ...transformer, transformBATourismEvent: () => [{ ...transformed }] }))
mock.module('#features/import/scrapers/luma/api.ts', () => ({ fetchLumaEvents: async () => [event] }))
mock.module('#features/import/scrapers/eventbrite/api.ts', () => ({ fetchEventbriteEvents: async () => [event], filterInPersonEvents: identity, filterByDateRange: identity, extractEventId: () => 'synthetic' }))
mock.module('#features/import/scrapers/eventbrite/detail.ts', () => ({ fetchEventbriteDetailsBatch: async () => new Map() }))
mock.module('#features/import/scrapers/venti/api.ts', () => ({ fetchVentiEvents: async () => [event], filterCABAEvents: identity, fetchVentiAvailabilityBatch: async () => new Map() }))
mock.module('#features/import/scrapers/meetup/browser-scraper.ts', () => ({ scrapeMeetupCatalog: async () => ({ events: [event], observedAt: null }), filterInPersonEvents: identity, filterByDateRange: identity }))
mock.module('#features/import/scrapers/meetup/detail.ts', () => ({ enrichMeetupEventsWithDetails: async () => {} }))
mock.module('#features/import/core/geo-validation.ts', () => ({ filterEventsByLocation: identity }))
mock.module('#features/import/scrapers/ba-tourism/browser-scraper.ts', () => ({ scrapeBATourismEventsWithBrowser: async () => ({ events: [event], weekContext: {} }) }))

const client = { from: () => ({
  insert: async (data: Record<string, unknown>) => { writes.push(data); return { error: null } },
  update: (data: Record<string, unknown>) => ({ eq: async () => { writes.push(data); return { error: null } } }),
}) }
const coordinators = {
  luma: (await import('./luma.ts')).processLumaImportEffect,
  eventbrite: (await import('./eventbrite.ts')).processEventbriteImportEffect,
  meetup: (await import('./meetup.ts')).processMeetupImportEffect,
  venti: (await import('./venti.ts')).processVentiImportEffect,
  'ba-tourism': (await import('./ba-tourism.ts')).processBATourismImportEffect,
}
const coordinator = coordinators[source as keyof typeof coordinators]
assert(coordinator, 'Unknown source')
for (mode of ['new', 'changed', 'stale', 'unchanged', 'mutable', 'embedding-failure', 'presentation-failure']) {
  started = []; writes = []
  gate = new Promise<void>(resolve => { release = resolve })
  let settled = false
  const running = Effect.runPromise(coordinator(client as never)).then(result => { settled = true; return result })
  try {
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.deepEqual(started.sort(), ['unchanged', 'mutable'].includes(mode) ? [] : mode === 'stale' ? ['embedding'] : ['embedding', 'presentation'])
    if (started.length) {
      assert.equal(writes.length, 0, 'Do not write before both preparations finish')
      assert.equal(settled, false, 'Drain provider calls even when a sibling fails')
    }
  } finally {
    release!()
  }
  const result = await running
  if (mode.endsWith('failure')) {
    assert.equal(result.eventsSkipped, 1); assert.equal(writes.length, 0)
  } else if (mode === 'unchanged') {
    assert.equal(writes.length, 0)
  } else {
    assert.equal(writes.length, 1)
    if (started.length) {
      assert.deepEqual(writes[0].embedding, [0.1]); assert.equal(writes[0].search_document, 'Synthetic Jazz')
      if (mode !== 'stale') assert.equal(writes[0].description_display_es, presentation.description_display_es)
    }
  }
}
console.log(JSON.stringify({ source, passed: true }))
