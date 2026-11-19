/**
 * The intake on real Miniflare D1: transactional intake operations and the
 * operator flow (submit, preview, commit, venue, held) through `d1Intake`. Grants to anon/authenticated are not ported:
 * D1 has no roles, and the intake API's bearer token replaces them (intake-api.test.ts).
 */
import type { D1Database, R2Bucket } from '@cloudflare/workers-types'
import { Effect } from 'effect'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { freshD1 } from '../../../../tests/support/d1.ts'
import { fakeVectorize } from '../../../../tests/support/vectorize.ts'
import { fakeR2 } from '../../../../tests/support/r2.ts'
import { describeImage } from './collection.ts'
import { visibleText as visibleTextFor } from './official-page.ts'
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

const TABLES = ['vector_sync', 'event_intake_protection', 'event_source_evidence', 'intake_plans', 'intake_candidate_revisions', 'intake_candidates',
  'intake_media', 'intake_observations', 'intake_runs', 'instagram_sources', 'venue_review_queue', 'events', 'venues']
beforeEach(async () => {
  if (bun) return
  await db.batch([...TABLES.map(table => db.prepare(`DELETE FROM ${table}`)),
    db.prepare('UPDATE intake_policy SET collection_enabled = 1, publishing_enabled = 1, data_detail_level = ?').bind('detailedData')])
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
      const reserved = await run(store.reserveCollection())
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
    const first = await run(store.reserveCollection())
    expect(first).toMatchObject({ fresh: true, actor_build: '0.0.679', local_date: baToday(), state: 'reserved', reserved_usd: 1.5,
      input: { username: ['another_venue', 'synthetic_venue'], resultsLimit: 20, dataDetailLevel: 'basicData', skipPinnedPosts: false, includeMusicData: false } })
    const second = await run(store.reserveCollection())
    expect(second).toMatchObject({ fresh: false, id: first.id })
    expect((await db.prepare('SELECT count(*) AS n FROM intake_runs').first<{ n: number }>())!.n).toBe(1)
  })

  it('refuses a disabled switch, an exhausted month, and an empty or oversized watchlist', async () => {
    await db.prepare('UPDATE intake_policy SET collection_enabled = 0').run()
    expect(await fails(store.reserveCollection())).toBe('Instagram collection is not enabled')
    await db.prepare('UPDATE intake_policy SET collection_enabled = 1').run()
    expect(await fails(store.reserveCollection())).toBe('Source watchlist exceeds policy or is empty')
    await source(); await source('second_venue')
    await db.prepare('UPDATE intake_policy SET max_sources = 1').run()
    expect(await fails(store.reserveCollection())).toBe('Source watchlist exceeds policy or is empty')
    await db.prepare('UPDATE intake_policy SET max_sources = 200').run()
    const today = baToday()
    if (today.slice(8) !== '01') { // a run earlier this month
      await db.prepare("INSERT INTO intake_runs (id, local_date, state, reserved_usd, charged_usd, input) VALUES (?, ?, 'succeeded', 5, 17, '{}')")
        .bind(id(), `${today.slice(0, 8)}01`).run()
      expect(await fails(store.reserveCollection())).toBe('Monthly collection budget exhausted')
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
    const runId = (await run(store.reserveCollection())).id
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
    const revised = await plan(candidate, 2, 'update', event, body(venueId, { starts_at: '2026-12-02T00:00:00Z', status: 'canceled' }),
      [{ observation_id: post, fields: ['date', 'time', 'status'] }])
    expect(await run(store.commitPlan(revised))).toMatchObject({ action: 'update', previous_event: { id: event, status: 'scheduled' } })
    expect(vectors.vectors.get(event)?.metadata).toEqual({ status: 'canceled', starts_at: Date.parse('2026-12-02T00:00:00Z') })

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

  it('refuses held, expired and superseded plans, curator corrections, and a duplicate that appeared after preview', async () => {
    await source(); await source('synthetic_curator', 'curator')
    const runId = (await run(store.reserveCollection())).id
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
    const runId = (await run(store.reserveCollection())).id
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

  it('never replaces a later correction\'s vector when an older plan is committed again', async () => {
    await source()
    const runId = (await run(store.reserveCollection())).id
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
    price_kind: 'unknown', price_ars: null, price_note: null, ticket_url: null, artwork_media_id: null, issues: [], notes: '',
    evidence: [{ observation_id: post, fields: ['name', 'date', 'time', 'venue'], excerpt: 'Synthetic Jazz', media_id: null }], ...fields })
  const publishers = {
    embed: async () => ({ embedding: Array(1536).fill(0.2), searchDocument: 'Synthetic Jazz | Synthetic Venue' }),
    presentation: async () => ({ description_display_es: null, description_display_en: null, description_summary_es: null, description_summary_en: null }),
  }

  it('submits, previews, commits with retained artwork in R2, and lists the held backlog', async () => {
    await source()
    const runId = (await run(store.reserveCollection())).id
    const venueId = await venue()
    const post = await observation(runId, undefined, undefined, undefined, ['https://scontent.cdninstagram.com/v/flyer.jpg'])
    const image = await describeImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]))
    expect(await run(store.unreviewedMedia())).toEqual([{ id: post, media_urls: ['https://scontent.cdninstagram.com/v/flyer.jpg'], positions: [] }])
    await run(store.retainImage(post, 0, image))
    expect(evidence.objects.has(image.object_key)).toBe(true)
    expect(await run(store.unreviewedMedia())).toEqual([])
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
    expect(vectors.vectors.get(preview.event_id)?.values[0]).toBeCloseTo(0.2)

    // A second candidate held for its venue, with a hint from the importers' matcher.
    const other = id()
    await run(submitCandidateEffect(store, candidateInput(other, post, null, { venue_name: 'Synthetic Venue Club', name: 'Other night' })))
    const held = await run(previewCandidateEffect(store, other))
    expect(held.action).toBe('held')
    expect(held.reasons).toContain('Venue must be resolved before publishing')
    const backlog = await run(heldBacklogEffect(store))
    expect(backlog).toMatchObject({ held: 1, groups: [{ venue_name: 'Synthetic Venue Club', candidates: [{ id: other }] }] })
  })

  it('refuses a candidate whose venue_id or target_event_id is not in the catalog, naming the ID, and stores nothing', async () => {
    await source()
    const post = await observation((await run(store.reserveCollection())).id)
    const missing = id(), candidate = id()
    expect(await fails(submitCandidateEffect(store, candidateInput(candidate, post, missing))))
      .toBe(`venue_id ${missing} is not a catalog venue; copy the ID from lookup`)
    expect(await fails(submitCandidateEffect(store, candidateInput(candidate, post, await venue(), { intent: 'update', target_event_id: missing }))))
      .toBe(`target_event_id ${missing} is not a catalog event; copy the ID from lookup`)
    expect(await db.prepare('SELECT count(*) AS n FROM intake_candidates').first()).toEqual({ n: 0 })
  })

  it('names the IDs in preview reasons for a deleted venue and for evidence pointing at two events', async () => {
    await source()
    const post = await observation((await run(store.reserveCollection())).id)
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
    const runId = (await run(store.reserveCollection())).id
    const venueId = await venue()
    const post = await observation(runId)
    const day = shiftDay(baToday(), 5)
    const listed = id()
    await db.prepare("INSERT INTO events (id, name, starts_at, venue_id, source) VALUES (?, 'SYNTHETIC JAZZ', ?, ?, 'luma')")
      .bind(listed, new Date(`${day}T21:00:00-03:00`).toISOString(), venueId).run()
    const candidate = id()
    await run(submitCandidateEffect(store, candidateInput(candidate, post, venueId)))
    const preview = await run(previewCandidateEffect(store, candidate))
    expect(preview).toMatchObject({ action: 'link', event_id: listed })
    expect(await run(commitPlanEffect(store, preview.id, publishers))).toMatchObject({ action: 'link', event_id: listed })
    expect((await db.prepare('SELECT count(*) AS n FROM events').first<{ n: number }>())!.n).toBe(1)
    expect(vectors.vectors.size).toBe(0)
    expect(await db.prepare('SELECT count(*) AS n FROM event_intake_protection').first()).toEqual({ n: 0 })
  })

  it('publishes a date and time that only the official page states, and refuses it once the page drops them', async () => {
    await source()
    const runId = (await run(store.reserveCollection())).id
    const venueId = await venue()
    await db.prepare("UPDATE venues SET website = 'https://www.teatro.example.org' WHERE id = ?").bind(venueId).run()
    const post = await observation(runId, 'Synthetic Jazz en Synthetic Venue, entradas en la web')
    const day = shiftDay(baToday(), 5)
    const url = 'https://teatro.example.org/obra/synthetic-jazz/'
    let html = `<html><body><h1>Synthetic Jazz</h1><div>PRÓXIMAS FUNCIONES</div><div>${day}</div><div>21:00</div></body></html>`
    const readPage = async (requested: string, sites: ReadonlySet<string>) => { expect(requested).toBe(url); expect(sites.has('example.org')).toBe(true); return visibleTextFor(html) }
    const candidate = id()
    await run(submitCandidateEffect(store, candidateInput(candidate, post, venueId, { evidence: [
      { observation_id: post, fields: ['name', 'venue'], excerpt: 'Synthetic Jazz en Synthetic Venue', media_id: null },
      { kind: 'official_page', url, fields: ['date', 'time'], excerpt: `${day} 21:00` },
    ] })))
    const preview = await run(previewCandidateEffect(store, candidate, new Date(), readPage))
    expect(preview).toMatchObject({ action: 'create', reasons: [] })

    html = '<html><body>Funciones agotadas</body></html>'
    expect(await fails(commitPlanEffect(store, preview.id, { ...publishers, readPage })))
      .toBe(`Official page evidence must be an excerpt of the page's visible text: ${url}`)
    html = `<html><body>Synthetic Jazz: ${day} 21:00</body></html>`
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
