import { Effect } from 'effect'
import type { EventInsert } from '#shared/lib/types.ts'
import { EMPTY_FACETS, type EventFacets } from '#shared/lib/search-facets.ts'
import { CURRENT_EMBEDDING_VERSION, embedEventWithDocument } from '#shared/lib/ai/embeddings.ts'
import { buildDescriptionPresentationFields } from '#features/events/lib/description-presentation.server.ts'
import { importTry, ImportOperationError } from '../core/effect-utils.ts'
import { decodeCandidate, type Candidate } from './schema.ts'
import { candidateStart, decideMatch, validateEvidence, normalizeTitle, type CatalogMatch, type Observation } from './planning.ts'
import type { IntakePlanRow, IntakeStore } from './store.ts'

export type IntakePlan = IntakePlanRow
export { publicArtworkUrl } from './store-supabase.ts'
const failure = (message: string) => new ImportOperationError({ operation: 'intake', message })

export const submitCandidateEffect = Effect.fn('intake.submit')(function*(store: IntakeStore, input: unknown) {
  const candidate = yield* Effect.try({ try: () => decodeCandidate(input),
    catch: () => new ImportOperationError({ operation: 'intake.input', message: 'Invalid candidate; see the candidate schema' }) })
  const { expected_revision, ...payload } = candidate
  return yield* store.submitCandidate(candidate.id, expected_revision, payload)
})

export const readEvidenceEffect = Effect.fn('intake.evidence')(function*(store: IntakeStore, candidate: Candidate) {
  const ids = [...new Set(candidate.evidence.map(item => item.observation_id))]
  return yield* Effect.all({
    observations: Effect.gen(function* () {
      const posts = yield* store.observationsByIds(ids)
      const sources = yield* store.sourceAuthorities([...new Set(posts.map(post => post.source_username as string))])
      return posts.map(post => ({ ...post, authority: sources.find(source => source.username === post.source_username)?.authority })) as Observation[]
    }),
    media: store.mediaForObservations(ids),
  }, { concurrency: 2 })
})

export const previewCandidateEffect = Effect.fn('intake.preview')(function*(store: IntakeStore, id: string, now = new Date()) {
  const row = yield* store.candidate(id)
  const candidate = yield* Effect.try({ try: () => decodeCandidate({ ...row.payload, expected_revision: row.revision }), catch: () => failure('Stored candidate is invalid') })
  const { observations, media } = yield* readEvidenceEffect(store, candidate)
  const reasons = validateEvidence(candidate, observations, media, now)
  // Changed source observations invalidate earlier evidence even if the candidate was not edited yet.
  const currentObservations = yield* Effect.forEach(observations, post => Effect.gen(function* () {
    const latest = yield* store.latestObservation(post.post_id)
    return latest?.id === post.id
  }), { concurrency: 4 })
  if (currentObservations.includes(false)) reasons.push('Source post changed; review the newest observation')
  let venueName = candidate.venue_name
  if (candidate.venue_id) {
    const venue = yield* store.venue(candidate.venue_id)
    if (!venue) reasons.push('Selected venue does not exist')
    else {
      venueName = venue.name
      if (!venue.neighborhood) reasons.push('Venue location in Buenos Aires must be confirmed')
      if (candidate.venue_name && normalizeTitle(candidate.venue_name) !== normalizeTitle(venue.name)) reasons.push('Venue name differs from selected venue; resolve its identity')
    }
  } else if (candidate.venue_name) {
    // Advisory only: without a venue_id the plan is held anyway, so a failed lookup just omits the hint.
    const hint = yield* store.venueHint(candidate.venue_name).pipe(Effect.orElseSucceed(() => null))
    if (hint) reasons.push(`Possible venue: ${hint.name} (${hint.id}); confirm and submit a new revision`)
  }
  const linkedIds = yield* store.linkedEventIds(candidate.id)
  const explicitIds = [...new Set([...linkedIds, ...(candidate.target_event_id ? [candidate.target_event_id] : [])])]
  const day = new Date(`${candidate.date}T00:00:00-03:00`)
  const catalog = Number.isNaN(day.getTime()) ? [] : yield* store.eventsBetween(day.toISOString(), new Date(day.getTime() + 86400000).toISOString())
  if (explicitIds.length) {
    const targets = yield* store.eventsByIds(explicitIds)
    for (const target of targets) if (!catalog.some(event => event.id === target.id)) catalog.push(target)
  }
  const decision = decideMatch(candidate, catalog as unknown as CatalogMatch[], linkedIds, reasons)
  if (decision.action === 'update' && !observations.some(post => post.authority === 'venue' || post.authority === 'organizer')) {
    decision.action = 'held'; decision.reasons.push('Corrections need organizer or venue evidence')
  }
  const old = decision.target ? catalog.find(event => event.id === decision.target!.id) : undefined
  const flyer = media.find(item => item.id === candidate.artwork_media_id)
  const eventId = decision.target?.id ?? crypto.randomUUID()
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
    image_url: flyer ? store.artworkUrl(eventId, flyer) : old?.image_url as string | null ?? null,
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
  const plan = yield* store.insertPlan({
    candidate_id: id, revision: row.revision, action: decision.action,
    event_id: eventId, expected_event_updated_at: decision.target?.updated_at ?? null,
    payload, artwork_media_id: candidate.artwork_media_id, evidence: candidate.evidence, reasons: [...new Set(decision.reasons)],
  })
  return { ...plan, venue_name: venueName } as IntakePlan & { venue_name: string | null }
})

type Publishers = {
  embed: typeof embedEventWithDocument;
  presentation: typeof buildDescriptionPresentationFields;
}
export const commitPlanEffect = Effect.fn('intake.commit')(function*(store: IntakeStore, id: string,
  publishers: Publishers = { embed: embedEventWithDocument, presentation: buildDescriptionPresentationFields }) {
  const plan = yield* store.plan(id)
  if (plan.receipt) return yield* store.replayReceipt(plan)
  const enabled = yield* store.publishingEnabled()
  if (!enabled || plan.action === 'held') return yield* failure('Publishing is disabled or this plan is held')
  // Run all stale-plan checks before provider calls or making artwork public.
  yield* store.checkPlan(id)
  if (plan.action !== 'link' && !plan.payload.embedding) {
    const venue = yield* store.eventVenue(plan.payload.venue_id)
    const [{ embedding, searchDocument }, presentation] = yield* Effect.all([
      importTry('intake.embedding', () => publishers.embed({ ...plan.payload,
        is_free: plan.payload.is_free || plan.payload.price != null ? plan.payload.is_free : undefined,
        venue_name: venue.name, venue_neighborhood: venue.neighborhood })),
      importTry('intake.presentation', () => publishers.presentation(plan.payload)),
    ], { concurrency: 2 })
    if (!embedding || embedding.length !== 1536 || !embedding.every(Number.isFinite)) return yield* failure('A valid embedding is required before publishing')
    yield* store.preparePlan(id, {
      ...plan.payload, ...presentation, embedding, search_document: searchDocument, embedding_version: CURRENT_EMBEDDING_VERSION,
    })
  }
  if (plan.action !== 'link' && plan.artwork_media_id) {
    const media = yield* store.artworkMedia(plan.artwork_media_id)
    yield* store.publishArtwork(media)
  }
  return yield* store.commitPlan(id)
})
