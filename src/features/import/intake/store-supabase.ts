/** The intake store on Supabase: production's path until the cutover (delivery PR 08). Queries are unchanged from before the store existed. */
import { Effect } from 'effect'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createVenue } from '#shared/lib/db/client.server.ts'
import type { VenueInsert } from '#shared/lib/types.ts'
import { importTry, ImportOperationError } from '../core/effect-utils.ts'
import { matchVenueEffect } from '../scrapers/venue-matcher.ts'
import { supabaseCatalog } from '../core/catalog-store.ts'
import type { Media } from './planning.ts'
import { allRowsEffect, dbEffect } from './repository.ts'
import type { IntakePlanRow, IntakePolicy, IntakeStore, Reservation, VenueRow } from './store.ts'

const ok = Effect.asVoid

export function publicArtworkUrl(storageOrigin: string, media: Media): string {
  const origin = new URL(storageOrigin)
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.port) throw new Error('Invalid storage origin')
  return `${origin.origin}/storage/v1/object/public/event-artwork/${media.object_key}`
}

/** `storageOrigin` is SUPABASE_URL, the origin of the public `event-artwork` bucket. */
export function supabaseIntake(client: SupabaseClient, storageOrigin = ''): IntakeStore {
  const venueColumns = 'id,name,address,neighborhood'
  return {
    policy: () => dbEffect('intake.policy', () => client.from('intake_policy').select('*').single()).pipe(Effect.map(row => row as IntakePolicy)),
    reserveCollection: () => dbEffect('intake.reserve', () => client.rpc('reserve_instagram_collection')).pipe(Effect.map(row => row as Reservation)),
    updateRun: (id, patch) => ok(dbEffect(`intake.${patch.state}`, () => client.from('intake_runs').update(patch).eq('id', id).select('id').single())),
    latestObservation: postId => dbEffect('intake.latest', () => client.from('intake_observations').select('id,content_hash')
      .eq('post_id', postId).order('observed_at', { ascending: false }).limit(1)).pipe(Effect.map(rows => rows[0] ?? null)),
    touchObservation: id => ok(dbEffect('intake.seen', () => client.from('intake_observations').update({ last_seen_at: new Date().toISOString() }).eq('id', id).select('id').single())),
    upsertObservation: row => dbEffect('intake.observe', () => client.from('intake_observations').upsert(row, { onConflict: 'run_id,post_id,content_hash' }).select('id').single()),
    mediaPositions: id => dbEffect('intake.saved-media', () => client.from('intake_media').select('position').eq('observation_id', id))
      .pipe(Effect.map(rows => rows.map(row => row.position as number))),
    retainImage: (observationId, position, image) => Effect.gen(function*() {
      yield* dbEffect('intake.store-image', () => client.storage.from('instagram-evidence').upload(image.object_key, image.bytes, { contentType: image.content_type, upsert: true }))
      yield* dbEffect('intake.record-image', () => client.from('intake_media').upsert({ observation_id: observationId, position,
        object_key: image.object_key, content_type: image.content_type, sha256: image.sha256 }, { onConflict: 'observation_id,position' }).select('id').single())
    }),
    unreviewedMedia: () => Effect.gen(function*() {
      const observations = (yield* allRowsEffect(client, 'intake_observations', 'id,media_urls',
        query => query.is('reviewed_at', null).order('observed_at'))) as unknown as Array<{ id: string; media_urls: unknown }>
      const withUrls = observations.filter(row => Array.isArray(row.media_urls) && row.media_urls.length)
      const saved = new Map<string, number[]>()
      for (let index = 0; index < withUrls.length; index += 100) {
        const ids = withUrls.slice(index, index + 100).map(row => row.id)
        const rows = (yield* allRowsEffect(client, 'intake_media', 'observation_id,position',
          query => query.in('observation_id', ids).order('observation_id'))) as unknown as Array<{ observation_id: string; position: number }>
        for (const row of rows) saved.set(row.observation_id, [...saved.get(row.observation_id) ?? [], row.position])
      }
      return withUrls.map(row => ({ id: row.id, media_urls: row.media_urls as string[], positions: saved.get(row.id) ?? [] }))
        .filter(row => row.positions.length < row.media_urls.length)
    }),

    enabledSourceCount: () => dbEffect('intake.sources', () => client.from('instagram_sources').select('username').eq('enabled', true)).pipe(Effect.map(rows => rows.length)),
    storageReady: () => dbEffect('intake.buckets', () => client.storage.listBuckets()).pipe(Effect.map(buckets =>
      buckets.some(bucket => bucket.id === 'instagram-evidence' && !bucket.public) && buckets.some(bucket => bucket.id === 'event-artwork' && bucket.public))),
    sources: () => allRowsEffect(client, 'instagram_sources', '*', query => query.order('username')),
    upsertSource: source => dbEffect('intake.source', () => client.from('instagram_sources').upsert(source).select().single()),
    unreviewedObservations: () => allRowsEffect(client, 'intake_observations', '*', query => query.is('reviewed_at', null).order('observed_at')),
    mediaFor: id => dbEffect('intake.media', () => client.from('intake_media').select('*').eq('observation_id', id).order('position')),
    evidenceBytes: key => dbEffect('intake.download', () => client.storage.from('instagram-evidence').download(key)).pipe(
      Effect.flatMap(blob => importTry('intake.download', () => blob.arrayBuffer())), Effect.map(buffer => new Uint8Array(buffer))),
    candidates: () => allRowsEffect(client, 'intake_candidates', '*', query => query.order('updated_at')),
    lookupVenues: fragment => dbEffect('intake.venues', () => client.from('venues').select('id,name,address,neighborhood').ilike('name', `%${fragment}%`).limit(30)),
    lookupEvents: fragment => dbEffect('intake.events', () => client.from('events').select('id,name,starts_at,venue_id,price,is_free,status,source,ticket_url,link,updated_at')
      .ilike('name', `%${fragment}%`).order('starts_at', { ascending: false }).limit(100)),
    reviewObservation: (id, note) => dbEffect('intake.review', () => client.from('intake_observations').update({ reviewed_at: new Date().toISOString(), review_note: note })
      .eq('id', id).select('id,reviewed_at').single()),

    submitCandidate: (id, expectedRevision, payload) => dbEffect('intake.submit', () => client.rpc('submit_intake_candidate', {
      p_id: id, p_expected_revision: expectedRevision, p_payload: payload,
    })),
    candidate: id => dbEffect('intake.candidate', () => client.from('intake_candidates').select('*').eq('id', id).single()),
    observationsByIds: ids => dbEffect('intake.observations', () => client.from('intake_observations').select('*').in('id', ids)),
    sourceAuthorities: usernames => dbEffect('intake.sources', () => client.from('instagram_sources').select('username,authority').in('username', usernames)),
    mediaForObservations: ids => dbEffect('intake.media', () => client.from('intake_media').select('*').in('observation_id', ids)).pipe(Effect.map(media => media as Media[])),
    venue: id => dbEffect('intake.venue', () => client.from('venues').select('id,name,neighborhood').eq('id', id).limit(1)).pipe(Effect.map(rows => rows[0] ?? null)),
    eventVenue: id => dbEffect('intake.venue', () => client.from('venues').select('name,neighborhood').eq('id', id).single()),
    venueHint: name => matchVenueEffect(name, 0.6, supabaseCatalog(client)).pipe(
      Effect.map(match => match.venue), Effect.mapError(error => new ImportOperationError({ operation: 'intake.venue-hint', message: error.message }))),
    linkedEventIds: id => dbEffect('intake.links', () => client.from('event_source_evidence').select('event_id').eq('candidate_id', id))
      .pipe(Effect.map(rows => rows.map(row => row.event_id as string))),
    eventsBetween: (from, to) => allRowsEffect(client, 'events', '*', query => query.gte('starts_at', from).lt('starts_at', to).order('id')),
    eventsByIds: ids => dbEffect('intake.targets', () => client.from('events').select('*').in('id', ids)),
    artworkUrl: (_eventId, media) => publicArtworkUrl(storageOrigin, media),
    insertPlan: plan => dbEffect('intake.plan', () => client.from('intake_plans').insert(plan).select().single()).pipe(Effect.map(row => row as IntakePlanRow)),
    plan: id => dbEffect('intake.plan', () => client.from('intake_plans').select('*').eq('id', id).single()).pipe(Effect.map(row => row as IntakePlanRow)),
    publishingEnabled: () => dbEffect('intake.policy', () => client.from('intake_policy').select('publishing_enabled').single()).pipe(Effect.map(row => !!row.publishing_enabled)),
    checkPlan: id => ok(dbEffect('intake.check-plan', () => client.rpc('check_intake_plan', { p_plan_id: id }))),
    preparePlan: (id, payload) => ok(dbEffect('intake.prepare', () => client.from('intake_plans').update({ payload }).eq('id', id).is('receipt', null).select().single())),
    artworkMedia: id => dbEffect('intake.artwork', () => client.from('intake_media').select('*').eq('id', id).single()).pipe(Effect.map(row => row as Media)),
    publishArtwork: media => Effect.gen(function*() {
      const stored = yield* dbEffect('intake.download', () => client.storage.from('instagram-evidence').download(media.object_key))
      yield* dbEffect('intake.publish-artwork', () => client.storage.from('event-artwork').upload(media.object_key, stored, { contentType: media.content_type, upsert: true, cacheControl: '31536000' }))
    }),
    commitPlan: id => dbEffect('intake.commit', () => client.rpc('commit_intake_plan', { p_plan_id: id })),
    replayReceipt: plan => Effect.succeed(plan.receipt!),

    allVenues: () => allRowsEffect(client, 'venues', venueColumns, query => query.order('id')).pipe(Effect.map(rows => rows as unknown as VenueRow[])),
    // Not the importers' matchVenueEffect: it reads any RPC error as "no match".
    similarVenues: (name, threshold) => dbEffect('intake.venue-similar', () => client.rpc('intake_similar_venues', { p_name: name, p_threshold: threshold }))
      .pipe(Effect.map(rows => rows as Array<VenueRow & { similarity: number }>)),
    completeVenue: (id, fill) => {
      let update = client.from('venues').update(fill).eq('id', id)
      for (const field of Object.keys(fill)) update = update.is(field, null)
      return dbEffect('intake.venue-complete', () => update.select(venueColumns)).pipe(Effect.map(rows => rows as VenueRow[]))
    },
    venueRow: id => dbEffect('intake.venue-read', () => client.from('venues').select(venueColumns).eq('id', id).single()).pipe(Effect.map(row => row as VenueRow)),
    createVenue: venue => importTry('intake.venue-create', () => createVenue(venue as VenueInsert, client)),
    recordVenueEvidence: row => ok(dbEffect('intake.venue-evidence', () => client.from('venue_review_queue').insert(row).select('id').single())),
    futureCandidates: today => allRowsEffect(client, 'intake_candidates', 'id,revision,payload,updated_at', query => query.gte('payload->>date', today).order('id'))
      .pipe(Effect.map(rows => rows as never)),
    plansFor: ids => allRowsEffect(client, 'intake_plans', 'candidate_id,revision,action,reasons,receipt,created_at', query => query.in('candidate_id', ids).order('created_at'))
      .pipe(Effect.map(rows => rows as never)),
  }
}
