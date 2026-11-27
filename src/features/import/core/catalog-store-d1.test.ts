import type { D1Database } from '@cloudflare/workers-types'
import { Effect } from 'effect'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { CURRENT_EMBEDDING_VERSION } from '#shared/lib/ai/embeddings.ts'
import { planVectorWrite, reconcileCatalog } from '#shared/lib/db/vector-sync.ts'
import { freshD1, withTestIntakeContext } from '../../../../tests/support/d1.ts'
import { fakeVectorize } from '../../../../tests/support/vectorize.ts'
import { closeScrapeRun, openScrapeRun } from '../../../jobs-worker/daily-scrape.ts'
import { reconcileStaleScrapeRuns, recordEnrichmentAudit } from '../../../jobs-worker/daily-scrape-outcome.ts'
import { matchVenueEffect } from '../scrapers/venue-matcher.ts'
import { d1Catalog } from './catalog-store-d1.ts'
import { catalogStoreFor } from './catalog-store-for.ts'
import { countEventsNeedingEnrichment, getEventsNeedingEnrichment, RETIRED_SOURCES } from './event-enrichment.ts'
import { approveVenueReview } from './venue-review.ts'
import { settleVenue, settleVenues, getVenueIdFromResults } from './venue-settlement.ts'

let db: D1Database
let dispose: () => Promise<void>
beforeAll(async () => { ({ db, dispose } = await freshD1()) }, 60_000)
afterAll(async () => { await dispose() })

const TABLES = ['vector_sync', 'venue_review_queue', 'event_intake_protection', 'intake_plans', 'intake_candidates', 'events', 'venues', 'scrape_runs', 'import_blocklist']
beforeEach(async () => { await db.batch(TABLES.map((table) => db.prepare(`DELETE FROM ${table}`))) })

const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString()
type Insert = Parameters<ReturnType<typeof d1Catalog>['insertEvent']>[0]
const event = (overrides: Partial<Insert> = {}): Insert & { external_id: string } => ({
	name: 'Jazz Sintético', starts_at: future(3), source: 'meetup', external_id: `ext-${crypto.randomUUID()}`, link: 'https://example.com/e',
	categories: ['music'], facets: { genres: ['jazz'] } as Insert['facets'], is_free: false, status: 'scheduled', ...overrides,
} as Insert & { external_id: string })
const store = () => { const fake = fakeVectorize(); return { catalog: d1Catalog(db, fake.index), vectors: fake.vectors } }
const eventId = async (externalId: string) => (await db.prepare('SELECT id FROM events WHERE external_id = ?').bind(externalId).first<string>('id'))!

async function protectIntakeName(id: string) {
	await db.batch([
		db.prepare("INSERT INTO intake_candidates (id, revision, payload) VALUES ('c', 1, '{}')"),
		db.prepare("INSERT INTO intake_plans (id, candidate_id, revision, action, event_id, payload, evidence, reasons) VALUES ('p', 'c', 1, 'create', ?, '{}', '[]', '[]')").bind(id),
		db.prepare(`INSERT INTO event_intake_protection (event_id, fields, plan_id, authority, observed_at) VALUES (?, '["name"]', 'p', 2, ?)`).bind(id, new Date().toISOString()),
	])
}

describe('catalogStoreFor', () => {
	it('refuses a missing DB or a missing Vectorize binding', () => {
		expect(() => catalogStoreFor({})).toThrow('Missing DB binding')
		expect(() => catalogStoreFor({ DB: db })).toThrow('VECTORIZE')
		expect(catalogStoreFor({ DB: db, VECTORIZE: fakeVectorize().index })).toBeTruthy()
	})
})

describe('events and their vectors', () => {
	it('inserts an event as D1 stores it and upserts its vector with { status, starts_at }', async () => {
		const { catalog, vectors } = store()
		const input = event({ embedding: [0.1, 0.2], location_tba: true, search_document: 'Jazz' })
		await catalog.insertEvent(input)
		expect(await db.prepare('SELECT count(*) AS n FROM vector_sync').first('n')).toBe(0)
		const id = await eventId(input.external_id)
		const [existing] = await catalog.existingEvents('meetup', [input.external_id])
		expect(existing).toMatchObject({ id, categories: ['music'], facets: { genres: ['jazz'] }, is_free: false, location_tba: true, location_hidden: false, embedding_version: 1 })
		expect(vectors.get(id)).toEqual({ id, values: [0.1, 0.2], metadata: { status: 'scheduled', starts_at: Date.parse(input.starts_at) } })
	})

	it('keeps a hidden event without a venue whatever the import says (PR #48)', async () => {
		const { catalog } = store()
		const venue = await catalog.createVenue({ name: 'Sala Sintética', address: 'Calle Norte 100', neighborhood: 'Palermo', enrichment_status: 'pending', address_check_status: 'not_flagged' })
		const input = event({ venue_id: venue.id, location_hidden: true })
		await catalog.insertEvent(input)
		expect((await catalog.existingEvents('meetup', [input.external_id]))[0]).toMatchObject({ venue_id: null, location_hidden: true })
	})

	it('re-upserts the vector when the embedding changes, and rewrites metadata when only status or start changes', async () => {
		const { catalog, vectors } = store()
		const input = event({ embedding: [0.1], search_document: 'Jazz' })
		await catalog.insertEvent(input)
		const id = await eventId(input.external_id)
		await catalog.updateEvent(id, { embedding: [0.9], search_document: 'Jazz y blues', embedding_version: 2 })
		expect(vectors.get(id)!.values).toEqual([0.9])
		const later = future(5)
		await catalog.updateEvent(id, { status: 'canceled', starts_at: later })
		expect(vectors.get(id)).toEqual({ id, values: [0.9], metadata: { status: 'canceled', starts_at: Date.parse(later) } })
		// A write that touches neither leaves the index alone.
		vectors.delete(id)
		await catalog.updateEvent(id, { enrichment_status: 'completed' })
		expect(vectors.has(id)).toBe(false)
	})

	it('leaves a failed importer upsert queued and repairs it on reconcile', async () => {
		const fake = fakeVectorize()
		const catalog = d1Catalog(db, fake.index)
		const input = event({ embedding: [0.1], search_document: 'Jazz', embedding_version: CURRENT_EMBEDDING_VERSION })
		fake.failUpserts(1)
		await expect(catalog.insertEvent(input)).rejects.toThrow('injected')
		const id = await eventId(input.external_id)
		expect(await db.prepare('SELECT event_id FROM vector_sync').first('event_id')).toBe(id)
		const embedText = vi.fn(async () => [0.2])
		expect(await reconcileCatalog(db, fake.index, { embedText })).toMatchObject({ resynced: 1 })
		expect(embedText).toHaveBeenCalledExactlyOnceWith('Jazz')
		expect(fake.vectors.get(id)).toEqual({ id, values: [0.2], metadata: { status: 'scheduled', starts_at: Date.parse(input.starts_at) } })
		expect(await db.prepare('SELECT count(*) AS n FROM vector_sync').first('n')).toBe(0)
	})

	it('does not clear a newer document queued while an older vector upsert is in flight', async () => {
		const fake = fakeVectorize()
		const catalog = d1Catalog(db, fake.index)
		const input = event({ search_document: 'Before', embedding_version: CURRENT_EMBEDDING_VERSION })
		await catalog.insertEvent(input)
		const id = await eventId(input.external_id)
		const upsert = fake.index.upsert.bind(fake.index)
		vi.spyOn(fake.index, 'upsert').mockImplementationOnce(async items => {
			const newer = planVectorWrite(db, id, { source: 'catalog', patch: { embedding: [0.2], search_document: 'Newest' } })
			if (!newer.queue) throw new Error('Expected a queued write')
			await db.batch([db.prepare('UPDATE events SET search_document = ? WHERE id = ?').bind('Newest', id), newer.queue])
			return upsert(items)
		})
		await catalog.updateEvent(id, { embedding: [0.1], search_document: 'Older' })
		expect(await db.prepare('SELECT event_id FROM vector_sync').first('event_id')).toBe(id)
		const embedText = vi.fn(async () => [0.2])
		expect(await reconcileCatalog(db, fake.index, { embedText })).toMatchObject({ resynced: 1 })
		expect(embedText).toHaveBeenCalledExactlyOnceWith('Newest')
		expect(fake.vectors.get(id)?.values).toEqual([0.2])
		expect(await db.prepare('SELECT event_id FROM vector_sync').first()).toBeNull()
	})

	it('reports a protected-only importer patch as kept, without writing or queuing it', async () => {
		const { catalog, vectors } = store()
		const input = event({ embedding: [0.1], search_document: 'Intake text' })
		await catalog.insertEvent(input)
		const id = await eventId(input.external_id)
		await protectIntakeName(id)
		const before = await db.prepare('SELECT updated_at FROM events WHERE id = ?').bind(id).first('updated_at')
		const result = await catalog.updateEvent(id, { name: 'Scraped name', embedding: [0.9], search_document: 'Scraped text', embedding_version: 2 })
		expect(result.applied).toEqual([])
		expect(result.kept).toEqual(['name', 'search_document', 'embedding_version'])
		expect(await db.prepare('SELECT updated_at FROM events WHERE id = ?').bind(id).first('updated_at')).toBe(before)
		expect(await db.prepare('SELECT name, search_document FROM events WHERE id = ?').bind(id).first()).toEqual({ name: 'Jazz Sintético', search_document: 'Intake text' })
		expect(vectors.get(id)!.values).toEqual([0.1])
		expect(await db.prepare('SELECT event_id FROM vector_sync').first()).toBeNull()
	})

	it('applies a mixed import patch without writing the protected fact or its document', async () => {
		const { catalog, vectors } = store()
		const input = event({ embedding: [0.1], search_document: 'Intake text' })
		await catalog.insertEvent(input)
		const id = await eventId(input.external_id)
		await protectIntakeName(id)
		const starts = future(5)
		const result = await catalog.updateEvent(id, { name: 'Scraped name', starts_at: starts,
			search_document: 'Unaccepted document', embedding: [0.9] })
		expect(result).toMatchObject({ applied: ['starts_at'], kept: ['name', 'search_document'] })
		expect(await db.prepare('SELECT name, starts_at, search_document FROM events WHERE id = ?').bind(id).first())
			.toEqual({ name: input.name, starts_at: starts, search_document: 'Intake text' })
		expect(vectors.get(id)).toMatchObject({ values: [0.1], metadata: { starts_at: Date.parse(starts) } })
	})

	it('preserves a failed nightly rebuild through a protected importer mismatch and repairs it on reconcile', async () => {
		const fake = fakeVectorize()
		const catalog = d1Catalog(db, fake.index)
		const input = event({ embedding: [0.1], search_document: 'Original intake text', embedding_version: CURRENT_EMBEDDING_VERSION - 1 })
		await catalog.insertEvent(input)
		const id = await eventId(input.external_id)
		await protectIntakeName(id)
		const searchDocument = 'Rebuilt intake text'
		const embed = vi.fn(async () => ({ embedding: [0.2], searchDocument }))
		fake.failUpserts(1)
		await expect(reconcileCatalog(db, fake.index, { embed })).rejects.toThrow('injected')
		const readPending = () => db.prepare('SELECT event_id, queued_at FROM vector_sync WHERE event_id = ?').bind(id).first()
		const pending = await readPending()
		expect(pending).toMatchObject({ event_id: id })

		await catalog.updateEvent(id, { name: 'Scraped name', embedding: [0.9], search_document: 'Scraped text', embedding_version: CURRENT_EMBEDDING_VERSION })
		expect(await db.prepare('SELECT name, search_document, embedding_version FROM events WHERE id = ?').bind(id).first()).toEqual({
			name: input.name, search_document: searchDocument, embedding_version: CURRENT_EMBEDDING_VERSION,
		})
		expect(fake.vectors.get(id)?.values).toEqual([0.1])
		expect(await readPending()).toEqual(pending)

		const embedText = vi.fn(async () => [0.2])
		expect(await reconcileCatalog(db, fake.index, { embed, embedText })).toMatchObject({ reembedded: 0, resynced: 1 })
		expect(embedText).toHaveBeenCalledExactlyOnceWith(searchDocument)
		expect(fake.vectors.get(id)?.values).toEqual([0.2])
		expect(await readPending()).toBeNull()
	})

	it('validates, reads, and protects stated event credits and ticket sale times', async () => {
		const { catalog } = store()
		const credits = {
			organizer_name: 'Colectivo Nube', organizer_url: 'https://nube.example/',
			performers: [{ name: 'Trío Sintético', url: 'https://trio.example/' }],
			offers_valid_from: '2026-08-01T20:00:00-03:00', doors_at: '2026-08-03T00:30:00.000Z',
		}
		const input = event({ ...credits, search_document: 'Synthetic source text' })
		await catalog.insertEvent(input)
		const id = await eventId(input.external_id)
		await expect(db.prepare("UPDATE events SET performers = '{}' WHERE id = ?").bind(id).run()).rejects.toThrow('CHECK')
		await expect(db.prepare("UPDATE events SET offers_valid_from = '2026-08-01' WHERE id = ?").bind(id).run()).rejects.toThrow('CHECK')
		await expect(db.prepare("UPDATE events SET doors_at = '23:59' WHERE id = ?").bind(id).run()).rejects.toThrow('CHECK')
		await db.batch([
			db.prepare("UPDATE events SET scope = 'in' WHERE id = ?").bind(id),
			db.prepare("INSERT INTO intake_candidates (id, revision, payload) VALUES ('c', 1, '{}')"),
			db.prepare("INSERT INTO intake_plans (id, candidate_id, revision, action, event_id, payload, evidence, reasons) VALUES ('p', 'c', 1, 'update', ?, '{}', '[]', '[]')").bind(id),
			db.prepare('INSERT INTO event_intake_protection (event_id, fields, plan_id, authority, observed_at) VALUES (?, ?, \'p\', 2, ?)')
				.bind(id, JSON.stringify(Object.keys(credits)), new Date().toISOString()),
		])
		await catalog.updateEvent(id, { organizer_name: 'Unsupported edit', organizer_url: null, performers: [], offers_valid_from: null, doors_at: null })
		expect((await catalog.existingEvents('meetup', [input.external_id]))[0])
			.toMatchObject({ ...credits, offers_valid_from: '2026-08-01T23:00:00.000Z' })
		expect(await db.prepare('SELECT scope, search_document FROM events WHERE id = ?').bind(id).first())
			.toEqual({ scope: 'in', search_document: 'Synthetic source text' })
		await withTestIntakeContext(db, [db.prepare('UPDATE events SET organizer_name = ? WHERE id = ?').bind('New direct evidence', id)])
		expect(await db.prepare('SELECT organizer_name, scope, scope_invalidated_at FROM events WHERE id = ?').bind(id).first())
			.toEqual({ organizer_name: 'New direct evidence', scope: 'in', scope_invalidated_at: null })
	})

	it('deletes events and their vectors, more than one Vectorize call at a time', async () => {
		const { catalog, vectors } = store()
		const inputs = Array.from({ length: 25 }, () => event({ embedding: [0.5] }))
		for (const input of inputs) await catalog.insertEvent(input)
		const ids = (await db.prepare('SELECT id FROM events').all<{ id: string }>()).results.map((row) => row.id)
		await catalog.deleteEvents(ids)
		expect(await db.prepare('SELECT count(*) AS n FROM events').first('n')).toBe(0)
		expect(vectors.size).toBe(0)
	})
})

describe('enrichment state', () => {
	it('selects and counts pending rows using the enrichment filters', async () => {
		const { catalog } = store()
		const rows = [
			event({ name: 'pending', enrichment_status: 'pending' }),
			event({ name: 'failed', enrichment_status: 'failed' }),
			event({ name: 'done', enrichment_status: 'completed' }),
			event({ name: 'started', enrichment_status: 'pending', starts_at: new Date(Date.now() - 3_600_000).toISOString() }),
			event({ name: 'canceled', enrichment_status: 'pending', status: 'canceled' }),
			event({ name: 'no link', enrichment_status: 'pending', link: null }),
			event({ name: 'retired', enrichment_status: 'pending', source: RETIRED_SOURCES[0] }),
		]
		for (const row of rows) await catalog.insertEvent(row)
		expect(await countEventsNeedingEnrichment(catalog)).toBe(2)
		expect(await countEventsNeedingEnrichment(catalog, { statuses: ['pending'] })).toBe(1)
		expect(await countEventsNeedingEnrichment(catalog, { createdAfter: future(1) })).toBe(0)
		const selected = await getEventsNeedingEnrichment(catalog, { limit: 1 })
		expect(selected).toHaveLength(1)
		expect(selected[0]).toMatchObject({ categories: ['music'], facets: { genres: ['jazz'] }, is_free: false, enrichment_provenance: null })
	})
})

describe('venues on D1', () => {
	const venue = (name: string, address: string | null, neighborhood: string | null = 'Palermo') => ({ name, address, neighborhood, enrichment_status: 'pending' as const, address_check_status: 'not_flagged' as const })

	it('matches the same name key, else the most similar name at or above the threshold', async () => {
		const { catalog } = store()
		const sala = await catalog.createVenue(venue('Sala\u00a0Sintética  - CABA', 'Calle Norte 100'))
		await catalog.createVenue(venue('Centro Cultural Sintético', null))
		expect(await Effect.runPromise(matchVenueEffect('SALA SINTETICA', 0.6, catalog))).toMatchObject({ matchType: 'exact', venue: { id: sala.id } })
		expect(await Effect.runPromise(matchVenueEffect('Centro Cultural Sintético Raíz', 0.6, catalog))).toMatchObject({ matchType: 'fuzzy', confidence: expect.closeTo(0.833, 3) })
		expect(await Effect.runPromise(matchVenueEffect('Galpon Sintetico Club', 0.6, catalog))).toMatchObject({ matchType: 'none' })
	})

	it('breaks similarity ties toward the oldest venue', async () => {
		const { catalog } = store()
		await db.batch([
			db.prepare("INSERT INTO venues (id, name, created_at) VALUES ('b-newer', 'Club Ficticio Norte', '2026-02-01T00:00:00.000Z')"),
			db.prepare("INSERT INTO venues (id, name, created_at) VALUES ('c-older', 'Club Ficticio Sur', '2026-01-01T00:00:00.000Z')"),
			db.prepare("INSERT INTO venues (id, name, created_at) VALUES ('a-oldest-id', 'Club Ficticio Sur', '2026-01-01T00:00:00.000Z')"),
		])
		expect(await catalog.similarVenue('Club Ficticio', 0.5)).toMatchObject({ id: 'a-oldest-id' })
	})

	it('settles: reuses a same-name venue at the same address, creates one at another, and queues a lookalike', async () => {
		const { catalog } = store()
		const norte = await catalog.createVenue(venue('Teatro Sintético', 'Calle Norte 100'))
		expect(await settleVenue(catalog, { name: 'teatro sintetico', address: 'Calle Norte N° 100, CABA' }, { source: 'luma' })).toMatchObject({ venueId: norte.id, action: 'matched' })
		const other = await settleVenue(catalog, { name: 'Teatro Sintético', address: 'Calle Sur 200', neighborhood: 'Boedo' }, { source: 'luma' })
		expect(other).toMatchObject({ action: 'auto-created', neighborhood: 'Boedo' })
		expect(other.venueId).not.toBe(norte.id)
		const lookalike = await settleVenue(catalog, { name: 'Teatro Sintético Norte', neighborhood: 'Palermo' }, { source: 'meetup', scrapeRunId: null, eventIds: ['e1'] })
		expect(lookalike).toMatchObject({ action: 'queued-review' })
		const queued = await db.prepare('SELECT source, best_match_venue_id, match_confidence, source_event_ids, status FROM venue_review_queue').all()
		expect(queued.results).toEqual([{ source: 'meetup', best_match_venue_id: norte.id, match_confidence: expect.closeTo(0.739, 3), source_event_ids: '["e1"]', status: 'pending' }])
	})

	it('sees a venue another store created after its list was loaded (sources import concurrently)', async () => {
		const meetup = store().catalog
		const luma = store().catalog
		await meetup.createVenue(venue('Sala Previa', null))
		// Both stores have read the venue list.
		expect(await meetup.venuesNamed('Bar Nuevo')).toEqual([])
		expect(await luma.venuesNamed('Bar Nuevo')).toEqual([])
		const first = await settleVenue(meetup, { name: 'Bar Nuevo', address: 'Calle Este 300', neighborhood: 'Boedo' }, { source: 'meetup' })
		const second = await settleVenue(luma, { name: 'Bar Nuevo', address: 'Calle Este 300', neighborhood: 'Boedo' }, { source: 'luma' })
		expect(first.action).toBe('auto-created')
		expect(second).toMatchObject({ action: 'matched', venueId: first.venueId })
		expect(await db.prepare("SELECT count(*) AS n FROM venues WHERE name = 'Bar Nuevo'").first('n')).toBe(1)
	})

	it('settles a barrio-named venue only by its own street and number (PR #48)', async () => {
		const { catalog } = store()
		const first = await settleVenues(catalog, [{ name: 'San Telmo', address: 'Bolívar 624', neighborhood: 'San Telmo' }], { source: 'meetup' })
		const id = getVenueIdFromResults(first.results, 'San Telmo', 'Bolívar 624')
		expect(id).not.toBeNull()
		const again = await settleVenues(catalog, [
			{ name: 'San Telmo', address: 'Bolivar 624, CABA', neighborhood: 'San Telmo' },
			{ name: 'San Telmo', address: null, neighborhood: 'San Telmo' },
		], { source: 'meetup' })
		expect(getVenueIdFromResults(again.results, 'San Telmo', 'Bolivar 624, CABA')).toBe(id)
		expect(getVenueIdFromResults(again.results, 'San Telmo', null)).toBeNull()
		expect(await db.prepare("SELECT count(*) AS n FROM venues WHERE name = 'San Telmo'").first('n')).toBe(1)
	})

	it('reports applied and kept venues for every event in an approved review', async () => {
		const { catalog } = store()
		const keep = await catalog.createVenue(venue('Sala Sintética', null))
		const input = event()
		await catalog.insertEvent(input)
		const id = await eventId(input.external_id)
		const original = await catalog.createVenue(venue('Sala Confirmada', 'Calle Norte 34'))
		const protectedEvent = event({ venue_id: original.id })
		const hiddenEvent = event({ location_hidden: true })
		const unchangedEvent = event({ venue_id: keep.id })
		for (const row of [protectedEvent, hiddenEvent, unchangedEvent]) await catalog.insertEvent(row)
		const protectedId = await eventId(protectedEvent.external_id)
		const hiddenId = await eventId(hiddenEvent.external_id)
		const unchangedId = await eventId(unchangedEvent.external_id)
		const missingId = crypto.randomUUID()
		await protectIntakeName(protectedId)
		await db.prepare(`UPDATE event_intake_protection SET fields = '["venue_id"]' WHERE event_id = ?`).bind(protectedId).run()
		await catalog.queueVenueReview({ scrape_run_id: null, source: 'luma', source_venue_name: 'Sala S.', match_confidence: 0.7,
			source_event_ids: [id, protectedId, hiddenId, unchangedId, missingId], status: 'pending' })
		const reviewId = (await db.prepare('SELECT id FROM venue_review_queue').first<string>('id'))!
		expect(await approveVenueReview(catalog, { id: reviewId, venueId: keep.id, notes: 'same place' })).toEqual({ success: true, venueWrites: [
			{ id, applied: ['venue_id'], kept: [] }, { id: protectedId, applied: [], kept: ['venue_id'] },
			{ id: hiddenId, applied: [], kept: ['venue_id'] }, { id: unchangedId, applied: [], kept: [] }, { id: missingId, applied: [], kept: [] },
		] })
		const venueFor = (id: string) => db.prepare('SELECT venue_id FROM events WHERE id = ?').bind(id).first('venue_id')
		expect(await venueFor(id)).toBe(keep.id)
		expect(await venueFor(protectedId)).toBe(original.id)
		expect(await venueFor(hiddenId)).toBeNull()
		expect(await db.prepare('SELECT status, final_venue_id, notes FROM venue_review_queue').first()).toEqual({ status: 'approved', final_venue_id: keep.id, notes: 'same place' })
	})
})

describe('blocklist and scrape runs on D1', () => {
	it('reads entries for one source plus "all"', async () => {
		await db.batch([
			db.prepare("INSERT INTO import_blocklist (id, pattern, target_field, source) VALUES ('a', 'promo', 'event_name', 'all')"),
			db.prepare("INSERT INTO import_blocklist (id, pattern, target_field, source) VALUES ('l', 'spam', 'venue_name', 'luma')"),
			db.prepare("INSERT INTO import_blocklist (id, pattern, target_field, source) VALUES ('m', 'x', 'event_name', 'meetup')"),
		])
		const { catalog } = store()
		expect((await catalog.blocklistEntries('luma')).map((entry) => entry.id).sort()).toEqual(['a', 'l'])
		expect(await catalog.blocklistEntries()).toHaveLength(3)
	})

	it('opens, reconciles, closes, and audits a daily run, deleting blocklisted events', async () => {
		const { catalog, vectors } = store()
		await db.prepare("INSERT INTO import_blocklist (id, pattern, target_field, source) VALUES ('a', 'promo', 'event_name', 'all')").run()
		const stale = new Date(Date.now() - 3 * 3_600_000).toISOString()
		await db.prepare("INSERT INTO scrape_runs (id, source, status, started_at) VALUES ('old', 'all', 'running', ?)").bind(stale).run()
		const run = await openScrapeRun(catalog, 'daily-scrape-test', '2026-11-16T09:00:00.000Z')
		expect(await db.prepare("SELECT status, error_details FROM scrape_runs WHERE id = 'old'").first()).toMatchObject({ status: 'failed', error_details: expect.stringContaining('stale_running_run') })

		const blocked = event({ name: 'Gran PROMO sintética', embedding: [0.3] })
		await catalog.insertEvent(blocked)
		await catalog.insertEvent(event({ enrichment_status: 'pending' }))
		const results = [{ source: 'meetup', success: true, eventsInserted: 2, eventsUpdated: 0, eventsSkipped: 0, venuesAutoCreated: 0 }]
		expect(await closeScrapeRun(catalog, run, [{ taskIdentifier: 'meetup', ok: true }], results)).toBe(1)
		expect(await db.prepare('SELECT count(*) AS n FROM events').first('n')).toBe(1)
		expect(vectors.size).toBe(0)

		await recordEnrichmentAudit(catalog, run.id, { enriched: 1, failed: 0, remaining: 0 })
		const row = await db.prepare('SELECT status, events_inserted, enrichments_completed, metadata FROM scrape_runs WHERE id = ?').bind(run.id).first<{ metadata: string }>()
		expect(row).toMatchObject({ status: 'completed', events_inserted: 2, enrichments_completed: 1 })
		expect(JSON.parse(row!.metadata)).toMatchObject({ scheduledTime: '2026-11-16T09:00:00.000Z', blocklistCleanup: 1, enrichment: { eligible: 1, enriched: 1 } })
		expect(await reconcileStaleScrapeRuns(catalog)).toBe(0)
	})
})
