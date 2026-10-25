import { Effect } from 'effect'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { EventInsert } from '#shared/lib/types.ts'
import { EMPTY_FACETS, type EventFacets } from '#shared/lib/search-facets.ts'
import { CURRENT_EMBEDDING_VERSION, embedEventWithDocument } from '#shared/lib/ai/embeddings.ts'
import { buildDescriptionPresentationFields } from '#features/events/lib/description-presentation.server.ts'
import { importTry, ImportOperationError } from '../core/effect-utils.ts'
import { matchVenueEffect } from '../scrapers/venue-matcher.ts'
import { decodeCandidate, type Candidate } from './schema.ts'
import { candidateStart, decideMatch, validateEvidence, normalizeTitle, type CatalogMatch, type Observation, type Media } from './planning.ts'
import { allRowsEffect, dbEffect } from './repository.ts'

type CandidateRow = { id: string; revision: number; payload: Candidate }
export type IntakePlan = {
  id: string; candidate_id: string; revision: number; action: 'held' | 'create' | 'update' | 'link';
  event_id: string; expected_event_updated_at: string | null; payload: EventInsert;
  artwork_media_id: string | null;
  evidence: Candidate['evidence']; reasons: string[]; receipt: Record<string, unknown> | null;
}
const failure = (message: string) => new ImportOperationError({ operation: 'intake', message })

export const submitCandidateEffect = Effect.fn('intake.submit')(function*(client: SupabaseClient, input: unknown) {
  const candidate = yield* Effect.try({ try: () => decodeCandidate(input), catch: () => failure('Invalid candidate; see the candidate schema') })
  const { expected_revision, ...payload } = candidate
  return yield* dbEffect('intake.submit', () => client.rpc('submit_intake_candidate', {
    p_id: candidate.id, p_expected_revision: expected_revision, p_payload: payload,
  }))
})

export const readEvidenceEffect = Effect.fn('intake.evidence')(function*(client: SupabaseClient, candidate: Candidate) {
  const ids = [...new Set(candidate.evidence.map(item => item.observation_id))]
  const posts = yield* dbEffect('intake.observations', () => client.from('intake_observations').select('*').in('id', ids))
  const sources = yield* dbEffect('intake.sources', () => client.from('instagram_sources').select('username,authority').in('username', [...new Set(posts.map(post => post.source_username))]))
  const observations: Observation[] = posts.map(post => ({ ...post, authority: sources.find(source => source.username === post.source_username)?.authority }))
  const media = yield* dbEffect('intake.media', () => client.from('intake_media').select('*').in('observation_id', ids))
  return { observations, media: media as Media[] }
})

export function publicArtworkUrl(storageOrigin: string, media: Media): string {
  const origin = new URL(storageOrigin)
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.port) throw new Error('Invalid storage origin')
  return `${origin.origin}/storage/v1/object/public/event-artwork/${media.object_key}`
}

export const previewCandidateEffect = Effect.fn('intake.preview')(function*(client: SupabaseClient, id: string, storageOrigin: string, now = new Date()) {
  const row = (yield* dbEffect('intake.candidate', () => client.from('intake_candidates').select('*').eq('id', id).single())) as CandidateRow
  const candidate = yield* Effect.try({ try: () => decodeCandidate({ ...row.payload, expected_revision: row.revision }), catch: () => failure('Stored candidate is invalid') })
  const { observations, media } = yield* readEvidenceEffect(client, candidate)
  const reasons = validateEvidence(candidate, observations, media, now)
  // Changed source observations invalidate earlier evidence even if the candidate was not edited yet.
  for (const post of observations) {
    const latest = yield* dbEffect('intake.latest', () => client.from('intake_observations').select('id').eq('post_id', post.post_id).order('observed_at', { ascending: false }).limit(1))
    if (latest[0]?.id !== post.id) reasons.push('Source post changed; review the newest observation')
  }
  let venueName = candidate.venue_name
  if (candidate.venue_id) {
    const venues = yield* dbEffect('intake.venue', () => client.from('venues').select('id,name,neighborhood').eq('id', candidate.venue_id).limit(1))
    const venue = venues[0]
    if (!venue) reasons.push('Selected venue does not exist')
    else {
      venueName = venue.name
      if (!venue.neighborhood) reasons.push('Venue location in Buenos Aires must be confirmed')
      if (candidate.venue_name && normalizeTitle(candidate.venue_name) !== normalizeTitle(venue.name)) reasons.push('Venue name differs from selected venue; resolve its identity')
    }
  } else if (candidate.venue_name) {
    const match = yield* matchVenueEffect(candidate.venue_name, 0.6, client).pipe(Effect.mapError(error => failure(error.message)))
    if (match.venue) reasons.push(`Possible venue: ${match.venue.name} (${match.venue.id}); confirm and submit a new revision`)
  }
  const linked = yield* dbEffect('intake.links', () => client.from('event_source_evidence').select('event_id').eq('candidate_id', candidate.id))
  const linkedIds = linked.map(item => item.event_id as string)
  const explicitIds = [...new Set([...linkedIds, ...(candidate.target_event_id ? [candidate.target_event_id] : [])])]
  const day = new Date(`${candidate.date}T00:00:00-03:00`)
  const catalog = Number.isNaN(day.getTime()) ? [] : yield* allRowsEffect(client, 'events', '*', query => query
    .gte('starts_at', day.toISOString()).lt('starts_at', new Date(day.getTime() + 86400000).toISOString()).order('id'))
  if (explicitIds.length) {
    const targets = yield* dbEffect('intake.targets', () => client.from('events').select('*').in('id', explicitIds))
    for (const target of targets) if (!catalog.some(event => event.id === target.id)) catalog.push(target)
  }
  const decision = decideMatch(candidate, catalog as unknown as CatalogMatch[], linkedIds, reasons)
  if (decision.action === 'update' && !observations.some(post => post.authority === 'venue' || post.authority === 'organizer')) {
    decision.action = 'held'; decision.reasons.push('Corrections need organizer or venue evidence')
  }
  const old = decision.target ? catalog.find(event => event.id === decision.target!.id) : undefined
  const flyer = media.find(item => item.id === candidate.artwork_media_id)
  const description = [candidate.description_es, candidate.price_note].filter(Boolean).join('\n\n') || null
  const payload: EventInsert = {
    name: candidate.name, starts_at: decision.action === 'held' ? `${candidate.date}T00:00:00-03:00` : candidateStart(candidate),
    time_tba: candidate.time === null, venue_id: candidate.venue_id,
    description_es: description ?? old?.description_es as string | null ?? null,
    description_en: candidate.description_en ?? (description ? null : old?.description_en as string | null ?? null),
    categories: [...candidate.categories],
    facets: (old?.facets ?? EMPTY_FACETS) as EventFacets,
    price: candidate.price_kind === 'fixed' ? candidate.price_ars : candidate.price_kind === 'free' ? 0 :
      candidate.price_kind === 'unknown' ? old?.price as number | null ?? null : null,
    is_free: candidate.price_kind === 'free' || candidate.price_kind === 'unknown' && old?.is_free === true,
    ticket_url: candidate.ticket_url ?? old?.ticket_url as string | null ?? null,
    source: 'instagram', external_id: candidate.id, status: candidate.status,
    image_url: flyer ? publicArtworkUrl(storageOrigin, flyer) : old?.image_url as string | null ?? null,
    image_width: flyer ? null : old?.image_width as number | null ?? null,
    image_height: flyer ? null : old?.image_height as number | null ?? null,
    link: observations[0]?.post_url ?? null,
    description_unavailable: !description && !old?.description_es,
    enrichment_status: description || old?.description_es ? 'completed' : 'skipped',
  }
  payload.ends_at = old && new Date(String(old.starts_at)).getTime() === new Date(payload.starts_at).getTime() ? old.ends_at as string | null : null
  if (decision.action === 'update' && old) {
    const changes: string[] = []
    if (old.status !== payload.status) changes.push('status')
    if (new Date(String(old.starts_at)).getTime() !== new Date(payload.starts_at).getTime()) changes.push('date', ...(candidate.time ? ['time'] : []))
    if (old.venue_id !== payload.venue_id) changes.push('venue')
    if (old.price !== payload.price || old.is_free !== payload.is_free) changes.push('price')
    for (const field of changes) if (!candidate.evidence.some(evidence => evidence.fields.some(item => item === field) &&
      observations.some(post => post.id === evidence.observation_id && post.authority !== 'curator'))) {
      decision.action = 'held'; decision.reasons.push(`Correction of ${field} needs direct organizer or venue evidence`)
    }
  }
  const plan = yield* dbEffect('intake.plan', () => client.from('intake_plans').insert({
    candidate_id: id, revision: row.revision, action: decision.action,
    event_id: decision.target?.id ?? crypto.randomUUID(), expected_event_updated_at: decision.target?.updated_at ?? null,
    payload, artwork_media_id: candidate.artwork_media_id, evidence: candidate.evidence, reasons: [...new Set(decision.reasons)],
  }).select().single())
  return { ...plan, venue_name: venueName } as IntakePlan & { venue_name: string | null }
})

type Publishers = {
  embed: typeof embedEventWithDocument;
  presentation: typeof buildDescriptionPresentationFields;
}
export const commitPlanEffect = Effect.fn('intake.commit')(function*(client: SupabaseClient, id: string,
  publishers: Publishers = { embed: embedEventWithDocument, presentation: buildDescriptionPresentationFields }) {
  const plan = (yield* dbEffect('intake.plan', () => client.from('intake_plans').select('*').eq('id', id).single())) as IntakePlan
  if (plan.receipt) return plan.receipt
  const policy = yield* dbEffect('intake.policy', () => client.from('intake_policy').select('publishing_enabled').single())
  if (!policy.publishing_enabled || plan.action === 'held') return yield* failure('Publishing is disabled or this plan is held')
  // Run all stale-plan checks before provider calls or making artwork public.
  yield* dbEffect('intake.check-plan', () => client.rpc('check_intake_plan', { p_plan_id: id }))
  if (plan.action !== 'link' && !plan.payload.embedding) {
    const venue = yield* dbEffect('intake.venue', () => client.from('venues').select('name,neighborhood').eq('id', plan.payload.venue_id).single())
    const { embedding, searchDocument } = yield* importTry('intake.embedding', () => publishers.embed({ ...plan.payload,
      is_free: plan.payload.is_free || plan.payload.price != null ? plan.payload.is_free : undefined,
      venue_name: venue.name, venue_neighborhood: venue.neighborhood }))
    if (!embedding || embedding.length !== 1536 || !embedding.every(Number.isFinite)) return yield* failure('A valid embedding is required before publishing')
    const presentation = yield* importTry('intake.presentation', () => publishers.presentation(plan.payload))
    yield* dbEffect('intake.prepare', () => client.from('intake_plans').update({ payload: {
      ...plan.payload, ...presentation, embedding, search_document: searchDocument, embedding_version: CURRENT_EMBEDDING_VERSION,
    } }).eq('id', id).is('receipt', null).select().single())
  }
  if (plan.action !== 'link' && plan.artwork_media_id) {
    const media = yield* dbEffect('intake.artwork', () => client.from('intake_media').select('*').eq('id', plan.artwork_media_id).single())
    const stored = yield* dbEffect('intake.download', () => client.storage.from('instagram-evidence').download(media.object_key))
    yield* dbEffect('intake.publish-artwork', () => client.storage.from('event-artwork').upload(media.object_key, stored, { contentType: media.content_type, upsert: true, cacheControl: '31536000' }))
  }
  return yield* dbEffect('intake.commit', () => client.rpc('commit_intake_plan', { p_plan_id: id }))
})
