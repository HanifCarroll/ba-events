/**
 * The intake store on D1, R2 and Vectorize (store.ts has the port). It runs only where an env binds `DB`: the intake
 * API on `baeventos-jobs` (staging until the cutover, delivery PR 08) and the D1 tests.
 *
 * The 4 intake RPCs are ported from plpgsql (supabase/migrations/20261025205334_instagram_intake.sql and
 * 20261114190000_instagram_wider_watchlist.sql). Each write is one `db.batch()`, which D1 runs as one transaction and
 * serializes with every other write, so the Postgres advisory locks and `FOR UPDATE` have nothing left to guard. Checks
 * that must hold when the batch commits are `batchAssert` statements inside it, with the Postgres error messages. A
 * commit runs inside `intakeCommitBatch`, which sets `write_context` so the protection trigger lets it change protected
 * facts. Embeddings live in Vectorize (id = event id, metadata `{ status, starts_at }` in epoch ms, delivery PR 03).
 * A commit queues the event in `vector_sync` in the same batch and clears it once Vectorize has the vector; a failed
 * upsert is repaired by the next `commit` of the same plan or by the nightly reconcile (delivery PR 04).
 */
import type { D1Database, R2Bucket, Vectorize } from '@cloudflare/workers-types'
import { Effect } from 'effect'
import { batchAssert, intakeCommitBatch } from '#shared/lib/db/d1.server.ts'
import type { EventInsert } from '#shared/lib/types.ts'
import { importTry, ImportOperationError } from '../core/effect-utils.ts'
import { mostSimilarVenue, similarIntakeVenues } from '../core/venue-similarity-d1.ts'
import { pickVenue, venueNameKey } from '../core/venue-identity.ts'
import { baDate, type Media } from './planning.ts'
import type { Source } from './schema.ts'
import type { IntakePlanRow, IntakePolicy, IntakeStore, Reservation, VenueRow } from './store.ts'

type Row = Record<string, unknown>
export type IntakeBindings = { db: D1Database; evidence: R2Bucket; artwork: R2Bucket; vectors: Vectorize }

/** The site's artwork route for an R2 artwork key, the URL form the copy tool writes (docs/d1.md). */
export const SITE_ORIGIN = 'https://baeventos.com'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const now = () => new Date().toISOString()
const iso = (value: unknown) => value === null || value === undefined ? null : new Date(value as string).toISOString()
const failure = (operation: string, message: string) => new ImportOperationError({ operation, message })

/** A failed `batchAssert` aborts with its reason; D1 wraps it as `D1_ERROR: <reason>: SQLITE_CONSTRAINT…`. */
export function d1Message(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.match(/^(?:D1_ERROR: )?(.*?): SQLITE_CONSTRAINT(?: \(extended: SQLITE_CONSTRAINT_TRIGGER\))?$/)?.[1] ?? message
}
const d1 = <A>(operation: string, run: () => Promise<A>) => importTry(operation, run).pipe(
  Effect.mapError(error => failure(operation, d1Message(error.cause ?? error))))

const BOOLEANS = ['enabled', 'publishing_enabled', 'collection_enabled', 'is_all_day', 'is_free', 'location_hidden', 'location_tba',
  'description_unavailable', 'time_tba']
const JSON_COLUMNS = ['input', 'media_urls', 'payload', 'evidence', 'reasons', 'receipt', 'categories', 'facets', 'enrichment_provenance', 'fields']
/** A D1 row as Postgres returned it through PostgREST: 0/1 as booleans and JSON text parsed. */
export function decodeRow<T = Row>(row: Row): T {
  const out: Row = { ...row }
  for (const key of BOOLEANS) if (typeof out[key] === 'number') out[key] = out[key] === 1
  for (const key of JSON_COLUMNS) if (typeof out[key] === 'string') out[key] = JSON.parse(out[key] as string)
  return out as T
}
const all = async <T = Row>(statement: ReturnType<D1Database['prepare']>) => (await statement.all<Row>()).results.map(row => decodeRow<T>(row))
const first = async <T = Row>(statement: ReturnType<D1Database['prepare']>) => {
  const row = await statement.first<Row>()
  return row ? decodeRow<T>(row) : null
}
const bit = (value: unknown) => value === null || value === undefined ? null : value ? 1 : 0
const json = (value: unknown) => value === undefined ? null : JSON.stringify(value)

/** Postgres jsonb equality: the same values whatever the key order. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Row)[key])]))
  return value
}
const sameJson = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))

const PROTECTED_FIELDS = ['name', 'starts_at', 'ends_at', 'time_tba', 'venue_id', 'price', 'is_free', 'status', 'image_url', 'image_width',
  'image_height', 'description_es', 'description_en', 'description_display_es', 'description_display_en', 'description_summary_es',
  'description_summary_en', 'categories', 'ticket_url', 'facets', 'embedding', 'embedding_version', 'search_document']

export function d1Intake({ db, evidence, artwork, vectors }: IntakeBindings, siteOrigin = SITE_ORIGIN): IntakeStore {
  const planRow = (id: string) => first<IntakePlanRow>(db.prepare('SELECT * FROM intake_plans WHERE id = ?').bind(id))
  const readPlan = (id: string) => d1('intake.plan', async () => {
    const plan = await planRow(id)
    if (!plan) throw new Error('Plan not found')
    return plan
  })

  /** check_intake_plan's conditions, in its order, as batch preconditions evaluated when the batch runs. */
  const planChecks = (plan: IntakePlanRow, at: string) => [
    batchAssert(db, 'Publishing is not enabled', '(SELECT publishing_enabled FROM intake_policy WHERE id = 1) = 1'),
    batchAssert(db, 'Plan is held or expired', "? <> 'held' AND (SELECT expires_at FROM intake_plans WHERE id = ?) >= ?", plan.action, plan.id, at),
    batchAssert(db, 'Candidate changed after preview', '(SELECT revision FROM intake_candidates WHERE id = ?) = ?', plan.candidate_id, plan.revision),
    ...plan.action === 'create' ? [] : [batchAssert(db, 'Catalog changed after preview',
      'EXISTS (SELECT 1 FROM events WHERE id = ? AND updated_at IS ?)', plan.event_id, plan.expected_event_updated_at)],
    batchAssert(db, 'Candidate is already associated with another event',
      'NOT EXISTS (SELECT 1 FROM event_source_evidence WHERE candidate_id = ? AND event_id <> ?)', plan.candidate_id, plan.event_id),
    batchAssert(db, 'Source changed after review', `NOT EXISTS (SELECT 1 FROM json_each(?) x
      JOIN intake_observations o ON o.id = json_extract(x.value, '$.observation_id')
      WHERE EXISTS (SELECT 1 FROM intake_observations newer WHERE newer.post_id = o.post_id AND newer.observed_at > o.observed_at))`,
      JSON.stringify(plan.evidence)),
    // Official-page evidence has no observation; commitPlanEffect fetches it again instead.
    batchAssert(db, 'Evidence is missing', `NOT EXISTS (SELECT 1 FROM json_each(?) x
      LEFT JOIN intake_observations o ON o.id = json_extract(x.value, '$.observation_id')
      WHERE o.id IS NULL AND json_extract(x.value, '$.kind') IS NOT 'official_page')`, JSON.stringify(plan.evidence)),
  ]

  /** The event's vector from the plan's prepared embedding and the event row as it is now. */
  const upsertVector = async (plan: IntakePlanRow) => {
    const embedding = plan.payload.embedding
    if (plan.action === 'link' || !embedding) return
    const event = await db.prepare('SELECT status, starts_at FROM events WHERE id = ?').bind(plan.event_id).first<{ status: string; starts_at: string }>()
    if (!event) return
    await vectors.upsert([{ id: plan.event_id, values: embedding, metadata: { status: event.status, starts_at: Date.parse(event.starts_at) } }])
    await db.prepare('DELETE FROM vector_sync WHERE event_id = ?').bind(plan.event_id).run()
  }

  const store: IntakeStore = {
    // ---------------------------------------------------------------------------------------------------------------
    // Collection

    policy: () => d1('intake.policy', async () => (await first<IntakePolicy>(db.prepare('SELECT * FROM intake_policy WHERE id = 1')))!),

    /** reserve_instagram_collection: at most one paid run per Buenos Aires date, inside the calendar month's cap. */
    reserveCollection: () => d1('intake.reserve', async () => {
      const policy = (await first<IntakePolicy>(db.prepare('SELECT * FROM intake_policy WHERE id = 1')))!
      if (!policy.collection_enabled) throw new Error('Instagram collection is not enabled')
      const at = new Date()
      const day = baDate(at.toISOString())
      const existing = () => first<Reservation>(db.prepare('SELECT * FROM intake_runs WHERE local_date = ?').bind(day))
      const found = await existing()
      if (found) return { ...found, fresh: false }
      const month = day.slice(0, 7)
      const used = (await db.prepare('SELECT COALESCE(SUM(COALESCE(charged_usd, reserved_usd)), 0) AS used FROM intake_runs WHERE substr(local_date, 1, 7) = ?')
        .bind(month).first<{ used: number }>())!.used
      // shortcut: float sums, not Postgres numeric; at cents-sized charges the 1e-9 slack only matters exactly at the cap.
      if (used + policy.run_cap_usd > policy.monthly_cap_usd + 1e-9) throw new Error('Monthly collection budget exhausted')
      const handles = (await db.prepare('SELECT username FROM instagram_sources WHERE enabled = 1 ORDER BY username').all<{ username: string }>())
        .results.map(row => row.username)
      if (handles.length < 1 || handles.length > policy.max_sources) throw new Error('Source watchlist exceeds policy or is empty')
      // Two hours before the last successful run was reserved; 7 days with none; never more than 30 days.
      const last = (await db.prepare("SELECT MAX(created_at) AS last FROM intake_runs WHERE state = 'succeeded'").first<{ last: string | null }>())?.last
      const since = Math.max(at.getTime() - 30 * DAY, last ? Date.parse(last) - 2 * HOUR : at.getTime() - 7 * DAY)
      const input = { username: handles, resultsLimit: policy.posts_per_source,
        onlyPostsNewerThan: new Date(since).toISOString().replace(/\.\d{3}Z$/, 'Z'),
        skipPinnedPosts: false, dataDetailLevel: policy.data_detail_level, includeMusicData: false }
      try {
        await db.batch([
          batchAssert(db, 'Instagram collection is not enabled', '(SELECT collection_enabled FROM intake_policy WHERE id = 1) = 1'),
          batchAssert(db, 'Monthly collection budget exhausted',
            '(SELECT COALESCE(SUM(COALESCE(charged_usd, reserved_usd)), 0) FROM intake_runs WHERE substr(local_date, 1, 7) = ?) + ? <= ? + 1e-9',
            month, policy.run_cap_usd, policy.monthly_cap_usd),
          db.prepare('INSERT INTO intake_runs (id, local_date, reserved_usd, input) VALUES (?, ?, ?, ?)')
            .bind(crypto.randomUUID(), day, policy.run_cap_usd, JSON.stringify(input)),
        ])
      } catch (error) {
        // Another caller reserved today first (local_date is unique): resume that run, as the advisory lock did.
        const raced = await existing()
        if (raced) return { ...raced, fresh: false }
        throw error
      }
      return { ...(await existing())!, fresh: true, actor_build: policy.actor_build }
    }),

    updateRun: (id, patch) => d1(`intake.${patch.state}`, async () => {
      const values = { ...patch, ...'completed_at' in patch ? { completed_at: iso(patch.completed_at) } : {} }
      const columns = Object.keys(values)
      const result = await db.prepare(`UPDATE intake_runs SET ${columns.map(column => `${column} = ?`).join(', ')} WHERE id = ?`)
        .bind(...Object.values(values), id).run()
      if (!result.meta.changes) throw new Error('Collection run not found')
    }),
    latestObservation: postId => d1('intake.latest', () => first<{ id: string; content_hash: string }>(db.prepare(
      'SELECT id, content_hash FROM intake_observations WHERE post_id = ? ORDER BY observed_at DESC LIMIT 1').bind(postId))),
    touchObservation: id => d1('intake.seen', async () => {
      const result = await db.prepare('UPDATE intake_observations SET last_seen_at = ? WHERE id = ?').bind(now(), id).run()
      if (!result.meta.changes) throw new Error('Observation not found')
    }),
    upsertObservation: row => d1('intake.observe', async () => (await db.prepare(`INSERT INTO intake_observations
        (id, run_id, post_id, source_username, post_url, caption, published_at, content_hash, media_urls) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (run_id, post_id, content_hash) DO UPDATE SET source_username = excluded.source_username, post_url = excluded.post_url,
        caption = excluded.caption, published_at = excluded.published_at, media_urls = excluded.media_urls
      RETURNING id`).bind(crypto.randomUUID(), row.run_id, row.post_id, row.source_username, row.post_url, row.caption, iso(row.published_at),
      row.content_hash, JSON.stringify(row.media_urls)).first<{ id: string }>())!),
    mediaPositions: id => d1('intake.saved-media', async () => (await db.prepare('SELECT position FROM intake_media WHERE observation_id = ?')
      .bind(id).all<{ position: number }>()).results.map(row => row.position)),
    retainImage: (observationId, position, image) => d1('intake.store-image', async () => {
      // R2 refuses the put unless the bytes hash to the sha256, which is also the key.
      await evidence.put(image.object_key, image.bytes, { sha256: image.sha256, httpMetadata: { contentType: image.content_type } })
      await db.prepare(`INSERT INTO intake_media (id, observation_id, position, object_key, content_type, sha256) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (observation_id, position) DO UPDATE SET object_key = excluded.object_key, content_type = excluded.content_type, sha256 = excluded.sha256`)
        .bind(crypto.randomUUID(), observationId, position, image.object_key, image.content_type, image.sha256).run()
    }),

    unreviewedMedia: () => d1('intake.missing-media', async () => (await db.prepare(`SELECT o.id, o.media_urls,
        (SELECT json_group_array(m.position) FROM intake_media m WHERE m.observation_id = o.id) AS positions
      FROM intake_observations o WHERE o.reviewed_at IS NULL
        AND json_array_length(o.media_urls) > (SELECT count(*) FROM intake_media m WHERE m.observation_id = o.id)
      ORDER BY o.observed_at`).all<{ id: string; media_urls: string; positions: string }>()).results
      .map(row => ({ id: row.id, media_urls: JSON.parse(row.media_urls) as string[], positions: JSON.parse(row.positions) as number[] }))),

    // ---------------------------------------------------------------------------------------------------------------
    // Operator reads

    enabledSourceCount: () => d1('intake.sources', async () => (await db.prepare('SELECT count(*) AS n FROM instagram_sources WHERE enabled = 1').first<{ n: number }>())!.n),
    storageReady: () => d1('intake.buckets', async () => {
      await Promise.all([evidence.list({ limit: 1 }), artwork.list({ limit: 1 })])
      return true
    }),
    sources: () => d1('intake.sources', () => all(db.prepare('SELECT * FROM instagram_sources ORDER BY username'))),
    upsertSource: source => d1('intake.source', async () => (await first(db.prepare(`INSERT INTO instagram_sources (username, authority, enabled, qualification)
      VALUES (?, ?, ?, ?) ON CONFLICT (username) DO UPDATE SET authority = excluded.authority, enabled = excluded.enabled, qualification = excluded.qualification
      RETURNING *`).bind(source.username, source.authority, bit(source.enabled), source.qualification)))!),
    unreviewedObservations: () => d1('intake.read', () => all(db.prepare('SELECT * FROM intake_observations WHERE reviewed_at IS NULL ORDER BY observed_at'))),
    mediaFor: id => d1('intake.media', () => all<Media & Row>(db.prepare('SELECT * FROM intake_media WHERE observation_id = ? ORDER BY position').bind(id))),
    evidenceBytes: key => d1('intake.download', async () => {
      const object = await evidence.get(key)
      if (!object) throw new Error('Evidence image not found')
      return new Uint8Array(await object.arrayBuffer())
    }),
    candidates: () => d1('intake.read', () => all(db.prepare('SELECT * FROM intake_candidates ORDER BY updated_at'))),
    // Unicode case folding like ILIKE, which SQLite's LIKE lacks for accented letters; the venue list is small.
    lookupVenues: fragment => d1('intake.venues', async () => {
      const needle = fragment.toLowerCase()
      return (await all<VenueRow>(db.prepare('SELECT id, name, address, neighborhood FROM venues')))
        .filter(venue => venue.name.toLowerCase().includes(needle)).slice(0, 30)
    }),
    lookupEvents: fragment => d1('intake.events', async () => {
      const needle = fragment.toLowerCase()
      const ids = (await db.prepare('SELECT id, name FROM events ORDER BY starts_at DESC').all<{ id: string; name: string }>()).results
        .filter(event => event.name.toLowerCase().includes(needle)).slice(0, 100).map(event => event.id)
      if (!ids.length) return []
      return all(db.prepare(`SELECT id, name, starts_at, venue_id, price, is_free, status, source, ticket_url, link, updated_at FROM events
        WHERE id IN (SELECT value FROM json_each(?)) ORDER BY starts_at DESC`).bind(JSON.stringify(ids)))
    }),
    reviewObservation: (id, note) => d1('intake.review', async () => {
      const row = await db.prepare('UPDATE intake_observations SET reviewed_at = ?, review_note = ? WHERE id = ? RETURNING id, reviewed_at')
        .bind(now(), note, id).first<{ id: string; reviewed_at: string }>()
      if (!row) throw new Error('Observation not found')
      return row
    }),

    // ---------------------------------------------------------------------------------------------------------------
    // Candidates and plans

    /** submit_intake_candidate: a repeated payload returns the current row; otherwise the expected revision must be current. */
    submitCandidate: (id, expectedRevision, payload) => d1('intake.submit', async () => {
      const read = () => first<{ id: string; revision: number; payload: unknown; updated_at: string }>(
        db.prepare('SELECT * FROM intake_candidates WHERE id = ?').bind(id))
      const current = await read()
      if (current && sameJson(current.payload, payload)) return current
      if ((current?.revision ?? 0) !== expectedRevision) throw new Error('Candidate revision conflict')
      const next = expectedRevision + 1
      const text = JSON.stringify(payload)
      await db.batch([
        batchAssert(db, 'Candidate revision conflict', 'COALESCE((SELECT revision FROM intake_candidates WHERE id = ?), 0) = ?', id, expectedRevision),
        db.prepare(`INSERT INTO intake_candidates (id, revision, payload, updated_at) VALUES (?, ?, ?, ?)
          ON CONFLICT (id) DO UPDATE SET revision = excluded.revision, payload = excluded.payload, updated_at = excluded.updated_at`)
          .bind(id, next, text, now()),
        db.prepare('INSERT INTO intake_candidate_revisions (candidate_id, revision, payload) VALUES (?, ?, ?)').bind(id, next, text),
      ])
      return (await read())!
    }),
    candidate: id => d1('intake.candidate', async () => {
      const row = await first<{ id: string; revision: number; payload: never }>(db.prepare('SELECT * FROM intake_candidates WHERE id = ?').bind(id))
      if (!row) throw new Error('Candidate not found')
      return row
    }),
    observationsByIds: ids => d1('intake.observations', () => all(db.prepare('SELECT * FROM intake_observations WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(ids)))),
    sourceAuthorities: usernames => d1('intake.sources', () => all<{ username: string; authority: string }>(db.prepare(
      'SELECT username, authority FROM instagram_sources WHERE username IN (SELECT value FROM json_each(?))').bind(JSON.stringify(usernames)))),
    mediaForObservations: ids => d1('intake.media', () => all<Media>(db.prepare(
      'SELECT * FROM intake_media WHERE observation_id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(ids)))),
    venue: id => d1('intake.venue', () => first(db.prepare('SELECT id, name, neighborhood FROM venues WHERE id = ?').bind(id))),
    eventVenue: id => d1('intake.venue', async () => {
      const row = id ? await first<{ name: string; neighborhood: string | null }>(db.prepare('SELECT name, neighborhood FROM venues WHERE id = ?').bind(id)) : null
      if (!row) throw new Error('Venue not found')
      return row
    }),
    /** The importers' match: the same name key (the merge keeper among copies), else the most similar name from 0.6. */
    venueHint: name => d1('intake.venue-hint', async () => {
      const venues = (await db.prepare(`SELECT v.id, v.name, v.address, v.neighborhood, v.created_at,
        (SELECT count(*) FROM events e WHERE e.venue_id = v.id) AS event_count FROM venues v`).all<{ id: string; name: string; address: string | null;
        neighborhood: string | null; created_at: string; event_count: number }>()).results
      const named = (key: string) => key ? pickVenue(venues.filter(venue => venueNameKey(venue.name) === key)) : null
      const match = named(venueNameKey(name)) ?? (() => {
        const similar = mostSimilarVenue(venues, name, 0.6)
        return similar ? named(venueNameKey(similar.name)) : null
      })()
      return match ? { id: match.id, name: match.name } : null
    }),
    linkedEventIds: id => d1('intake.links', async () => (await db.prepare('SELECT event_id FROM event_source_evidence WHERE candidate_id = ?')
      .bind(id).all<{ event_id: string }>()).results.map(row => row.event_id)),
    eventsBetween: (from, to) => d1('intake.read', () => all(db.prepare('SELECT * FROM events WHERE starts_at >= ? AND starts_at < ? ORDER BY id').bind(iso(from), iso(to)))),
    eventsByIds: ids => d1('intake.targets', () => all(db.prepare('SELECT * FROM events WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(ids)))),
    artworkUrl: (eventId, media) => `${new URL(siteOrigin).origin}/api/event-artwork/${eventId}/${media.object_key}`,
    insertPlan: plan => d1('intake.plan', async () => (await first<IntakePlanRow>(db.prepare(`INSERT INTO intake_plans
        (id, candidate_id, revision, action, event_id, expected_event_updated_at, artwork_media_id, payload, evidence, reasons)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`).bind(crypto.randomUUID(), plan.candidate_id, plan.revision, plan.action, plan.event_id,
      iso(plan.expected_event_updated_at), plan.artwork_media_id, json(plan.payload), json(plan.evidence), json(plan.reasons))))!),
    plan: readPlan,
    publishingEnabled: () => d1('intake.policy', async () => (await db.prepare('SELECT publishing_enabled FROM intake_policy WHERE id = 1')
      .first<{ publishing_enabled: number }>())?.publishing_enabled === 1),
    /** check_intake_plan: the checks run as a batch of preconditions that writes nothing when they all pass. */
    checkPlan: id => d1('intake.check-plan', async () => {
      const plan = await planRow(id)
      if (!plan) throw new Error('Plan not found')
      if (!plan.receipt) await db.batch(planChecks(plan, now()))
    }),
    preparePlan: (id, payload) => d1('intake.prepare', async () => {
      const row = await db.prepare('UPDATE intake_plans SET payload = ? WHERE id = ? AND receipt IS NULL RETURNING id').bind(JSON.stringify(payload), id).first()
      if (!row) throw new Error('Plan already committed')
    }),
    artworkMedia: id => d1('intake.artwork', async () => {
      const media = await first<Media>(db.prepare('SELECT * FROM intake_media WHERE id = ?').bind(id))
      if (!media) throw new Error('Artwork image not found')
      return media
    }),
    publishArtwork: media => d1('intake.publish-artwork', async () => {
      const stored = await evidence.get(media.object_key)
      if (!stored) throw new Error('Evidence image not found')
      await artwork.put(media.object_key, await stored.arrayBuffer(), { sha256: media.sha256,
        httpMetadata: { contentType: media.content_type, cacheControl: 'public, max-age=31536000, immutable' } })
    }),

    /**
     * commit_intake_plan. Facts that only reads can establish (evidence authority, correction evidence, a duplicate
     * that appeared) are checked first; everything that could change before the write is re-checked inside the batch.
     */
    commitPlan: id => d1('intake.commit', async () => {
      const plan = await planRow(id)
      if (!plan) throw new Error('Plan not found')
      if (plan.receipt) return plan.receipt
      const at = now()
      await db.batch(planChecks(plan, at))
      const e = plan.payload
      const startsAt = iso(e.starts_at)!
      if (plan.action === 'create') {
        // Unicode lower(), as Postgres compares names; SQLite's lower() folds ASCII only.
        const same = (await db.prepare('SELECT name, ticket_url FROM events WHERE venue_id = ? AND starts_at = ?').bind(e.venue_id ?? null, startsAt)
          .all<{ name: string; ticket_url: string | null }>()).results
        if (same.some(event => event.name.toLowerCase() === e.name.toLowerCase() || !!e.ticket_url && event.ticket_url === e.ticket_url)) {
          throw new Error('A matching event appeared after preview')
        }
      }
      const evidenceRows = (await db.prepare(`SELECT json_extract(x.value, '$.fields') AS fields, o.observed_at, s.authority FROM json_each(?) x
        JOIN intake_observations o ON o.id = json_extract(x.value, '$.observation_id')
        JOIN instagram_sources s ON s.username = o.source_username`).bind(JSON.stringify(plan.evidence))
        .all<{ fields: string | null; observed_at: string; authority: string }>()).results
      if (!evidenceRows.length) throw new Error('Retained evidence is required')
      const level = Math.max(...evidenceRows.map(row => row.authority === 'curator' ? 1 : 2))
      const observed = evidenceRows.map(row => row.observed_at).sort().at(-1)!
      const previous = plan.action === 'create' ? null : await first(db.prepare('SELECT * FROM events WHERE id = ?').bind(plan.event_id))
      if (plan.action !== 'create' && !previous) throw new Error('Catalog changed after preview')
      if (plan.action === 'update' && previous) {
        const protection = await db.prepare('SELECT authority, observed_at FROM event_intake_protection WHERE event_id = ?').bind(plan.event_id)
          .first<{ authority: number; observed_at: string }>()
        if (level < 2 || protection && (level < protection.authority || observed < protection.observed_at)) {
          throw new Error('Correction needs current organizer or venue evidence')
        }
        const moved = Date.parse(previous.starts_at as string) !== Date.parse(startsAt)
        const changed = { status: previous.status !== (e.status ?? 'scheduled'), date: moved, time: moved && !e.time_tba,
          venue: (previous.venue_id ?? null) !== (e.venue_id ?? null),
          price: (previous.price ?? null) !== (e.price ?? null) || !!previous.is_free !== !!e.is_free }
        for (const [fact, needsEvidence] of Object.entries(changed)) {
          if (needsEvidence && !evidenceRows.some(row => (row.authority === 'venue' || row.authority === 'organizer') &&
            (JSON.parse(row.fields ?? '[]') as string[]).includes(fact) && (!protection || row.observed_at >= protection.observed_at))) {
            throw new Error(`Correction field lacks current direct evidence: ${fact}`)
          }
        }
      }
      if (plan.action !== 'link' && (!e.embedding || e.search_document == null)) throw new Error('Search preparation is required')

      const writes = []
      if (plan.action === 'create') {
        writes.push(db.prepare(`INSERT INTO events (id, name, starts_at, ends_at, time_tba, venue_id, description_es, description_en,
            description_display_es, description_display_en, description_summary_es, description_summary_en, categories, price, is_free,
            image_url, image_width, image_height, link, ticket_url, source, external_id, status, search_document, embedding_version,
            enrichment_status, description_unavailable)
          VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'instagram', ?, ?, ?, ?, ?, ?)`).bind(
          plan.event_id, e.name, startsAt, bit(e.time_tba) ?? 0, e.venue_id ?? null, e.description_es ?? null, e.description_en ?? null,
          e.description_display_es ?? null, e.description_display_en ?? null, e.description_summary_es ?? null, e.description_summary_en ?? null,
          JSON.stringify(e.categories ?? []), e.price ?? null, bit(e.is_free) ?? 0, e.image_url ?? null, e.image_width ?? null, e.image_height ?? null,
          e.link ?? null, e.ticket_url ?? null, plan.candidate_id, e.status ?? 'scheduled', e.search_document ?? null, e.embedding_version ?? 1,
          e.enrichment_status ?? 'pending', bit(e.description_unavailable) ?? 0))
      } else if (plan.action === 'update') {
        writes.push(db.prepare(`UPDATE events SET name = ?, starts_at = ?, ends_at = ?, time_tba = ?, venue_id = ?, description_es = ?,
            description_en = ?, description_display_es = ?, description_display_en = ?, description_summary_es = ?, description_summary_en = ?,
            categories = ?, price = ?, is_free = ?, image_url = COALESCE(?, image_url), image_width = ?, image_height = ?,
            ticket_url = COALESCE(?, ticket_url), status = ?, search_document = ?, embedding_version = ?, enrichment_status = ?,
            description_unavailable = ?
          WHERE id = ?`).bind(e.name, startsAt, iso(e.ends_at), bit(e.time_tba) ?? 0, e.venue_id ?? null, e.description_es ?? null,
          e.description_en ?? null, e.description_display_es ?? null, e.description_display_en ?? null, e.description_summary_es ?? null,
          e.description_summary_en ?? null, JSON.stringify(e.categories ?? []), e.price ?? null, bit(e.is_free) ?? 0, e.image_url ?? null,
          e.image_width ?? null, e.image_height ?? null, e.ticket_url ?? null, e.status ?? 'scheduled', e.search_document ?? null,
          e.embedding_version ?? 1, e.enrichment_status ?? 'pending', bit(e.description_unavailable) ?? 0, plan.event_id))
      }
      writes.push(db.prepare(`INSERT INTO event_source_evidence (event_id, candidate_id, observation_id, revision)
        SELECT ?, ?, json_extract(value, '$.observation_id'), ? FROM json_each(?) WHERE json_extract(value, '$.observation_id') IS NOT NULL
        ON CONFLICT (event_id, candidate_id, observation_id) DO UPDATE SET revision = excluded.revision`)
        .bind(plan.event_id, plan.candidate_id, plan.revision, JSON.stringify(plan.evidence)))
      if (plan.action !== 'link') {
        // Queued with the event write (migrations/0003_vector_sync.sql): if the Vectorize upsert below never lands, the
        // nightly reconcile re-embeds the event from its stored search_document.
        writes.push(db.prepare('INSERT INTO vector_sync (event_id) VALUES (?) ON CONFLICT (event_id) DO NOTHING').bind(plan.event_id))
        writes.push(db.prepare(`INSERT INTO event_intake_protection (event_id, fields, plan_id, authority, observed_at) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (event_id) DO UPDATE SET fields = excluded.fields, plan_id = excluded.plan_id, authority = excluded.authority,
            observed_at = excluded.observed_at`).bind(plan.event_id, JSON.stringify(PROTECTED_FIELDS), plan.id, level, observed))
      }
      const receipt = { plan_id: plan.id, candidate_id: plan.candidate_id, revision: plan.revision, action: plan.action, event_id: plan.event_id,
        committed_at: at, previous_event: plan.action === 'update' ? previous : null }
      writes.push(db.prepare('UPDATE intake_plans SET receipt = ? WHERE id = ?').bind(JSON.stringify(receipt), plan.id))
      try {
        await db.batch([
          ...planChecks(plan, at),
          batchAssert(db, 'Candidate revision already committed through another plan',
            'NOT EXISTS (SELECT 1 FROM intake_plans WHERE candidate_id = ? AND revision = ? AND receipt IS NOT NULL)', plan.candidate_id, plan.revision),
          ...intakeCommitBatch(db, writes),
        ])
      } catch (error) {
        // A concurrent commit of this plan won; its receipt is the answer, as the publication lock made it in Postgres.
        const committed = await planRow(id)
        if (committed?.receipt) return committed.receipt
        throw error
      }
      await upsertVector(plan)
      return receipt
    }),
    replayReceipt: plan => d1('intake.commit', async () => {
      // Repair the vector only while this plan is still the event's accepted state: every create or update commit points
      // the protection row at itself, so a later correction makes an older plan's embedding stale.
      const current = await db.prepare('SELECT 1 FROM event_intake_protection WHERE event_id = ? AND plan_id = ?').bind(plan.event_id, plan.id).first()
      if (current) await upsertVector(plan)
      return plan.receipt!
    }),

    // ---------------------------------------------------------------------------------------------------------------
    // Venues

    allVenues: () => d1('intake.read', () => all<VenueRow>(db.prepare('SELECT id, name, address, neighborhood FROM venues ORDER BY id'))),
    /** intake_similar_venues on the trigram port (delivery PR 03). */
    similarVenues: (name, threshold) => d1('intake.venue-similar', async () =>
      similarIntakeVenues(await all<VenueRow>(db.prepare('SELECT id, name, address, neighborhood FROM venues ORDER BY created_at, id')), name, threshold)),
    completeVenue: (id, fill) => d1('intake.venue-complete', () => {
      const columns = Object.keys(fill).filter(column => column === 'address' || column === 'neighborhood')
      return all<VenueRow>(db.prepare(`UPDATE venues SET ${columns.map(column => `${column} = ?`).join(', ')} WHERE id = ?
        ${columns.map(column => `AND ${column} IS NULL`).join(' ')} RETURNING id, name, address, neighborhood`)
        .bind(...columns.map(column => fill[column as keyof typeof fill]), id))
    }),
    correctVenueNeighborhood: (id, from, to) => d1('intake.venue-correct', () => all<VenueRow>(db.prepare(
      'UPDATE venues SET neighborhood = ? WHERE id = ? AND neighborhood = ? RETURNING id, name, address, neighborhood').bind(to, id, from))),
    venueRow: id => d1('intake.venue-read', async () => {
      const row = await first<VenueRow>(db.prepare('SELECT id, name, address, neighborhood FROM venues WHERE id = ?').bind(id))
      if (!row) throw new Error('Venue not found')
      return row
    }),
    createVenue: venue => d1('intake.venue-create', async () => (await first<VenueRow>(db.prepare(`INSERT INTO venues
        (id, name, address, neighborhood, website, instagram_handle, parent_id) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id, name, address, neighborhood`)
      .bind(crypto.randomUUID(), venue.name, venue.address ?? null, venue.neighborhood ?? null, venue.website ?? null,
        venue.instagram_handle ?? null, venue.parent_id ?? null)))!),
    recordVenueEvidence: row => d1('intake.venue-evidence', async () => {
      await db.prepare(`INSERT INTO venue_review_queue (id, source, source_venue_name, source_address, status, final_venue_id,
          best_match_venue_id, match_confidence, reviewed_at, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), row.source, row.source_venue_name, row.source_address ?? null, row.status, row.final_venue_id ?? null,
          row.best_match_venue_id ?? null, row.match_confidence ?? null, iso(row.reviewed_at), row.notes ?? null).run()
    }),
    futureCandidates: today => d1('intake.read', () => all(db.prepare(
      "SELECT id, revision, payload, updated_at FROM intake_candidates WHERE json_extract(payload, '$.date') >= ? ORDER BY id").bind(today))),
    plansFor: ids => d1('intake.read', () => all(db.prepare(`SELECT candidate_id, revision, action, reasons, receipt, created_at FROM intake_plans
      WHERE candidate_id IN (SELECT value FROM json_each(?)) ORDER BY created_at`).bind(JSON.stringify(ids)))),
  }
  return store
}

/**
 * Hermes' source import (replaces `tmp/venue-directory/scripts/import_sources.py`): inserts new sources disabled and
 * leaves every existing username untouched, in one statement.
 */
export const importSourcesEffect = (db: D1Database, sources: ReadonlyArray<Omit<Source, 'enabled'>>) => d1('intake.import-sources', async () => {
  const inserted = (await db.prepare(`INSERT INTO instagram_sources (username, authority, enabled, qualification)
    SELECT json_extract(value, '$.username'), json_extract(value, '$.authority'), 0, json_extract(value, '$.qualification') FROM json_each(?) WHERE true
    ON CONFLICT (username) DO NOTHING RETURNING username`).bind(JSON.stringify(sources)).all<{ username: string }>()).results.map(row => row.username)
  const totals = (await db.prepare('SELECT count(*) AS total, COALESCE(SUM(enabled), 0) AS enabled FROM instagram_sources').first<{ total: number; enabled: number }>())!
  return { received: sources.length, inserted: inserted.length, already_present: sources.length - inserted.length, inserted_usernames: inserted.sort(),
    total_sources: totals.total, enabled_sources: totals.enabled }
})

export type { EventInsert }
