/**
 * The intake store on D1, R2 and Vectorize (store.ts has the port). It runs only where an env binds `DB`: the intake
 * API on `baeventos-jobs` and the D1 tests.
 *
 * Each intake write is one `db.batch()`, which D1 runs as one transaction and
 * serializes with every other write, so the Postgres advisory locks and `FOR UPDATE` have nothing left to guard. Checks
 * that must hold when the batch commits are `batchAssert` statements inside it, with the Postgres error messages. A
 * commit submits its checked patch, evidence, and receipt to the catalog write gateway as one batch.
 */
import type { D1Database, R2Bucket, Vectorize } from '@cloudflare/workers-types'
import { Effect } from 'effect'
import { decodeArtworkRef, encodeArtworkRef } from '#shared/lib/artwork-ref.ts'
import { batchAssert } from '#shared/lib/db/d1.server.ts'
import { eventColumnsWith } from '#shared/lib/db/event-columns.ts'
import { checkIntakeAuthority, commitIntakeEvent, intakeVenueChecks, replayIntakeVector, type IntakeEventPatch } from '#shared/lib/db/event-write.ts'
import { hasRefusedPublisherSearchInput, publisherFields } from '#shared/lib/db/publisher-field-authority.ts'
import type { EventInsert } from '#shared/lib/types.ts'
import { importTry, ImportOperationError } from '../core/effect-utils.ts'
import { mostSimilarVenue, similarIntakeVenues } from '../core/venue-similarity-d1.ts'
import { pickVenue, venueNameKey } from '../core/venue-identity.ts'
import { baDate, baTime, citesIntakeClock, citesTicketDestination, hasOfficialTicketEvidence, isWholeCaptionExcerpt, requiresWholeCaptionExcerpt,
  retainedIntakeDoors, SAME_CLOCK_REASON, SAME_CLOCK_RETAINED_REASON, searchInputsChanged, separatelyCitedDoors, ticketDestinationChanged, type Media } from './planning.ts'
import { isOfficialPage, type Source } from './schema.ts'
import type { IntakePlanRow, IntakePolicy, IntakeStore, MonthlyCharges, Reservation, VenueRow } from './store.ts'

type Row = Record<string, unknown>
export type IntakeBindings = { db: D1Database; evidence: R2Bucket; artwork: R2Bucket; vectors: Vectorize }

const HOUR = 3_600_000
const DAY = 24 * HOUR
const RELEASED_RUN = "state = 'failed' AND charged_usd IS 0 AND apify_run_id IS NULL AND dataset_id IS NULL AND completed_at IS NOT NULL"
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
const JSON_COLUMNS = ['input', 'media_urls', 'payload', 'evidence', 'reasons', 'receipt', 'categories', 'facets', 'performers', 'enrichment_provenance', 'fields']
/** Decodes integer booleans and JSON text from D1 rows. */
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

const detailProtectionColumns = eventColumnsWith('protection', 'details')

export function d1Intake({ db, evidence, artwork, vectors }: IntakeBindings): IntakeStore {
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
  const preflightChecks = (plan: IntakePlanRow, at: string) => [
    ...planChecks(plan, at), ...(plan.action === 'update' ? intakeVenueChecks(db, plan.event_id, plan.payload.venue_id) : []),
  ]

  const store: IntakeStore = {
    // ---------------------------------------------------------------------------------------------------------------
    // Collection

    policy: d1('intake.policy', async () => (await first<IntakePolicy>(db.prepare('SELECT * FROM intake_policy WHERE id = 1')))!),

    /** reserve_instagram_collection: at most one paid run per Buenos Aires date, inside the calendar month's cap. */
    reserveCollection: d1('intake.reserve', async () => {
      const policy = (await first<IntakePolicy>(db.prepare('SELECT * FROM intake_policy WHERE id = 1')))!
      if (!policy.collection_enabled) throw new Error('Instagram collection is not enabled')
      const at = new Date()
      const day = baDate(at.toISOString())
      const active = `SELECT * FROM intake_runs WHERE local_date = ? AND NOT (${RELEASED_RUN})`
      const found = await first<Reservation>(db.prepare(active).bind(day))
      if (found) return { ...found, fresh: false }
      const handles = (await db.prepare('SELECT username FROM instagram_sources WHERE enabled = 1 ORDER BY username').all<{ username: string }>())
        .results.map(row => row.username)
      if (handles.length < 1 || handles.length > policy.max_sources) throw new Error('Source watchlist exceeds policy or is empty')
      // Two hours before the last successful run was reserved; 7 days with none; never more than 30 days.
      const last = (await db.prepare("SELECT MAX(created_at) AS last FROM intake_runs WHERE state = 'succeeded'").first<{ last: string | null }>())?.last
      const since = Math.max(at.getTime() - 30 * DAY, last ? Date.parse(last) - 2 * HOUR : at.getTime() - 7 * DAY)
      const input = { username: handles, resultsLimit: policy.posts_per_source,
        onlyPostsNewerThan: new Date(since).toISOString().replace(/\.\d{3}Z$/, 'Z'),
        skipPinnedPosts: false, dataDetailLevel: policy.data_detail_level, includeMusicData: false }
      const [,, claimed, existing] = await db.batch<Row>([
        batchAssert(db, 'Instagram collection is not enabled', '(SELECT collection_enabled FROM intake_policy WHERE id = 1) = 1'),
        // Another caller may already have claimed today. It uses budget only once. The slack handles float rounding at the cap.
        batchAssert(db, 'Monthly collection budget exhausted', `EXISTS (${active}) OR
          (SELECT COALESCE(SUM(COALESCE(charged_usd, reserved_usd)), 0) FROM intake_runs WHERE substr(local_date, 1, 7) = ?) + ? <= ? + 1e-9`,
          day, day.slice(0, 7), policy.run_cap_usd, policy.monthly_cap_usd),
        // Advance the timestamp even within the same millisecond so a stale release cannot affect a newer attempt.
        db.prepare(`INSERT INTO intake_runs (id, local_date, reserved_usd, input) VALUES (?, ?, ?, ?)
          ON CONFLICT (local_date) DO UPDATE SET state = 'reserved', reserved_usd = excluded.reserved_usd,
            charged_usd = NULL, completed_at = NULL, input = excluded.input,
            created_at = max(excluded.created_at, strftime('%Y-%m-%dT%H:%M:%fZ', intake_runs.created_at, '+0.001 seconds'))
          WHERE ${RELEASED_RUN} RETURNING *`).bind(crypto.randomUUID(), day, policy.run_cap_usd, JSON.stringify(input)),
        db.prepare(active).bind(day),
      ])
      // Only the caller that inserted or renewed the row may send a paid start request.
      if (claimed.results[0]) return { ...decodeRow<Reservation>(claimed.results[0]), fresh: true, actor_build: policy.actor_build }
      return { ...decodeRow<Reservation>(existing.results[0]), fresh: false }
    }),

    releaseCollection: (id, reservedAt) => d1('intake.release', async () => {
      const result = await db.prepare(`UPDATE intake_runs SET state = 'failed', charged_usd = 0, completed_at = max(?, created_at)
        WHERE id = ? AND created_at = ? AND state = 'reserved' AND apify_run_id IS NULL AND dataset_id IS NULL
          AND charged_usd IS NULL AND completed_at IS NULL`).bind(now(), id, reservedAt).run()
      if (!result.meta.changes) throw new Error('Collection reservation is no longer eligible for release')
    }),

    updateRun: (id, patch) => d1(`intake.${patch.state}`, async () => {
      const values = { ...patch, ...'completed_at' in patch ? { completed_at: iso(patch.completed_at) } : {} }
      const columns = Object.keys(values)
      const update = db.prepare(`UPDATE intake_runs SET ${columns.map(column => `${column} = ?`).join(', ')} WHERE id = ?`)
        .bind(...Object.values(values), id)
      if (patch.state === 'succeeded') {
        const [result, month] = await db.batch<MonthlyCharges>([update, db.prepare(`
          SELECT COALESCE(SUM(charged_usd), 0) AS charged_usd, COUNT(*) - COUNT(charged_usd) AS unmeasured_runs,
            COALESCE(SUM(COALESCE(charged_usd, reserved_usd)), 0) AS reserved_or_charged_usd
          FROM intake_runs WHERE substr(local_date, 1, 7) = (SELECT substr(local_date, 1, 7) FROM intake_runs WHERE id = ?)`)
          .bind(id)])
        if (!result.meta.changes) throw new Error('Collection run not found')
        return month.results[0]
      }
      if (!(await update.run()).meta.changes) throw new Error('Collection run not found')
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

    unreviewedMedia: d1('intake.missing-media', async () => (await db.prepare(`SELECT o.id, o.media_urls,
        (SELECT json_group_array(m.position) FROM intake_media m WHERE m.observation_id = o.id) AS positions
      FROM intake_observations o WHERE o.reviewed_at IS NULL
        AND json_array_length(o.media_urls) > (SELECT count(*) FROM intake_media m WHERE m.observation_id = o.id)
      ORDER BY o.observed_at`).all<{ id: string; media_urls: string; positions: string }>()).results
      .map(row => ({ id: row.id, media_urls: JSON.parse(row.media_urls) as string[], positions: JSON.parse(row.positions) as number[] }))),

    // ---------------------------------------------------------------------------------------------------------------
    // Operator reads

    enabledSourceCount: d1('intake.sources', async () => (await db.prepare('SELECT count(*) AS n FROM instagram_sources WHERE enabled = 1').first<{ n: number }>())!.n),
    storageReady: d1('intake.buckets', async () => {
      await Promise.all([evidence.list({ limit: 1 }), artwork.list({ limit: 1 })])
      return true
    }),
    sources: d1('intake.sources', () => all(db.prepare('SELECT * FROM instagram_sources ORDER BY username'))),
    upsertSource: source => d1('intake.source', async () => (await first(db.prepare(`INSERT INTO instagram_sources (username, authority, enabled, qualification)
      VALUES (?, ?, ?, ?) ON CONFLICT (username) DO UPDATE SET authority = excluded.authority, enabled = excluded.enabled, qualification = excluded.qualification
      RETURNING *`).bind(source.username, source.authority, bit(source.enabled), source.qualification)))!),
    unreviewedObservations: d1('intake.read', () => all(db.prepare('SELECT * FROM intake_observations WHERE reviewed_at IS NULL ORDER BY observed_at'))),
    mediaFor: id => d1('intake.media', () => all<Media & Row>(db.prepare('SELECT * FROM intake_media WHERE observation_id = ? ORDER BY position').bind(id))),
    evidenceBytes: key => d1('intake.download', async () => {
      const object = await evidence.get(key)
      if (!object) throw new Error('Evidence image not found')
      return new Uint8Array(await object.arrayBuffer())
    }),
    candidates: d1('intake.read', () => all(db.prepare('SELECT * FROM intake_candidates ORDER BY updated_at'))),
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
    venue: id => d1('intake.venue', () => first(db.prepare('SELECT id, name, neighborhood, website FROM venues WHERE id = ?').bind(id))),
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
    eventsByIds: ids => d1('intake.targets', () => all(db.prepare(`SELECT *, ${publisherFields} AS publisher_fields FROM events
      WHERE id IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(ids)))),
    insertPlan: plan => d1('intake.plan', async () => (await first<IntakePlanRow>(db.prepare(`INSERT INTO intake_plans
        (id, candidate_id, revision, action, event_id, expected_event_updated_at, artwork_media_id, artwork_note, payload, evidence, reasons)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`).bind(crypto.randomUUID(), plan.candidate_id, plan.revision, plan.action, plan.event_id,
      iso(plan.expected_event_updated_at), plan.artwork_media_id, plan.artwork_note ?? null, json(plan.payload), json(plan.evidence), json(plan.reasons))))!),
    plan: readPlan,
    publishingEnabled: d1('intake.policy', async () => (await db.prepare('SELECT publishing_enabled FROM intake_policy WHERE id = 1')
      .first<{ publishing_enabled: number }>())?.publishing_enabled === 1),
    /** check_intake_plan: the checks run as a batch of preconditions that writes nothing when they all pass. */
    checkPlan: id => d1('intake.check-plan', async () => {
      const plan = await planRow(id)
      if (!plan) throw new Error('Plan not found')
      if (!plan.receipt) await db.batch(preflightChecks(plan, now()))
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
      await db.batch(preflightChecks(plan, at))
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
      const evidenceRows = (await db.prepare(`SELECT json_extract(x.value, '$.fields') AS fields, o.observed_at, s.authority,
          json_extract(x.value, '$.excerpt') AS excerpt, o.caption, json_extract(x.value, '$.media_id') AS media_id,
          EXISTS (SELECT 1 FROM intake_media m WHERE m.id = json_extract(x.value, '$.media_id') AND m.observation_id = o.id) AS retained_media
        FROM json_each(?) x JOIN intake_observations o ON o.id = json_extract(x.value, '$.observation_id')
        JOIN instagram_sources s ON s.username = o.source_username`).bind(JSON.stringify(plan.evidence))
        .all<{ fields: string | null; observed_at: string; authority: string; excerpt: string | null; caption: string;
          media_id: string | null; retained_media: number }>()).results
      if (!evidenceRows.length) throw new Error('Retained evidence is required')
      const fields = (row: typeof evidenceRows[number]) => JSON.parse(row.fields ?? '[]') as string[]
      const quotesTicket = (row: typeof evidenceRows[number], ticket: string | null | undefined) =>
        Boolean(ticket && row.excerpt && (!row.media_id || row.retained_media) &&
          citesTicketDestination(row.excerpt, ticket, row.media_id ? undefined : row.caption))
      // Official pages are fetched and verified by commitPlanEffect before the catalog write.
      if (plan.action === 'create' && e.ticket_url && !hasOfficialTicketEvidence(plan.evidence, e.ticket_url) &&
        !evidenceRows.some(row => fields(row).includes('ticket') && quotesTicket(row, e.ticket_url))) {
        throw new Error('Ticket evidence must quote the complete destination URL')
      }
      const level = Math.max(...evidenceRows.map(row => row.authority === 'curator' ? 1 : 2))
      const observed = evidenceRows.map(row => row.observed_at).sort().at(-1)!
      const stored = plan.action === 'create' ? null : await db.prepare(`SELECT *, ${publisherFields} AS publisher_fields FROM events WHERE id = ?`)
        .bind(plan.event_id).first<Row>()
      const previous = stored ? decodeRow(stored) : null
      if (plan.action !== 'create' && !previous) throw new Error('Catalog changed after preview')
      const oldStart = typeof previous?.starts_at === 'string' ? previous.starts_at : undefined
      const moved = oldStart !== undefined && Date.parse(oldStart) !== Date.parse(startsAt)
      const sameDay = oldStart !== undefined && baDate(oldStart) === baDate(startsAt)
      const retainedDoors = retainedIntakeDoors(previous?.doors_at, sameDay, startsAt, e.time_tba)
      const startChanged = !e.time_tba && (moved || Boolean(previous?.time_tba))
      const doors = e.doors_at ?? (startChanged ? retainedDoors : null)
      if (plan.action !== 'link' && doors && !e.time_tba) {
        const time = baTime(doors), doorsRetained = !e.doors_at
        if (time === baTime(startsAt) && !separatelyCitedDoors(plan.evidence.filter(isOfficialPage), time, [], doorsRetained) &&
          !evidenceRows.some(row => {
            const citedFields = fields(row), wholeLines = requiresWholeCaptionExcerpt(citedFields)
            return row.excerpt && (citedFields.includes('doors_time') || doorsRetained && citedFields.includes('time')) &&
              (row.media_id ? row.retained_media : wholeLines ? isWholeCaptionExcerpt(row.caption, row.excerpt) : row.caption.includes(row.excerpt)) &&
              citesIntakeClock(row.excerpt, time, row.media_id ? undefined : row.caption, wholeLines, 2)
          })) {
          throw new Error(doorsRetained ? SAME_CLOCK_RETAINED_REASON : SAME_CLOCK_REASON)
        }
      }
      const changedTicket = ticketDestinationChanged(previous?.ticket_url, e.ticket_url)
      if (plan.action === 'update' && previous) {
        const minimumObservedAt = await checkIntakeAuthority(db, plan.event_id, level, observed)
        if (sameDay && !previous.time_tba && e.time_tba) throw new Error('Cannot replace a known start with time TBA on the same date')
        if (e.doors_at && !e.time_tba && Date.parse(e.doors_at) > Date.parse(startsAt)) throw new Error('Doors cannot follow the known start time')
        const changed = { status: previous.status !== (e.status ?? 'scheduled'), date: moved, time: startChanged,
          ticket: changedTicket || (e.offers_valid_from !== undefined && e.offers_valid_from !== previous.offers_valid_from),
          venue: (previous.venue_id ?? null) !== (e.venue_id ?? null),
          price: (previous.price ?? null) !== (e.price ?? null) || !!previous.is_free !== !!e.is_free,
          organizer: e.organizer_name !== undefined, performers: e.performers !== undefined,
          offers_valid_from: e.offers_valid_from !== undefined, doors_time: e.doors_at !== undefined }
        const ticket = e.ticket_url ?? (typeof previous.ticket_url === 'string' ? previous.ticket_url : null)
        for (const [fact, needsEvidence] of Object.entries(changed)) {
          if (needsEvidence && !evidenceRows.some(row => (row.authority === 'venue' || row.authority === 'organizer') &&
            fields(row).includes(fact) && (!minimumObservedAt || row.observed_at >= minimumObservedAt) &&
            (fact !== 'ticket' || quotesTicket(row, ticket)))) {
            throw new Error(`Correction field lacks current direct evidence: ${fact}`)
          }
        }
      }
      const needsEmbedding = plan.action === 'create' || plan.action === 'update' && previous &&
        searchInputsChanged(previous, e) && !hasRefusedPublisherSearchInput(previous, e)
      if (needsEmbedding && (!e.embedding || e.search_document == null)) throw new Error('Search preparation is required')

      const performers = e.performers ?? previous?.performers
      const replacedTicket = !!previous?.ticket_url && changedTicket
      const replacing = plan.action === 'update'
      // A plan previewed before this deploy may still carry a URL. Normalize only a selected new image.
      const selectedImage = plan.artwork_media_id ? decodeArtworkRef(e.image_url, plan.event_id) : null
      const imageValue = selectedImage?.kind === 'stored' ? encodeArtworkRef(selectedImage) : e.image_url
      const patch = {
        name: e.name, starts_at: startsAt, ends_at: !moved && typeof previous?.ends_at === 'string' ? iso(previous.ends_at) : null,
        time_tba: bit(e.time_tba) ?? 0, venue_id: e.venue_id ?? null, description_es: e.description_es ?? null, description_en: e.description_en ?? null,
        description_display_es: e.description_display_es ?? null, description_display_en: e.description_display_en ?? null,
        description_summary_es: e.description_summary_es ?? null, description_summary_en: e.description_summary_en ?? null,
        categories: JSON.stringify(e.categories ?? []), price: e.price ?? null, is_free: bit(e.is_free) ?? 0,
        image_url: imageValue ?? (replacing ? undefined : null), image_width: e.image_width ?? null, image_height: e.image_height ?? null,
        ticket_url: e.ticket_url ?? (replacing ? undefined : null), status: e.status ?? 'scheduled',
        search_document: e.search_document ?? null, embedding_version: e.embedding_version ?? 1,
        enrichment_status: e.enrichment_status ?? 'pending', description_unavailable: bit(e.description_unavailable) ?? 0,
        organizer_name: e.organizer_name ?? previous?.organizer_name ?? null,
        organizer_url: e.organizer_url ?? (e.organizer_name === undefined || e.organizer_name === previous?.organizer_name ? previous?.organizer_url ?? null : null),
        performers: performers ? JSON.stringify(performers) : null,
        offers_valid_from: e.offers_valid_from ?? (replacedTicket ? null : previous?.offers_valid_from ?? null), doors_at: e.doors_at ?? retainedDoors,
      } satisfies IntakeEventPatch
      if (previous) delete previous.publisher_fields
      const receipt = { plan_id: plan.id, candidate_id: plan.candidate_id, revision: plan.revision, action: plan.action, event_id: plan.event_id,
        committed_at: at, previous_event: replacing ? previous : null }
      const recordEvidence = db.prepare(`INSERT INTO event_source_evidence (event_id, candidate_id, observation_id, revision)
        SELECT ?, ?, json_extract(value, '$.observation_id'), ? FROM json_each(?) WHERE json_extract(value, '$.observation_id') IS NOT NULL
        ON CONFLICT (event_id, candidate_id, observation_id) DO UPDATE SET revision = excluded.revision`)
        .bind(plan.event_id, plan.candidate_id, plan.revision, JSON.stringify(plan.evidence))
      let commit: Awaited<ReturnType<typeof commitIntakeEvent>>
      try {
        if (plan.action === 'held') throw new Error('Plan is held or expired')
        commit = await commitIntakeEvent(db, vectors, {
          id: plan.event_id, planId: plan.id, action: plan.action, patch, previous: stored, vectorPatch: e,
          create: { link: e.link ?? null, external_id: plan.candidate_id },
          evidence: { authority: level, observedAt: observed, details: detailProtectionColumns.filter(column =>
            e[column === 'organizer_url' ? 'organizer_name' : column] !== undefined) },
          checks: [...planChecks(plan, at), batchAssert(db, 'Candidate revision already committed through another plan',
            'NOT EXISTS (SELECT 1 FROM intake_plans WHERE candidate_id = ? AND revision = ? AND receipt IS NOT NULL)', plan.candidate_id, plan.revision)],
          recordEvidence, recordReceipt: result => db.prepare('UPDATE intake_plans SET receipt = ? WHERE id = ?')
            .bind(JSON.stringify({ ...receipt, ...result }), plan.id),
        })
      } catch (error) {
        // A concurrent commit of this plan won; its receipt is the answer, as the publication lock made it in Postgres.
        const committed = await planRow(id)
        if (committed?.receipt) return committed.receipt
        throw error
      }
      await commit.settle()
      return { ...receipt, ...commit.result }
    }),
    replayReceipt: plan => d1('intake.commit', async () => {
      if (plan.action !== 'link') await replayIntakeVector(db, vectors, plan.event_id, plan.id, plan.payload,
        (plan.receipt!.previous_event as Row | null) ?? null, plan.receipt!.kept)
      return plan.receipt!
    }),

    // ---------------------------------------------------------------------------------------------------------------
    // Venues

    allVenues: d1('intake.read', () => all<VenueRow>(db.prepare('SELECT id, name, address, neighborhood FROM venues ORDER BY id'))),
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
