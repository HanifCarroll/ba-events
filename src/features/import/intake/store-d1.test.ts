/**
 * The intake on real Miniflare D1: transactional intake operations and the
 * operator flow (submit, preview, commit, venue, held) through `d1Intake`. Grants to anon/authenticated are not ported:
 * D1 has no roles, and the intake API's bearer token replaces them (intake-api.test.ts).
 */
import type { D1Database, R2Bucket } from '@cloudflare/workers-types'
import { Effect } from 'effect'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { freshD1 } from '../../../../tests/support/d1.ts'
import { fakeVectorize } from '../../../../tests/support/vectorize.ts'
import { fakeR2 } from '../../../../tests/support/r2.ts'
import { buildSearchDocument, CURRENT_EMBEDDING_VERSION } from '#shared/lib/ai/embeddings.ts'
import { reconcileCatalog } from '#shared/lib/db/vector-sync.ts'
import { applyCatalogFix } from '#features/instagram-publisher/catalog-fix.ts'
import { describeImage } from './collection.ts'
import { readOfficialPage } from './official-page.ts'
import { commitPlanEffect, previewCandidateEffect, submitCandidateEffect } from './service.ts'
import { d1Intake, importSourcesEffect } from './store-d1.ts'
import { heldBacklogEffect, resolveIntakeVenueEffect, decodeVenueRequest } from './venues.ts'
import type { IntakeStore } from './store.ts'

let db: D1Database
let dispose: () => Promise<void>
let store: IntakeStore
let evidence: R2Bucket & { objects: Map<string, Uint8Array> }
let artwork: R2Bucket & { objects: Map<string, Uint8Array> }
let vectors: ReturnType<typeof fakeVectorize>
// Vitest only: under `bun test` these files' Miniflare work reliably tripped Bun's intermittent spawn failure (`connect
// ENOENT` on workerd's control pipe), which failed d1-schema.test.ts after them. Vitest runs them in every gate.
// shortcut: drop the skip once Bun's child_process extra-stdio bug is fixed or tests/support/d1.ts retries the start.
const bun = 'Bun' in globalThis
beforeAll(async () => { if (bun) return; ({ db, dispose } = await freshD1()) }, 60_000)
afterAll(async () => { if (bun) return; await dispose() })

const TABLES = ['publisher_catalog_fixes', 'vector_sync', 'event_intake_protection', 'event_source_evidence', 'intake_plans', 'intake_candidate_revisions', 'intake_candidates',
  'intake_media', 'intake_observations', 'intake_runs', 'instagram_sources', 'venue_review_queue', 'events', 'venues']
beforeEach(async () => {
  if (bun) return
  await db.batch([...TABLES.map(table => db.prepare(`DELETE FROM ${table}`)),
    db.prepare(`UPDATE intake_policy SET collection_enabled = 1, publishing_enabled = 1, data_detail_level = 'detailedData',
      run_cap_usd = 1.5, monthly_cap_usd = 18, posts_per_source = 20`)])
  evidence = fakeR2(); artwork = fakeR2(); vectors = fakeVectorize()
  store = d1Intake({ db, evidence, artwork, vectors: vectors.index })
})

let n = 0
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)
const fails = async (effect: Effect.Effect<unknown, { message: string }>) => (await run(Effect.flip(effect))).message
const HOUR = 3_600_000, DAY = 24 * HOUR
const utc = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')
const baToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date())
const shiftDay = (day: string, days: number) => new Date(Date.parse(`${day}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10)

async function source(username = 'synthetic_venue', authority = 'venue', enabled = 1) {
  await db.prepare("INSERT INTO instagram_sources (username, authority, enabled, qualification) VALUES (?, ?, ?, 'Synthetic fixture')")
    .bind(username, authority, enabled).run()
}
async function pastRun(daysAgo: number, state: string, createdAgoMs: number) {
  await db.prepare("INSERT INTO intake_runs (id, local_date, state, reserved_usd, input, created_at) VALUES (?, ?, ?, 0.01, '{}', ?)")
    .bind(id(), shiftDay(baToday(), -daysAgo), state, new Date(Date.now() - createdAgoMs).toISOString()).run()
}
async function venue(name = 'Synthetic Venue', neighborhood: string | null = 'Palermo', address: string | null = 'Ficticia 1234') {
  const venueId = id()
  await db.prepare('INSERT INTO venues (id, name, neighborhood, address) VALUES (?, ?, ?, ?)').bind(venueId, name, neighborhood, address).run()
  return venueId
}
async function observation(runId: string, caption = 'Synthetic Jazz 20/11 21:00 Synthetic Venue', postId = 'synthetic-post', username = 'synthetic_venue',
  mediaUrls: string[] = []) {
  return (await run(store.upsertObservation({ run_id: runId, post_id: postId, source_username: username, post_url: 'https://www.instagram.com/p/synthetic/',
    caption, published_at: null, content_hash: (caption.length.toString(16) + postId).padEnd(64, 'a').slice(0, 64).replace(/[^0-9a-f]/g, 'a'), media_urls: mediaUrls }))).id
}

describe.skipIf(bun)('reserve_instagram_collection on D1', () => {
  it('computes the incremental window from the last succeeded run: 2 hours before it, 7 days with none, never past 30 days', async () => {
    await source()
    const window = async () => {
      const reserved = await run(store.reserveCollection)
      await db.prepare('DELETE FROM intake_runs WHERE id = ?').bind(reserved.id).run()
      return reserved.input.onlyPostsNewerThan as string
    }
    const near = (expected: number, actual: string) => expect(Math.abs(Date.parse(actual) - expected)).toBeLessThan(5_000)
    near(Date.now() - 7 * DAY, await window())
    await pastRun(3, 'succeeded', 27 * HOUR); await pastRun(2, 'failed', 3 * HOUR); await pastRun(5, 'succeeded', 5 * DAY)
    near(Date.now() - 29 * HOUR, await window())
    await db.prepare("DELETE FROM intake_runs").run(); await pastRun(12, 'succeeded', 12 * DAY)
    near(Date.now() - 12 * DAY - 2 * HOUR, await window())
    await db.prepare("DELETE FROM intake_runs").run(); await pastRun(30, 'succeeded', 30 * DAY - HOUR)
    near(Date.now() - 30 * DAY, await window())
    expect(await window()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
  })

  it('takes the ceiling and detail level from the policy and reserves one paid run per Buenos Aires date', async () => {
    await source(); await source('synthetic_off', 'venue', 0); await source('another_venue')
    await db.prepare("UPDATE intake_policy SET data_detail_level = 'basicData'").run()
    const first = await run(store.reserveCollection)
    expect(first).toMatchObject({ fresh: true, actor_build: '0.0.679', local_date: baToday(), state: 'reserved', reserved_usd: 1.5,
      input: { username: ['another_venue', 'synthetic_venue'], resultsLimit: 20, dataDetailLevel: 'basicData', skipPinnedPosts: false, includeMusicData: false } })
    const second = await run(store.reserveCollection)
    expect(second).toMatchObject({ fresh: false, id: first.id })
    expect((await db.prepare('SELECT count(*) AS n FROM intake_runs').first<{ n: number }>())!.n).toBe(1)
  })

  it('lets only one concurrent retry reclaim a released day and refuses a stale release', async () => {
    await source()
    const first = await run(store.reserveCollection)
    await run(store.releaseCollection(first.id, first.created_at))
    await db.prepare('UPDATE intake_policy SET run_cap_usd = 2, monthly_cap_usd = 2, posts_per_source = 10').run()

    const retries = await Promise.all([run(store.reserveCollection), run(store.reserveCollection)])
    expect(retries.filter(row => row.fresh)).toHaveLength(1)
    const winner = retries.find(row => row.fresh)!
    expect(winner).toMatchObject({ id: first.id, state: 'reserved', reserved_usd: 2, charged_usd: null,
      completed_at: null, input: { resultsLimit: 10 } })
    expect(winner.created_at > first.created_at).toBe(true)
    expect(retries.find(row => !row.fresh)).toMatchObject({ id: first.id, created_at: winner.created_at })
    expect(await fails(store.releaseCollection(first.id, first.created_at))).toBe('Collection reservation is no longer eligible for release')
    expect(await run(store.reserveCollection)).toMatchObject({ id: first.id, state: 'reserved', fresh: false, charged_usd: null })
  })

  it('rechecks the calendar-month cap before renewing a released day', async () => {
    await source()
    const first = await run(store.reserveCollection)
    await run(store.releaseCollection(first.id, first.created_at))
    await db.prepare('UPDATE intake_policy SET monthly_cap_usd = 1').run()
    expect(await fails(store.reserveCollection)).toBe('Monthly collection budget exhausted')
    expect(await db.prepare('SELECT id, state, charged_usd FROM intake_runs').first()).toEqual({ id: first.id, state: 'failed', charged_usd: 0 })
  })

  it('does not release or reclaim a paid run even if Apify reported zero charges', async () => {
    await source()
    const first = await run(store.reserveCollection)
    await run(store.updateRun(first.id, { state: 'started', apify_run_id: 'paid-run', dataset_id: 'dataset' }))
    expect(await fails(store.releaseCollection(first.id, first.created_at))).toBe('Collection reservation is no longer eligible for release')
    await run(store.updateRun(first.id, { state: 'failed', charged_usd: 0 }))
    expect(await run(store.reserveCollection)).toMatchObject({ id: first.id, state: 'failed', fresh: false, apify_run_id: 'paid-run' })
  })

  it('refuses a disabled switch, an exhausted month, and an empty or oversized watchlist', async () => {
    await db.prepare('UPDATE intake_policy SET collection_enabled = 0').run()
    expect(await fails(store.reserveCollection)).toBe('Instagram collection is not enabled')
    await db.prepare('UPDATE intake_policy SET collection_enabled = 1').run()
    expect(await fails(store.reserveCollection)).toBe('Source watchlist exceeds policy or is empty')
    await source(); await source('second_venue')
    await db.prepare('UPDATE intake_policy SET max_sources = 1').run()
    expect(await fails(store.reserveCollection)).toBe('Source watchlist exceeds policy or is empty')
    await db.prepare('UPDATE intake_policy SET max_sources = 200').run()
    const today = baToday()
    if (today.slice(8) !== '01') { // a run earlier this month
      await db.prepare("INSERT INTO intake_runs (id, local_date, state, reserved_usd, charged_usd, input) VALUES (?, ?, 'succeeded', 5, 17, '{}')")
        .bind(id(), `${today.slice(0, 8)}01`).run()
      expect(await fails(store.reserveCollection)).toBe('Monthly collection budget exhausted')
    }
  })
})

describe.skipIf(bun)('submit_intake_candidate on D1', () => {
  it('keeps the revision for a repeated payload, refuses a stale revision, and records every revision', async () => {
    const candidate = id()
    expect(await run(store.submitCandidate(candidate, 0, { name: 'Synthetic candidate' } as never))).toMatchObject({ revision: 1 })
    expect(await run(store.submitCandidate(candidate, 0, { name: 'Synthetic candidate' } as never))).toMatchObject({ revision: 1 })
    expect(await fails(store.submitCandidate(candidate, 0, { name: 'Changed candidate' } as never))).toBe('Candidate revision conflict')
    expect(await run(store.submitCandidate(candidate, 1, { name: 'Changed candidate' } as never))).toMatchObject({ revision: 2, payload: { name: 'Changed candidate' } })
    const revisions = (await db.prepare('SELECT revision FROM intake_candidate_revisions WHERE candidate_id = ? ORDER BY revision').bind(candidate).all()).results
    expect(revisions).toEqual([{ revision: 1 }, { revision: 2 }])
  })
})

describe.skipIf(bun)('commit_intake_plan on D1', () => {
  const body = (venueId: string, fields: Record<string, unknown> = {}) => ({ name: 'Synthetic Jazz', starts_at: '2026-11-21T00:00:00Z', time_tba: false,
    venue_id: venueId, categories: ['music'], source: 'instagram', status: 'scheduled', is_free: false, embedding: Array(1536).fill(0.1),
    search_document: 'Synthetic Jazz', embedding_version: 2, enrichment_status: 'skipped', description_unavailable: true, ...fields })
  const plan = async (candidate: string, revision: number, action: 'create' | 'update' | 'link', eventId: string, payload: object,
    evidence: object[]) => {
    const expected = action === 'create' ? null : (await db.prepare('SELECT updated_at FROM events WHERE id = ?').bind(eventId).first<{ updated_at: string }>())!.updated_at
    return (await run(store.insertPlan({ candidate_id: candidate, revision, action, event_id: eventId, expected_event_updated_at: expected,
      payload: payload as never, artwork_media_id: null, evidence: evidence as never, reasons: [] }))).id
  }

  it('is idempotent, keeps one identity across a reschedule, protects the correction, and rejects stale evidence without a receipt', async () => {
    await source()
    const runId = (await run(store.reserveCollection)).id
    const venueId = await venue()
    const post = await observation(runId)
    const candidate = id(), event = id()
    await run(store.submitCandidate(candidate, 0, { name: 'Synthetic candidate' } as never))
    const created = await plan(candidate, 1, 'create', event, body(venueId), [{ observation_id: post }])
    const first = await run(store.commitPlan(created))
    const second = await run(store.commitPlan(created))
    expect(second).toEqual(first)
    expect(first).toMatchObject({ action: 'create', event_id: event, previous_event: null })
    expect((await db.prepare('SELECT count(*) AS n FROM events').first<{ n: number }>())!.n).toBe(1)
    expect(vectors.vectors.get(event)).toMatchObject({ metadata: { status: 'scheduled', starts_at: Date.parse('2026-11-21T00:00:00Z') } })

    await run(store.submitCandidate(candidate, 1, { name: 'Rescheduled' } as never))
    const revised = await plan(candidate, 2, 'update', event, body(venueId, { starts_at: '2026-12-02T00:00:00Z', status: 'canceled', embedding: undefined }),
      [{ observation_id: post, fields: ['date', 'time', 'status'] }])
    expect(await run(store.commitPlan(revised))).toMatchObject({ action: 'update', previous_event: { id: event, status: 'scheduled' } })
    expect(vectors.vectors.get(event)?.metadata).toEqual({ status: 'canceled', starts_at: Date.parse('2026-12-02T00:00:00Z') })
    expect(vectors.vectors.get(event)?.values[0]).toBeCloseTo(0.1)

    await db.prepare("UPDATE events SET starts_at = '2026-11-21T00:00:00.000Z', status = 'scheduled', name = 'Stale platform name', search_document = 'Stale' WHERE id = ?").bind(event).run()
    expect(await db.prepare('SELECT name, status, starts_at, search_document FROM events WHERE id = ?').bind(event).first())
      .toEqual({ name: 'Synthetic Jazz', status: 'canceled', starts_at: '2026-12-02T00:00:00.000Z', search_document: 'Synthetic Jazz' })
    expect((await db.prepare('SELECT count(*) AS n FROM events').first<{ n: number }>())!.n).toBe(1)
    expect(await db.prepare('SELECT count(*) AS n FROM write_context').first()).toEqual({ n: 0 })

    await run(store.submitCandidate(candidate, 2, { name: 'Correction' } as never))
    const stale = await plan(candidate, 3, 'update', event, body(venueId), [{ observation_id: post }])
    await db.prepare(`INSERT INTO intake_observations (id, run_id, post_id, source_username, post_url, caption, content_hash, observed_at)
      VALUES (?, ?, 'synthetic-post', 'synthetic_venue', 'https://www.instagram.com/p/synthetic/', 'Changed evidence', ?, ?)`)
      .bind(id(), runId, 'b'.repeat(64), new Date(Date.now() + 1000).toISOString()).run()
    expect(await fails(store.commitPlan(stale))).toBe('Source changed after review')
    expect((await run(store.plan(stale))).receipt).toBeNull()
  })

  it('rejects a stale intake plan after a publisher correction; fresh direct intake evidence can supersede it', async () => {
    await source()
    const venueId = await venue()
    const post = await observation((await run(store.reserveCollection)).id)
    const candidate = id(), event = id()
    await run(store.submitCandidate(candidate, 0, { name: 'Original' } as never))
    const created = await plan(candidate, 1, 'create', event, body(venueId), [{ observation_id: post }])
    const original = await run(store.commitPlan(created))
    await run(store.submitCandidate(candidate, 1, { name: 'Confirmed by venue' } as never))
    const payload = body(venueId, { name: 'Confirmed by venue', search_document: 'Confirmed by venue' })
    const cited = [{ observation_id: post, fields: ['name'] }]
    const stale = await plan(candidate, 2, 'update', event, payload, cited)
    const authority = await db.prepare('SELECT * FROM event_intake_protection WHERE event_id = ?').bind(event).first()
    const query = async (sql: string, params: string[]) => (await db.prepare(sql).bind(...params).all()).results
    await applyCatalogFix(query, { id: event, field: 'name', from: 'Synthetic Jazz', to: 'Publisher correction',
      allOccurrences: false, evidence: 'Synthetic program' }, id)
    expect(await db.prepare('SELECT name FROM events WHERE id = ?').bind(event).first('name')).toBe('Publisher correction')
    expect(await db.prepare('SELECT event_id FROM vector_sync WHERE event_id = ?').bind(event).first('event_id')).toBe(event)
    expect(await db.prepare('SELECT * FROM event_intake_protection WHERE event_id = ?').bind(event).first()).toEqual(authority)
    expect(await fails(store.commitPlan(stale))).toBe('Catalog changed after preview')
    expect((await run(store.plan(stale))).receipt).toBeNull()
    expect(await run(commitPlanEffect(store, created))).toEqual(original)
    expect(await db.prepare('SELECT event_id FROM vector_sync WHERE event_id = ?').bind(event).first('event_id')).toBe(event)

    const fresh = await plan(candidate, 2, 'update', event, payload, cited)
    expect(await run(store.commitPlan(fresh))).toMatchObject({ previous_event: { name: 'Publisher correction' } })
    expect(await db.prepare('SELECT name FROM events WHERE id = ?').bind(event).first('name')).toBe('Confirmed by venue')
    expect(await db.prepare('SELECT plan_id FROM event_intake_protection WHERE event_id = ?').bind(event).first('plan_id')).toBe(fresh)
  })

  it('refuses held, expired and superseded plans, curator corrections, and a duplicate that appeared after preview', async () => {
    await source(); await source('synthetic_curator', 'curator')
    const runId = (await run(store.reserveCollection)).id
    const venueId = await venue()
    const post = await observation(runId)
    const curated = await observation(runId, 'Repost', 'curator-post', 'synthetic_curator')
    const candidate = id(), event = id()
    await run(store.submitCandidate(candidate, 0, { name: 'A' } as never))
    const held = (await run(store.insertPlan({ candidate_id: candidate, revision: 1, action: 'held', event_id: event, expected_event_updated_at: null,
      payload: body(venueId) as never, artwork_media_id: null, evidence: [{ observation_id: post }] as never, reasons: ['Held'] }))).id
    expect(await fails(store.commitPlan(held))).toBe('Plan is held or expired')
    const expired = await plan(candidate, 1, 'create', event, body(venueId), [{ observation_id: post }])
    await db.prepare("UPDATE intake_plans SET expires_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").bind(expired).run()
    expect(await fails(store.commitPlan(expired))).toBe('Plan is held or expired')
    const superseded = await plan(candidate, 1, 'create', event, body(venueId), [{ observation_id: post }])
    await run(store.submitCandidate(candidate, 1, { name: 'B' } as never))
    expect(await fails(store.commitPlan(superseded))).toBe('Candidate changed after preview')

    await db.prepare("INSERT INTO events (id, name, starts_at, venue_id, source) VALUES (?, 'SYNTHETIC JAZZ', '2026-11-21T00:00:00.000Z', ?, 'luma')").bind(id(), venueId).run()
    const duplicate = await plan(candidate, 2, 'create', event, body(venueId), [{ observation_id: post }])
    expect(await fails(store.commitPlan(duplicate))).toBe('A matching event appeared after preview')

    const listed = id()
    await db.prepare("INSERT INTO events (id, name, starts_at, venue_id, source) VALUES (?, 'Listed', '2026-11-22T00:00:00.000Z', ?, 'luma')").bind(listed, venueId).run()
    const correction = await plan(candidate, 2, 'update', listed, body(venueId, { status: 'canceled' }), [{ observation_id: curated, fields: ['status'] }])
    expect(await fails(store.commitPlan(correction))).toBe('Correction needs current organizer or venue evidence')
    const unsupported = await plan(candidate, 2, 'update', listed, body(venueId, { status: 'canceled' }), [{ observation_id: post, fields: ['name'] }])
    expect(await fails(store.commitPlan(unsupported))).toBe('Correction field lacks current direct evidence: status')
    await db.prepare('UPDATE intake_policy SET publishing_enabled = 0').run()
    expect(await fails(store.checkPlan(unsupported))).toBe('Publishing is not enabled')
    expect((await db.prepare('SELECT count(*) AS n FROM intake_plans WHERE receipt IS NOT NULL').first<{ n: number }>())!.n).toBe(0)
  })

  it('restores a missed vector when a committed plan is committed again', async () => {
    await source()
    const runId = (await run(store.reserveCollection)).id
    const venueId = await venue()
    const post = await observation(runId)
    const candidate = id(), event = id()
    await run(store.submitCandidate(candidate, 0, { name: 'A' } as never))
    const created = await plan(candidate, 1, 'create', event, body(venueId), [{ observation_id: post }])
    vectors.failUpserts(1)
    expect(await fails(store.commitPlan(created))).toContain('Vectorize unavailable')
    expect((await run(store.plan(created))).receipt).not.toBeNull()
    expect(vectors.vectors.has(event)).toBe(false)
    // Left queued for the nightly reconcile until the vector lands.
    expect(await db.prepare('SELECT count(*) AS n FROM vector_sync WHERE event_id = ?').bind(event).first()).toEqual({ n: 1 })
    expect(await run(commitPlanEffect(store, created))).toMatchObject({ event_id: event })
    expect(vectors.vectors.has(event)).toBe(true)
    expect(await db.prepare('SELECT count(*) AS n FROM vector_sync').first()).toEqual({ n: 0 })
  })

  it.each([false, true])('queues a search repair after a reschedule reads stale vector values (earlier upsert succeeded: %s)', async succeeded => {
    await source()
    const venueId = await venue()
    const post = await observation((await run(store.reserveCollection)).id)
    const candidate = id(), event = id()
    await run(store.submitCandidate(candidate, 0, { name: 'A' } as never))
    await run(store.commitPlan(await plan(candidate, 1, 'create', event, body(venueId), [{ observation_id: post }])))

    await run(store.submitCandidate(candidate, 1, { name: 'B' } as never))
    const corrected = { name: 'New Title', search_document: 'New search document' }
    const titlePlan = await plan(candidate, 2, 'update', event,
      body(venueId, { ...corrected, embedding: Array(1536).fill(0.4) }), [{ observation_id: post }])
    if (succeeded) {
      const stale = await vectors.index.getByIds([event])
      expect(await run(store.commitPlan(titlePlan))).toMatchObject({ action: 'update' })
      expect(vectors.vectors.get(event)?.values[0]).toBeCloseTo(0.4)
      expect(await db.prepare('SELECT event_id FROM vector_sync').first()).toBeNull()
      vi.spyOn(vectors.index, 'getByIds').mockResolvedValueOnce(stale)
    } else {
      vectors.failUpserts(1)
      expect(await fails(store.commitPlan(titlePlan))).toContain('Vectorize unavailable')
    }

    await run(store.submitCandidate(candidate, 2, { name: 'C' } as never))
    const starts_at = '2026-12-02T00:00:00Z'
    const reschedule = await plan(candidate, 3, 'update', event, body(venueId, { ...corrected, starts_at, embedding: undefined }),
      [{ observation_id: post, fields: ['date', 'time'] }])
    expect(await run(store.commitPlan(reschedule))).toMatchObject({ action: 'update' })
    expect(vectors.vectors.get(event)).toMatchObject({ metadata: { status: 'scheduled', starts_at: Date.parse(starts_at) } })
    expect(vectors.vectors.get(event)?.values[0]).toBeCloseTo(0.1)
    expect(await db.prepare('SELECT event_id FROM vector_sync').first()).toEqual({ event_id: event })
  })

  it('does not replay a prepared vector superseded by nightly search repair', async () => {
    await source()
    const venueId = await venue()
    const post = await observation((await run(store.reserveCollection)).id)
    const candidate = id(), event = id()
    await run(store.submitCandidate(candidate, 0, { name: 'A' } as never))
    const created = await plan(candidate, 1, 'create', event, body(venueId, { embedding_version: 1 }), [{ observation_id: post }])
    const receipt = await run(commitPlanEffect(store, created))
    expect(await reconcileCatalog(db, vectors.index, { embed: async () => ({ embedding: [0.5], searchDocument: 'Rebuilt Jazz' }) }))
      .toMatchObject({ reembedded: 1 })
    // A later repair can still be pending even though the old plan is this event's latest accepted intake plan.
    await db.prepare('INSERT INTO vector_sync (event_id) VALUES (?)').bind(event).run()
    expect(await run(commitPlanEffect(store, created))).toEqual(receipt)
    expect(vectors.vectors.get(event)?.values).toEqual([0.5])
    expect(await db.prepare('SELECT event_id FROM vector_sync').first()).toEqual({ event_id: event })
  })

  it('never replaces a later correction\'s vector when an older plan is committed again', async () => {
    await source()
    const runId = (await run(store.reserveCollection)).id
    const venueId = await venue()
    const post = await observation(runId)
    const candidate = id(), event = id()
    await run(store.submitCandidate(candidate, 0, { name: 'A' } as never))
    const first = await plan(candidate, 1, 'create', event, body(venueId), [{ observation_id: post }])
    await run(store.commitPlan(first))
    await run(store.submitCandidate(candidate, 1, { name: 'B' } as never))
    const correction = await plan(candidate, 2, 'update', event, body(venueId, { name: 'Synthetic Jazz Corrected',
      search_document: 'Synthetic Jazz Corrected', embedding: Array(1536).fill(0.3) }), [{ observation_id: post }])
    await run(store.commitPlan(correction))
    expect(vectors.vectors.get(event)?.values[0]).toBeCloseTo(0.3)
    expect(await run(commitPlanEffect(store, first))).toMatchObject({ plan_id: first, event_id: event })
    expect(vectors.vectors.get(event)?.values[0]).toBeCloseTo(0.3)
  })
})

describe.skipIf(bun)('the operator flow on D1', () => {
  const candidateInput = (candidate: string, post: string, venueId: string | null, fields: Record<string, unknown> = {}) => ({
    id: candidate, expected_revision: 0, intent: 'create', target_event_id: null, name: 'Synthetic Jazz', date: shiftDay(baToday(), 5), time: '21:00',
    venue_name: 'Synthetic Venue', venue_id: venueId, description_es: null, description_en: null, categories: ['music'], status: 'scheduled',
    price_kind: 'unknown', price_ars: null, price_note: null, ticket_url: null, artwork_media_id: null, artwork_note: 'No suitable retained image', issues: [], notes: '',
    evidence: [{ observation_id: post, fields: ['name', 'date', 'time', 'venue'], excerpt: 'Synthetic Jazz 20/11 21:00 Synthetic Venue', media_id: null }], ...fields })
  const publishers = {
    embed: async () => ({ embedding: Array(1536).fill(0.2), searchDocument: 'Synthetic Jazz | Synthetic Venue' }),
    presentation: async () => ({ description_display_es: null, description_display_en: null, description_summary_es: null, description_summary_en: null }),
  }

  it('submits, previews, commits with retained artwork in R2, and lists the held backlog', async () => {
    await source()
    const runId = (await run(store.reserveCollection)).id
    const venueId = await venue()
    const post = await observation(runId, undefined, undefined, undefined, ['https://scontent.cdninstagram.com/v/flyer.jpg'])
    const image = await describeImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]))
    expect(await run(store.unreviewedMedia)).toEqual([{ id: post, media_urls: ['https://scontent.cdninstagram.com/v/flyer.jpg'], positions: [] }])
    await run(store.retainImage(post, 0, image))
    expect(evidence.objects.has(image.object_key)).toBe(true)
    expect(await run(store.unreviewedMedia)).toEqual([])
    const media = await run(store.mediaFor(post))
    const candidate = id()
    await run(submitCandidateEffect(store, candidateInput(candidate, post, venueId, { artwork_media_id: media[0].id })))
    const preview = await run(previewCandidateEffect(store, candidate))
    expect(preview).toMatchObject({ action: 'create', reasons: [], venue_name: 'Synthetic Venue',
      payload: { image_url: `https://baeventos.com/api/event-artwork/${preview.event_id}/${image.object_key}`, venue_id: venueId } })
    const receipt = await run(commitPlanEffect(store, preview.id, publishers))
    expect(receipt).toMatchObject({ action: 'create', event_id: preview.event_id })
    expect(artwork.objects.has(image.object_key)).toBe(true)
    expect(await db.prepare('SELECT source, external_id, search_document, embedding_version, time_tba, is_free FROM events WHERE id = ?').bind(preview.event_id).first())
      .toEqual({ source: 'instagram', external_id: candidate, search_document: 'Synthetic Jazz | Synthetic Venue', embedding_version: 2, time_tba: 0, is_free: 0 })
    const indexed = vectors.vectors.get(preview.event_id)
    expect(indexed).toMatchObject({ id: preview.event_id, metadata: { status: 'scheduled', starts_at: Date.parse(preview.payload.starts_at) } })
    expect(indexed?.values[0]).toBeCloseTo(0.2)
    expect(await db.prepare('SELECT event_id FROM vector_sync').first()).toBeNull()

    // A second candidate held for its venue, with a hint from the importers' matcher.
    const other = id()
    await run(submitCandidateEffect(store, candidateInput(other, post, null, { venue_name: 'Synthetic Venue Club', name: 'Other night' })))
    const held = await run(previewCandidateEffect(store, other))
    expect(held.action).toBe('held')
    expect(held.reasons).toContain('Venue must be resolved before publishing')
    const backlog = await run(heldBacklogEffect(store))
    expect(backlog).toMatchObject({ held: 1, groups: [{ venue_name: 'Synthetic Venue Club', candidates: [{ id: other }] }] })
  })

  it('holds an undecided artwork choice and persists the reason with a publishable plan', async () => {
    await source()
    const post = await observation((await run(store.reserveCollection)).id)
    const candidate = id(), venueId = await venue()
    const input = candidateInput(candidate, post, venueId, { artwork_note: '   ' })
    await run(submitCandidateEffect(store, input))
    expect(await run(previewCandidateEffect(store, candidate))).toMatchObject({ action: 'held',
      reasons: ['Select retained artwork or give a reason in artwork_note'] })
    const artwork_note = 'The only retained image is a schedule for several shows.'
    await run(submitCandidateEffect(store, { ...input, expected_revision: 1, artwork_note }))
    const preview = await run(previewCandidateEffect(store, candidate))
    expect(preview).toMatchObject({ action: 'create', artwork_note, payload: { image_url: null } })
    expect(await run(store.plan(preview.id))).toMatchObject({ artwork_note })
    expect(await run(commitPlanEffect(store, preview.id, publishers))).toMatchObject({ action: 'create' })
  })

  it.each([
    { search: 'Old search document  ', version: 1 },
    { search: null, version: CURRENT_EMBEDDING_VERSION },
    { search: 'Synthetic Jazz. Venue: Former Venue', version: CURRENT_EMBEDDING_VERSION },
  ])(
    'preserves search during an artwork-only update and repairs it once at night ($search)', async ({ search, version }) => {
    await source()
    const runId = (await run(store.reserveCollection)).id
    const venueId = await venue()
    const post = await observation(runId, undefined, undefined, undefined, ['https://scontent.cdninstagram.com/v/flyer.jpg'])
    const image = await describeImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 4, 5, 6]))
    await run(store.retainImage(post, 0, image))
    const [{ id: artwork_media_id }] = await run(store.mediaFor(post))
    const candidate = id(), event = id()
    const at = new Date(`${shiftDay(baToday(), 5)}T21:00:37-03:00`).toISOString()
    await db.prepare(`INSERT INTO events (id, name, starts_at, venue_id, source, categories, description_es, description_en,
      description_display_es, description_display_en, description_summary_es, description_summary_en, search_document, embedding_version, enrichment_status)
      VALUES (?, 'Synthetic Jazz', ?, ?, 'luma', '["music"]', 'Texto original', 'Original text', 'Texto visible', 'Visible text',
      'Resumen guardado', 'Stored summary', ?, ?, 'pending')`).bind(event, at, venueId, search, version).run()
    const read = () => db.prepare(`SELECT starts_at, description_es, description_en, description_display_es, description_display_en,
      description_summary_es, description_summary_en, search_document, embedding_version, enrichment_status, image_url FROM events WHERE id = ?`).bind(event).first()
    const { image_url: _, ...before } = (await read())!
    await run(submitCandidateEffect(store, candidateInput(candidate, post, venueId, { intent: 'update', target_event_id: event, artwork_media_id })))
    const preview = await run(previewCandidateEffect(store, candidate))
    const image_url = `https://baeventos.com/api/event-artwork/${event}/${image.object_key}`
    expect(preview).toMatchObject({ action: 'update', reasons: [], payload: { ...before, image_url } })
    const unexpected = async () => { throw new Error('An artwork-only update must not call providers') }
    expect(await run(commitPlanEffect(store, preview.id, { embed: unexpected, presentation: unexpected }))).toMatchObject({ action: 'update', event_id: event })
    expect(await read()).toEqual({ ...before, image_url })
    expect(artwork.objects.has(image.object_key)).toBe(true)
    expect(await db.prepare('SELECT count(*) AS n FROM vector_sync').first()).toEqual({ n: 0 })

    const repaired = buildSearchDocument({ name: 'Synthetic Jazz', description_es: 'Texto original', description_en: 'Original text',
      categories: ['music'], venue_name: 'Synthetic Venue', venue_neighborhood: 'Palermo' })
    const embed = vi.fn(async (input: Parameters<typeof buildSearchDocument>[0]) => ({ embedding: [0.5], searchDocument: buildSearchDocument(input) }))
    const options = { embed, embedText: unexpected }
    expect(await reconcileCatalog(db, vectors.index, options)).toMatchObject({ reembedded: 1, resynced: 0, restored: 0 })
    expect(await read()).toEqual({ ...before, image_url, search_document: repaired, embedding_version: CURRENT_EMBEDDING_VERSION })
    expect(vectors.vectors.get(event)?.values[0]).toBe(0.5)
    expect(await reconcileCatalog(db, vectors.index, options)).toMatchObject({ reembedded: 0, resynced: 0, restored: 0, metadataUpdated: 0 })
    expect(embed).toHaveBeenCalledTimes(1)

    await db.prepare("UPDATE events SET name = 'Unaccepted name', search_document = 'Unaccepted search text', embedding_version = 1 WHERE id = ?").bind(event).run()
    expect(await db.prepare('SELECT name, search_document, embedding_version FROM events WHERE id = ?').bind(event).first())
      .toEqual({ name: 'Synthetic Jazz', search_document: repaired, embedding_version: CURRENT_EMBEDDING_VERSION })
  })

  it('re-embeds changed search inputs without regenerating unchanged description presentation', async () => {
    await source()
    const post = await observation((await run(store.reserveCollection)).id)
    const candidate = id(), venueId = await venue(), event = id()
    const startsAt = new Date(`${shiftDay(baToday(), 5)}T21:00:00-03:00`).toISOString()
    await db.prepare(`INSERT INTO events (id, name, starts_at, venue_id, source, categories, description_es, description_summary_es, search_document)
      VALUES (?, 'Old title', ?, ?, 'luma', '["music"]', 'Texto original', 'Resumen guardado', 'Old document')`).bind(event, startsAt, venueId).run()
    const input = candidateInput(candidate, post, venueId, { intent: 'update', target_event_id: event })
    await run(submitCandidateEffect(store, input))
    const preview = await run(previewCandidateEffect(store, candidate))
    await run(commitPlanEffect(store, preview.id, { ...publishers, presentation: async () => { throw new Error('Unchanged description') } }))
    const result = () => db.prepare('SELECT description_summary_es, search_document FROM events WHERE id = ?').bind(event).first()
    expect(await result()).toEqual({ description_summary_es: 'Resumen guardado', search_document: 'Synthetic Jazz | Synthetic Venue' })

    const revised = { ...input, expected_revision: 1, description_es: 'Texto nuevo',
      evidence: [{ ...input.evidence[0], fields: [...input.evidence[0].fields, 'description'] }] }
    await run(submitCandidateEffect(store, revised))
    const next = await run(previewCandidateEffect(store, candidate))
    await run(commitPlanEffect(store, next.id, {
      embed: async ({ description_es }) => ({ embedding: Array(1536).fill(0.3), searchDocument: `${description_es} | Synthetic Venue` }),
      presentation: async ({ description_es }) => ({ description_summary_es: `${description_es} resumido`, description_summary_en: null,
        description_display_es: description_es ?? null, description_display_en: null }),
    }))
    expect(await result()).toEqual({ description_summary_es: 'Texto nuevo resumido', search_document: 'Texto nuevo | Synthetic Venue' })
  })

  it('names the path and options when an evidence field uses a catalog column name', async () => {
    const obs = { observation_id: id(), fields: ['name'], excerpt: 'Synthetic Jazz', media_id: null }
    const evidence = [obs, obs, { kind: 'official_page', fields: ['ticket_url'], excerpt: 'Entradas disponibles', url: 'https://example.org/show' }]
    expect(await fails(submitCandidateEffect(store, candidateInput(id(), obs.observation_id, null, { evidence }))))
      .toBe('Invalid candidate: evidence[2].fields[0]: expected one of name, date, time, venue, price, status, description, ticket, organizer, performers, offers_valid_from, doors_time; got "ticket_url"')
  })

  it('publishes credited people, then adds next-day doors to an existing event without inventing a start', async () => {
    await source()
    const venueId = await venue()
    const ticket = 'https://tickets.example/first'
    const excerpt = `Synthetic Jazz — organiza Nube, toca Trío Sol. Entradas a la venta desde el 20/11 a las 15:00: ${ticket}\nPuerta: 00.30 hs.`
    const runId = (await run(store.reserveCollection)).id
    const post = await observation(runId, excerpt)
    const candidate = id(), day = shiftDay(baToday(), 5), doorsDate = shiftDay(day, 1)
    const evidence = (fields: string[]) => [{ observation_id: post, fields: ['name', 'date', 'venue', ...fields], excerpt, media_id: null }]
    const base = { date: day, time: null }
    const validFrom = '2026-11-20T18:00:00.000Z'
    await run(submitCandidateEffect(store, candidateInput(candidate, post, venueId, { ...base, organizer: { name: 'Nube' },
      performers: [{ name: 'Trío Sol' }], offers_valid_from: validFrom,
      evidence: evidence(['organizer', 'performers', 'offers_valid_from']) })))
    const create = await run(previewCandidateEffect(store, candidate))
    expect(create).toMatchObject({ action: 'create', reasons: [] })
    await run(commitPlanEffect(store, create.id, publishers))

    await run(submitCandidateEffect(store, candidateInput(candidate, post, venueId, { ...base, expected_revision: 1, intent: 'update',
      target_event_id: create.event_id, doors_time: '00:30', doors_date: doorsDate, ticket_url: ticket, evidence: evidence(['doors_time', 'ticket']) })))
    const correction = await run(previewCandidateEffect(store, candidate))
    expect(correction).toMatchObject({ action: 'update', reasons: [], event_id: create.event_id })
    await run(commitPlanEffect(store, correction.id, publishers))
    await db.prepare('UPDATE events SET doors_at = NULL, organizer_name = NULL WHERE id = ?').bind(create.event_id).run()
    expect(await db.prepare('SELECT starts_at, time_tba, doors_at, organizer_name, performers, offers_valid_from, ticket_url FROM events WHERE id = ?').bind(create.event_id).first())
      .toEqual({ starts_at: `${day}T03:00:00.000Z`, time_tba: 1, doors_at: `${doorsDate}T03:30:00.000Z`, organizer_name: 'Nube',
        performers: JSON.stringify([{ name: 'Trío Sol' }]), offers_valid_from: validFrom, ticket_url: ticket })

    const newDate = shiftDay(day, 7), newTicket = 'https://tickets.example/replacement'
    const updateExcerpt = `Synthetic Jazz, reprogramado al ${newDate}. Nueva reserva: ${newTicket}`
    const updatePost = await observation(runId, updateExcerpt, 'synthetic-reschedule')
    await run(submitCandidateEffect(store, candidateInput(candidate, updatePost, venueId, { ...base, date: newDate, expected_revision: 2,
      intent: 'update', target_event_id: create.event_id, ticket_url: newTicket,
      evidence: [{ observation_id: updatePost, fields: ['name', 'date', 'venue', 'ticket'], excerpt: updateExcerpt, media_id: null }] })))
    const reschedule = await run(previewCandidateEffect(store, candidate))
    expect(reschedule).toMatchObject({ action: 'update', reasons: [] })
    await run(commitPlanEffect(store, reschedule.id, publishers))
    expect(await db.prepare('SELECT starts_at, ticket_url, offers_valid_from, doors_at, organizer_name FROM events WHERE id = ?').bind(create.event_id).first())
      .toEqual({ starts_at: `${newDate}T03:00:00.000Z`, ticket_url: newTicket, offers_valid_from: null, doors_at: null, organizer_name: 'Nube' })
  })

  it.each(['20:00', '21:00', '22:00'])('checks doors at %s against a kept verified start and end', async doors_time => {
    await source()
    const runId = (await run(store.reserveCollection)).id
    const venueId = await venue(), candidate = id(), event = id(), date = shiftDay(baToday(), 5)
    const starts_at = new Date(`${date}T21:00:37-03:00`).toISOString()
    const ends_at = new Date(`${date}T23:30:00-03:00`).toISOString()
    await db.prepare(`INSERT INTO events (id, name, starts_at, ends_at, venue_id, source, categories, search_document) VALUES
      (?, 'Synthetic Jazz', ?, ?, ?, 'instagram', '["music"]', 'Existing search')`).bind(event, starts_at, ends_at, venueId).run()
    const excerpt = `Synthetic Jazz — Puerta ${doors_time}`
    const post = await observation(runId, excerpt)
    await run(submitCandidateEffect(store, candidateInput(candidate, post, venueId, { intent: 'update', target_event_id: event, date, time: null,
      doors_time, evidence: [{ observation_id: post, fields: ['name', 'date', 'venue', 'doors_time'], excerpt, media_id: null }] })))
    const preview = await run(previewCandidateEffect(store, candidate))
    if (doors_time === '22:00') {
      expect(preview).toMatchObject({ action: 'held', reasons: ['Doors cannot follow the known start time'] })
    } else if (doors_time === '21:00') {
      expect(preview).toMatchObject({ action: 'held', reasons: ['Equal doors and start times need two separate clocks in the doors excerpt'] })
    } else {
      expect(preview).toMatchObject({ action: 'update', payload: { starts_at, ends_at, time_tba: false } })
      const noProvider = async () => { throw new Error('A doors-only update must not call a provider') }
      await run(commitPlanEffect(store, preview.id, { embed: noProvider, presentation: noProvider }))
    }
    expect(await db.prepare('SELECT starts_at, ends_at, time_tba, doors_at FROM events WHERE id = ?').bind(event).first()).toEqual({
      starts_at, ends_at, time_tba: 0, doors_at: doors_time === '20:00' ? new Date(`${date}T20:00:00-03:00`).toISOString() : null,
    })
  })

  it.each([false, true])('checks a new start against retained doors (two clocks quoted: %s)', async both => {
    await source()
    const venueId = await venue(), candidate = id(), event = id(), date = shiftDay(baToday(), 5)
    const oldStart = new Date(`${date}T00:00:00-03:00`).toISOString()
    const doors = new Date(`${date}T21:00:00-03:00`).toISOString()
    await db.prepare(`INSERT INTO events (id, name, starts_at, time_tba, doors_at, venue_id, source, categories)
      VALUES (?, 'Synthetic Jazz', ?, 1, ?, ?, 'instagram', '["music"]')`).bind(event, oldStart, doors, venueId).run()
    // An explicit entry label would already be rejected as a start before the retained-doors check runs.
    const excerpt = both ? 'Synthetic Jazz — Puertas 21 hs. Show 21 hs.' : 'Synthetic Jazz — 21 hs.'
    const post = await observation((await run(store.reserveCollection)).id, excerpt)
    await run(submitCandidateEffect(store, candidateInput(candidate, post, venueId, { intent: 'update', target_event_id: event, date,
      evidence: [{ observation_id: post, fields: ['name', 'date', 'time', 'venue'], excerpt, media_id: null }] })))
    const preview = await run(previewCandidateEffect(store, candidate))
    if (both) {
      expect(preview).toMatchObject({ action: 'update', reasons: [] })
      await run(commitPlanEffect(store, preview.id, publishers))
    } else {
      const reason = 'Equal retained doors and start times need two separate clocks in one excerpt'
      expect(preview).toMatchObject({ action: 'held', reasons: [reason] })
      const bypass = await run(store.insertPlan({ candidate_id: candidate, revision: 1, action: 'update', event_id: event,
        expected_event_updated_at: (await db.prepare('SELECT updated_at FROM events WHERE id = ?').bind(event).first<string>('updated_at'))!,
        payload: preview.payload, artwork_media_id: null, artwork_note: 'No retained image', reasons: [],
        evidence: [...preview.evidence, { kind: 'official_page', url: 'https://sala.example.org/show', fields: ['time'], excerpt: `${date} 21:00 - 21:00` }] }))
      expect(await fails(store.commitPlan(bypass.id))).toContain(reason)
    }
    expect(await db.prepare('SELECT starts_at, time_tba, doors_at FROM events WHERE id = ?').bind(event).first())
      .toEqual({ starts_at: both ? doors : oldStart, time_tba: both ? 0 : 1, doors_at: doors })
  })

  it('refuses a prepared ticket replacement without direct ticket evidence and keeps the protected opening time', async () => {
    await source()
    const runId = (await run(store.reserveCollection)).id
    const venueId = await venue(), candidate = id(), date = shiftDay(baToday(), 5)
    const ticket_url = 'https://tickets.example/original', offers_valid_from = '2026-11-20T18:00:00.000Z'
    const excerpt = `Synthetic Jazz. Entradas a la venta desde el 20/11 a las 15:00: ${ticket_url}`
    const post = await observation(runId, excerpt)
    const evidence = [{ observation_id: post, fields: ['name', 'date', 'venue', 'ticket', 'offers_valid_from'], excerpt, media_id: null }]
    await run(submitCandidateEffect(store, candidateInput(candidate, post, venueId, { date, time: null, ticket_url, offers_valid_from, evidence })))
    const create = await run(previewCandidateEffect(store, candidate))
    await run(commitPlanEffect(store, create.id, publishers))
    await run(submitCandidateEffect(store, candidateInput(candidate, post, venueId, { date, time: null, expected_revision: 1,
      intent: 'update', target_event_id: create.event_id, evidence: [{ ...evidence[0], fields: ['name', 'date', 'venue'] }] })))
    const update = await run(previewCandidateEffect(store, candidate))
    expect(update.action).toBe('update')
    await run(store.preparePlan(update.id, { ...update.payload, ticket_url: 'https://tickets.example/unsupported' }))
    expect(await fails(store.commitPlan(update.id))).toContain('Correction field lacks current direct evidence: ticket')
    expect(await db.prepare('SELECT ticket_url, offers_valid_from FROM events WHERE id = ?').bind(create.event_id).first()).toEqual({ ticket_url, offers_valid_from })
  })

  it.each([
    ['http://www.tickets.example/replacement/?utm_source=instagram&fbclid=synthetic', 'https://tickets.example/replacement', true, null],
    ['https://tickets.example/original', 'https://tickets.example/replacement', false, null],
    ['https://tickets.example/replacement-extra', 'https://tickets.example/replacement', false, null],
    ['https://tickets.example/replacement-extra', 'https://tickets.example/replacement', false, 'https://tickets.example/replacement'],
    ['https://tickets.example/replacement?id=2', 'https://tickets.example/replacement?id=1', false, null],
    ['https://tickets.example/replacement', 'https://tickets.example/original', false, null],
  ])('requires the exact destination in %s when writing %s (%s, quote %s)', async (citedUrl, proposedUrl, supported, ticketQuote) => {
    await source()
    const runId = (await run(store.reserveCollection)).id
    const venueId = await venue(), candidate = id(), event = id(), date = shiftDay(baToday(), 5)
    const starts_at = new Date(`${date}T00:00:00-03:00`).toISOString()
    const ticket_url = 'https://tickets.example/original', offers_valid_from = '2026-11-20T18:00:00.000Z'
    const replacementOpening = '2026-11-21T18:00:00.000Z'
    await db.prepare(`INSERT INTO events (id, name, venue_id, starts_at, time_tba, ticket_url, offers_valid_from, source, categories)
      VALUES (?, 'Synthetic Jazz', ?, ?, 1, ?, ?, 'instagram', '["music"]')`).bind(event, venueId, starts_at, ticket_url, offers_valid_from).run()
    const excerpt = `Synthetic Jazz. Entradas a la venta desde el 21/11 a las 15:00: ${citedUrl}.`
    const post = await observation(runId, excerpt)
    const evidence = [
      { observation_id: post, fields: ['name', 'date', 'venue', 'offers_valid_from'], excerpt, media_id: null },
      { observation_id: post, fields: ['ticket'], excerpt: ticketQuote ?? excerpt, media_id: null },
    ]
    await run(submitCandidateEffect(store, candidateInput(candidate, post, venueId, { date, time: null, intent: 'update',
      target_event_id: event, ticket_url: proposedUrl, offers_valid_from: replacementOpening, evidence })))
    const preview = await run(previewCandidateEffect(store, candidate))
    if (supported) {
      expect(preview.action).toBe('update')
      await run(commitPlanEffect(store, preview.id, publishers))
    } else {
      expect(preview.action).toBe('held')
      // Even a prepared update with a direct ticket tag cannot bypass the destination check.
      const bypass = await run(store.insertPlan({ candidate_id: candidate, revision: 1, action: 'update', event_id: event,
        expected_event_updated_at: (await db.prepare('SELECT updated_at FROM events WHERE id = ?').bind(event).first<string>('updated_at'))!,
        payload: { ...preview.payload, starts_at }, artwork_media_id: null, artwork_note: 'No retained image', evidence: preview.evidence, reasons: [] }))
      expect(await fails(store.commitPlan(bypass.id))).toContain('Correction field lacks current direct evidence: ticket')
    }
    expect(await db.prepare('SELECT ticket_url, offers_valid_from FROM events WHERE id = ?').bind(event).first())
      .toEqual(supported ? { ticket_url: proposedUrl, offers_valid_from: replacementOpening } : { ticket_url, offers_valid_from })
  })

  it.each([['www.passline.com/evento/sintetico', 'https://passline.com/evento/sintetico'],
    ['passline.com/evento/sintetico', 'https://passline.com/evento/sintetico'], ['link en bio', null]])(
    'creates from a caption with %s and stores %s', async (text, ticket_url) => {
      await source()
      const venueId = await venue(), candidate = id()
      const excerpt = `Synthetic Jazz. Entradas: ${text}`
      const post = await observation((await run(store.reserveCollection)).id, excerpt)
      await run(submitCandidateEffect(store, candidateInput(candidate, post, venueId, { time: null, ticket_url, evidence: [
        { observation_id: post, fields: ['name', 'date', 'venue', ...(ticket_url ? ['ticket'] : [])], excerpt, media_id: null },
      ] })))
      const preview = await run(previewCandidateEffect(store, candidate))
      expect(preview).toMatchObject({ action: 'create', reasons: [] })
      await run(commitPlanEffect(store, preview.id, publishers))
      expect(await db.prepare('SELECT ticket_url FROM events WHERE id = ?').bind(preview.event_id).first()).toEqual({ ticket_url })
    })

  it.each([true, false])('requires a verified official ticket page to match the create destination (matches: %s)', async matches => {
    await source()
    const venueId = await venue(), candidate = id()
    const excerpt = 'Synthetic Jazz en Synthetic Venue', pageExcerpt = 'Reservas para Synthetic Jazz'
    const post = await observation((await run(store.reserveCollection)).id, excerpt)
    const url = 'https://passline.com/evento/sintetico'
    const ticket_url = matches ? 'https://www.passline.com/evento/sintetico/' : `${url}-otro`
    await run(submitCandidateEffect(store, candidateInput(candidate, post, venueId, { time: null, ticket_url, evidence: [
      { observation_id: post, fields: ['name', 'date', 'venue'], excerpt, media_id: null },
      { kind: 'official_page', url, fields: ['ticket'], excerpt: pageExcerpt },
    ] })))
    const readPage = async () => ({ visible: pageExcerpt, h1: 'Synthetic Jazz', title: null })
    const preview = await run(previewCandidateEffect(store, candidate, new Date(), readPage))
    if (matches) {
      expect(preview).toMatchObject({ action: 'create', reasons: [] })
      const unverifiedPage = async () => ({ visible: 'Otras reservas', h1: 'Synthetic Jazz', title: null })
      expect(await fails(commitPlanEffect(store, preview.id, { ...publishers, readPage: unverifiedPage }))).toContain("must be an excerpt of the page's visible text")
      await run(commitPlanEffect(store, preview.id, { ...publishers, readPage }))
      expect(await db.prepare('SELECT ticket_url FROM events WHERE id = ?').bind(preview.event_id).first()).toEqual({ ticket_url })
    } else {
      expect(preview).toMatchObject({ action: 'held', reasons: ['Ticket evidence must quote the complete destination URL'] })
    }
  })

  it.each([
    { scenario: 'rejects a tag-only unrelated host', ticketUrl: 'https://unrelated.example/sintetico', allowed: false },
    { scenario: 'accepts a quoted whole seller link', ticketUrl: 'https://passline.com/evento/sintetico', quote: 'www.passline.com/evento/sintetico', allowed: true },
    { scenario: 'accepts an unquoted known seller', ticketUrl: 'https://passline.com/evento/sintetico', allowed: true },
    { scenario: 'accepts an unquoted venue site', ticketUrl: 'https://sala.example.org/sintetico', website: 'https://www.sala.example.org', allowed: true },
  ])('$scenario in preview and commit', async ({ ticketUrl: ticket_url, quote = 'link en bio', website, allowed }) => {
    await source()
    const venueId = await venue(), candidate = id()
    if (website) await db.prepare('UPDATE venues SET website = ? WHERE id = ?').bind(website, venueId).run()
    const showExcerpt = 'Synthetic Jazz en Synthetic Venue', pageExcerpt = 'Reservas para Synthetic Jazz'
    const post = await observation((await run(store.reserveCollection)).id, `${showExcerpt}\n${quote}`)
    await run(submitCandidateEffect(store, candidateInput(candidate, post, venueId, { time: null, ticket_url, evidence: [
      { observation_id: post, fields: ['name', 'date', 'venue'], excerpt: showExcerpt, media_id: null },
      { observation_id: post, fields: ['ticket'], excerpt: quote, media_id: null },
      { kind: 'official_page', url: ticket_url, fields: ['ticket'], excerpt: pageExcerpt },
    ] })))
    const readPage = vi.fn(async () => ({ visible: pageExcerpt, h1: 'Synthetic Jazz', title: null }))
    const preview = await run(previewCandidateEffect(store, candidate, new Date(), readPage))
    if (allowed) {
      expect(preview).toMatchObject({ action: 'create', reasons: [] })
      await run(commitPlanEffect(store, preview.id, { ...publishers, readPage }))
      expect(readPage).toHaveBeenCalledTimes(2)
      expect(await db.prepare('SELECT ticket_url FROM events WHERE id = ?').bind(preview.event_id).first()).toEqual({ ticket_url })
    } else {
      const reason = "Official page must be on the venue's website"
      expect.soft(preview).toMatchObject({ action: 'held', reasons: [expect.stringContaining(reason)] })
      // Commit must reject a prepared plan independently of the preview outcome.
      const bypass = await run(store.insertPlan({ candidate_id: candidate, revision: 1, action: 'create', event_id: preview.event_id,
        expected_event_updated_at: null, payload: preview.payload, artwork_media_id: null, evidence: preview.evidence, reasons: [] }))
      await expect(run(commitPlanEffect(store, bypass.id, { ...publishers, readPage }))).rejects.toThrow(reason)
      expect(readPage).not.toHaveBeenCalled()
      expect(await db.prepare('SELECT id FROM events WHERE id = ?').bind(preview.event_id).first()).toBeNull()
    }
  })

  it('holds a new ticket link when its caption excerpt cuts the URL short', async () => {
    await source()
    const venueId = await venue(), candidate = id()
    const ticket_url = 'https://tickets.example/replacement'
    const caption = `Synthetic Jazz. Entradas: ${ticket_url}-extra`
    const post = await observation((await run(store.reserveCollection)).id, caption)
    await run(submitCandidateEffect(store, candidateInput(candidate, post, venueId, { time: null, ticket_url, evidence: [
      { observation_id: post, fields: ['name', 'date', 'venue'], excerpt: caption, media_id: null },
      { observation_id: post, fields: ['ticket'], excerpt: ticket_url, media_id: null },
    ] })))
    expect(await run(previewCandidateEffect(store, candidate))).toMatchObject({ action: 'held',
      reasons: ['Ticket evidence must quote the complete destination URL'] })
  })

  it('preserves the sale opening when rewriting only the www prefix on a ticket', async () => {
    await source()
    const venueId = await venue(), candidate = id(), event = id(), date = shiftDay(baToday(), 5)
    const startsAt = new Date(`${date}T21:00:00-03:00`).toISOString()
    const post = await observation((await run(store.reserveCollection)).id)
    const opening = '2026-11-20T18:00:00.000Z'
    await db.prepare(`INSERT INTO events (id, name, starts_at, venue_id, source, categories, ticket_url, offers_valid_from)
      VALUES (?, 'Synthetic Jazz', ?, ?, 'instagram', '["music"]', 'https://tickets.example/original', ?)`).bind(event, startsAt, venueId, opening).run()
    const input = candidateInput(candidate, post, venueId, { intent: 'update', target_event_id: event, date, ticket_url: 'https://www.tickets.example/original' })
    await run(submitCandidateEffect(store, { ...input, evidence: [{ ...input.evidence[0], fields: [...input.evidence[0].fields, 'ticket'] }] }))
    const preview = await run(previewCandidateEffect(store, candidate))
    expect(preview.action).toBe('update')
    await run(commitPlanEffect(store, preview.id, publishers))
    expect(await db.prepare('SELECT offers_valid_from FROM events WHERE id = ?').bind(event).first('offers_valid_from')).toBe(opening)
  })

  it('holds a venue credit using the looked-up venue name even when the candidate omits it', async () => {
    await source()
    const venueId = await venue(), candidate = id()
    const excerpt = 'Synthetic Jazz — presenta Synthetic Venue'
    const post = await observation((await run(store.reserveCollection)).id, excerpt)
    await run(submitCandidateEffect(store, candidateInput(candidate, post, venueId, { venue_name: null, time: null,
      organizer: { name: 'Synthetic Venue' }, evidence: [{ observation_id: post, fields: ['name', 'date', 'venue', 'organizer'], excerpt, media_id: null }] })))
    expect(await run(previewCandidateEffect(store, candidate))).toMatchObject({ action: 'held',
      reasons: ['A ticket seller or the venue itself cannot be credited as organizer: Synthetic Venue'] })
  })

  it('refuses a candidate whose venue_id or target_event_id is not in the catalog, naming the ID, and stores nothing', async () => {
    await source()
    const post = await observation((await run(store.reserveCollection)).id)
    const missing = id(), candidate = id()
    expect(await fails(submitCandidateEffect(store, candidateInput(candidate, post, missing))))
      .toBe(`venue_id ${missing} is not a catalog venue; copy the ID from lookup`)
    expect(await fails(submitCandidateEffect(store, candidateInput(candidate, post, await venue(), { intent: 'update', target_event_id: missing }))))
      .toBe(`target_event_id ${missing} is not a catalog event; copy the ID from lookup`)
    expect(await db.prepare('SELECT count(*) AS n FROM intake_candidates').first()).toEqual({ n: 0 })
  })

  it('names the IDs in preview reasons for a deleted venue and for evidence pointing at two events', async () => {
    await source()
    const post = await observation((await run(store.reserveCollection)).id)
    const venueId = await venue()
    const at = new Date(`${shiftDay(baToday(), 5)}T21:00:00-03:00`).toISOString()
    const linked = id(), target = id(), candidate = id()
    for (const event of [linked, target]) {
      await db.prepare("INSERT INTO events (id, name, starts_at, venue_id, source) VALUES (?, 'Synthetic Jazz', ?, ?, 'luma')").bind(event, at, venueId).run()
    }
    await run(submitCandidateEffect(store, candidateInput(candidate, post, venueId, { intent: 'link', target_event_id: target })))
    await db.prepare("INSERT INTO event_source_evidence (event_id, candidate_id, observation_id, revision) VALUES (?, ?, ?, 1)").bind(linked, candidate, post).run()
    expect((await run(previewCandidateEffect(store, candidate))).reasons)
      .toEqual([`Evidence points to multiple catalog events: ${linked}, ${target} (already linked: ${linked}; target_event_id: ${target})`])

    await db.prepare('PRAGMA foreign_keys = OFF').run()
    await db.prepare('DELETE FROM venues WHERE id = ?').bind(venueId).run()
    expect((await run(previewCandidateEffect(store, candidate))).reasons).toContain(`Selected venue does not exist: ${venueId}`)
  })

  it('previews a same-day event at the venue as a link and commits it without a new event or vector', async () => {
    await source()
    const runId = (await run(store.reserveCollection)).id
    const venueId = await venue()
    const post = await observation(runId)
    const day = shiftDay(baToday(), 5)
    const listed = id()
    await db.prepare("INSERT INTO events (id, name, starts_at, venue_id, source) VALUES (?, 'SYNTHETIC JAZZ', ?, ?, 'luma')")
      .bind(listed, new Date(`${day}T21:00:00-03:00`).toISOString(), venueId).run()
    const candidate = id()
    await run(submitCandidateEffect(store, candidateInput(candidate, post, venueId, { artwork_note: undefined })))
    const preview = await run(previewCandidateEffect(store, candidate))
    expect(preview).toMatchObject({ action: 'link', event_id: listed })
    expect(await run(commitPlanEffect(store, preview.id, publishers))).toMatchObject({ action: 'link', event_id: listed })
    expect((await db.prepare('SELECT count(*) AS n FROM events').first<{ n: number }>())!.n).toBe(1)
    expect(vectors.vectors.size).toBe(0)
    expect(await db.prepare('SELECT count(*) AS n FROM event_intake_protection').first()).toEqual({ n: 0 })
  })

  it('publishes a date and time that only the official page states, and refuses it once the page drops them', async () => {
    await source()
    const runId = (await run(store.reserveCollection)).id
    const venueId = await venue()
    await db.prepare("UPDATE venues SET website = 'https://www.teatro.example.org' WHERE id = ?").bind(venueId).run()
    const post = await observation(runId, 'Synthetic Jazz en Synthetic Venue, entradas en la web')
    const day = shiftDay(baToday(), 5)
    const url = 'https://teatro.example.org/obra/synthetic-jazz/'
    const shell = '<html><body><h1>Synthetic Jazz</h1><div id="performances"></div></body></html>'
    let html = shell
    let rendered = `Synthetic Jazz\n${day} 21:00`
    let renders = 0
    const readPage = async (requested: string, sites: ReadonlySet<string>) => {
      expect(requested).toBe(url)
      expect(sites.has('example.org')).toBe(true)
      return readOfficialPage(requested, sites, (async () => new Response(html, { headers: { 'Content-Type': 'text/html' } })) as typeof fetch)
    }
    const candidate = id()
    await run(submitCandidateEffect(store, candidateInput(candidate, post, venueId, { evidence: [
      { observation_id: post, fields: ['name', 'venue'], excerpt: 'Synthetic Jazz en Synthetic Venue', media_id: null },
      { kind: 'official_page', url, fields: ['date', 'time'], excerpt: `${day} 21:00` },
    ] })))
    const renderPage = async () => { renders++; return { visible: rendered, title: null, h1: 'Synthetic Jazz', url } }
    const preview = await run(previewCandidateEffect(store, candidate, new Date(), readPage, renderPage))
    expect(preview).toMatchObject({ action: 'create', reasons: [] })
    expect(renders).toBe(1)

    rendered = 'Funciones agotadas'
    expect(await fails(commitPlanEffect(store, preview.id, { ...publishers, readPage }, renderPage)))
      .toBe(`Official page evidence must be an excerpt of the page's visible text: ${url}`)
    expect(renders).toBe(2)
    html = `<html><body><h1>Agenda</h1><p>Synthetic Jazz: ${day} 21:00</p></body></html>`
    expect(await fails(commitPlanEffect(store, preview.id, { ...publishers, readPage })))
      .toBe(`Official page does not name "Synthetic Jazz" (H1: "Agenda"): ${url}`)
    html = `<html><head><title>Synthetic Jazz</title></head><body><p>${day} 21:00</p></body></html>`
    const receipt = await run(commitPlanEffect(store, preview.id, { ...publishers, readPage }))
    expect(receipt).toMatchObject({ action: 'create', event_id: preview.event_id })
    expect((await db.prepare('SELECT observation_id FROM event_source_evidence').all()).results).toEqual([{ observation_id: post }])
  })

  it('resolves venues: creates with evidence, finds it again, fills an empty barrio, and stops on a lookalike', async () => {
    const geocode = (address: string) => Effect.succeed({ lat: '0', lon: '0', display_name: 'synthetic',
      address: { state: 'Ciudad Autónoma de Buenos Aires', suburb: 'Almagro', country_code: 'ar',
        ...(address === 'Calle Otra 55' ? { road: 'Calle Otra', house_number: '55' } : { road: 'Avenida Ficticia', house_number: '1234' }) } })
    const request = (fields: Record<string, unknown> = {}) => decodeVenueRequest({ name: 'Sala Sintética', address: 'Av. Ficticia 1234',
      neighborhood: 'Almagro', evidence: [{ url: 'https://example.org/sala', confirms: 'name and address on the official site' }], ...fields })
    const created = await run(resolveIntakeVenueEffect(store, request(), { geocode }))
    expect(created).toMatchObject({ outcome: 'created', venue: { name: 'Sala Sintética', neighborhood: 'Almagro', address: 'Av. Ficticia 1234' } })
    expect(await run(resolveIntakeVenueEffect(store, request(), { geocode }))).toMatchObject({ outcome: 'existing' })
    const log = await db.prepare("SELECT source, status, final_venue_id FROM venue_review_queue").all()
    expect(log.results).toEqual([{ source: 'instagram-intake', status: 'approved', final_venue_id: (created as { venue: { id: string } }).venue.id }])

    const empty = await venue('Teatro Vacío', null, null)
    expect(await run(resolveIntakeVenueEffect(store, request({ name: 'Teatro Vacío', address: 'Calle Otra 55' }), { geocode })))
      .toMatchObject({ outcome: 'existing', venue: { id: empty, neighborhood: 'Almagro', address: 'Calle Otra 55' }, completed: ['address', 'neighborhood'] })
    expect(await run(resolveIntakeVenueEffect(store, request({ name: 'Sala Sintetica 2', address: 'Lejana 900' }), { geocode })))
      .toMatchObject({ outcome: 'ambiguous' })
  })

  it('corrects a stored barrio only while it is still the old value', async () => {
    const venueId = await venue('Club Social Sintético', 'Almagro', 'Defensa 1179')
    expect(await run(store.correctVenueNeighborhood(venueId, 'Palermo', 'San Telmo'))).toEqual([])
    expect(await run(store.correctVenueNeighborhood(venueId, 'Almagro', 'San Telmo'))).toEqual([
      { id: venueId, name: 'Club Social Sintético', address: 'Defensa 1179', neighborhood: 'San Telmo' }])
  })

  it('finds venues and events by an accented fragment in any case', async () => {
    const venueId = await venue('CASA GÓMEZ')
    await db.prepare("INSERT INTO events (id, name, starts_at, venue_id, source) VALUES (?, 'Noche en Casa Gómez', '2026-11-21T00:00:00.000Z', ?, 'luma')").bind(id(), venueId).run()
    const venues = await run(store.lookupVenues('casa gómez'))
    const events = await run(store.lookupEvents('casa gómez'))
    expect(venues.map(row => row.id)).toEqual([venueId])
    expect(events).toHaveLength(1)
  })
})

describe.skipIf(bun)('source import on D1', () => {
  it('inserts new sources disabled and leaves existing ones untouched', async () => {
    await source('synthetic_venue', 'organizer', 1)
    const result = await run(importSourcesEffect(db, [
      { username: 'synthetic_venue', authority: 'curator', qualification: 'Changed' },
      { username: 'new_venue', authority: 'venue', qualification: 'Synthetic qualification' },
    ]))
    expect(result).toEqual({ received: 2, inserted: 1, already_present: 1, inserted_usernames: ['new_venue'], total_sources: 2, enabled_sources: 1 })
    expect((await db.prepare('SELECT username, authority, enabled, qualification FROM instagram_sources ORDER BY username').all()).results).toEqual([
      { username: 'new_venue', authority: 'venue', enabled: 0, qualification: 'Synthetic qualification' },
      { username: 'synthetic_venue', authority: 'organizer', enabled: 1, qualification: 'Synthetic fixture' },
    ])
  })
})
