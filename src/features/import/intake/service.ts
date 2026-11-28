import { Effect } from 'effect'
import { encodeArtworkRef } from '#shared/lib/artwork-ref.ts'
import { hasRefusedPublisherSearchInput } from '#shared/lib/db/publisher-field-authority.ts'
import type { EventInsert } from '#shared/lib/types.ts'
import { EMPTY_FACETS, type EventFacets } from '#shared/lib/search-facets.ts'
import { CURRENT_EMBEDDING_VERSION, embedEventWithDocument } from '#shared/lib/ai/embeddings.ts'
import { buildDescriptionPresentationFields } from '#features/events/lib/description-presentation.server.ts'
import { importTry, ImportOperationError } from '../core/effect-utils.ts'
import { candidateError, decodeCandidate, isOfficialPage, type Candidate } from './schema.ts'
import { officialSites, verifyOfficialPagesEffect, type ReadPage, type RenderPage } from './official-page.ts'
import { baDate, baTime, candidateStart, candidateDoors, decideMatch, descriptionChanged, searchInputsChanged, validateEvidence, normalizeTitle, ticketDestinationChanged,
  hasOfficialTicketEvidence, hasPostTicketEvidence, retainedIntakeDoors, SAME_CLOCK_REASON, SAME_CLOCK_RETAINED_REASON, separatelyCitedDoors,
  intakePageEvidence, intakePublisherPolicy, intakeStartProposal, suppliedDetailFacts, type CatalogMatch, type Media, type Observation } from './planning.ts'
import type { IntakePlanRow, IntakeStore } from './store.ts'

export type IntakePlan = IntakePlanRow
const failure = (message: string) => new ImportOperationError({ operation: 'intake', message })

export const submitCandidateEffect = Effect.fn('intake.submit')(function*(store: IntakeStore, input: unknown) {
  const candidate = yield* Effect.try({ try: () => decodeCandidate(input),
    catch: error => new ImportOperationError({ operation: 'intake.input', message: candidateError(error, input) }) })
  const { expected_revision, ...payload } = candidate
  // A mistyped ID would otherwise surface later as a preview reason that reads like a tool bug.
  const unknown = (field: string, id: string, kind: string) =>
    new ImportOperationError({ operation: 'intake.input', message: `${field} ${id} is not a catalog ${kind}; copy the ID from lookup` })
  if (candidate.venue_id && !(yield* store.venue(candidate.venue_id))) return yield* unknown('venue_id', candidate.venue_id, 'venue')
  if (candidate.target_event_id && !(yield* store.eventsByIds([candidate.target_event_id])).length) {
    return yield* unknown('target_event_id', candidate.target_event_id, 'event')
  }
  return yield* store.submitCandidate(candidate.id, expected_revision, payload)
})

export const readEvidenceEffect = Effect.fn('intake.evidence')(function*(store: IntakeStore, candidate: Candidate) {
  const ids = [...new Set(candidate.evidence.flatMap(item => isOfficialPage(item) ? [] : [item.observation_id]))]
  return yield* Effect.all({
    observations: Effect.gen(function* () {
      const posts = yield* store.observationsByIds(ids)
      const sources = yield* store.sourceAuthorities([...new Set(posts.map(post => post.source_username as string))])
      return posts.map(post => ({ ...post, authority: sources.find(source => source.username === post.source_username)?.authority })) as Observation[]
    }),
    media: store.mediaForObservations(ids),
  }, { concurrency: 2 })
})

export const previewCandidateEffect = Effect.fn('intake.preview')(function*(store: IntakeStore, id: string, now = new Date(),
  readPage?: ReadPage, renderPage?: RenderPage) {
  const row = yield* store.candidate(id)
  const candidate = yield* Effect.try({ try: () => decodeCandidate({ ...row.payload, expected_revision: row.revision }), catch: () => failure('Stored candidate is invalid') })
  const { observations, media } = yield* readEvidenceEffect(store, candidate)
  const reasons: string[] = []
  // Changed source observations invalidate earlier evidence even if the candidate was not edited yet.
  const currentObservations = yield* Effect.forEach(observations, post => Effect.gen(function* () {
    const latest = yield* store.latestObservation(post.post_id)
    return latest?.id === post.id
  }), { concurrency: 4 })
  if (currentObservations.includes(false)) reasons.push('Source post changed; review the newest observation')
  let venueName = candidate.venue_name
  if (candidate.venue_id) {
    const venue = yield* store.venue(candidate.venue_id)
    if (!venue) reasons.push(`Selected venue does not exist: ${candidate.venue_id}`)
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
    for (const target of targets) {
      const index = catalog.findIndex(event => event.id === target.id)
      // The explicit target read includes publisher authority even if the event was already in the day window.
      if (index === -1) catalog.push(target)
      else catalog[index] = target
    }
  }
  const target = candidate.intent !== 'link' && explicitIds.length === 1 ? catalog.find(event => event.id === explicitIds[0]) : undefined
  const candidateTimestamp = Effect.try({ try: () => candidateStart(candidate), catch: () => failure('Invalid calendar date') })
  const proposedStart = intakeStartProposal(candidate, target, yield* candidateTimestamp.pipe(Effect.orElseSucceed(() => `${candidate.date}T00:00:00-03:00`)))
  const schedule = intakePublisherPolicy(target, proposedStart.starts_at, proposedStart.time_tba)
  const evidence = intakePageEvidence(candidate.evidence, schedule.keptFacts)
  const evidenceCandidate = { ...candidate, evidence, ...(schedule.discardDoors ? { doors_time: undefined, doors_date: undefined } : {}) }
  if (evidence.some(isOfficialPage)) {
    const pageSites = yield* officialPageSitesEffect(store, candidate.venue_id, candidate.ticket_url, evidence, observations, media)
    reasons.push(...yield* verifyOfficialPagesEffect(evidence, { name: candidate.name, date: candidate.date, time: candidate.time,
      doorsTime: evidenceCandidate.doors_time, doorsDate: evidenceCandidate.doors_date, ...pageSites }, readPage, renderPage))
  }
  reasons.push(...validateEvidence(evidenceCandidate, observations, media, now, venueName, schedule.keptFacts))
  const decision = decideMatch(candidate, catalog as unknown as CatalogMatch[], linkedIds, reasons)
  const artworkNote = candidate.artwork_note?.trim() || null
  if (decision.action !== 'link' && candidate.intent !== 'link' && !candidate.artwork_media_id && !artworkNote) {
    decision.action = 'held'; decision.reasons.push('Select retained artwork or give a reason in artwork_note')
  }
  if (decision.action === 'create' && candidate.ticket_url && !hasOfficialTicketEvidence(candidate.evidence, candidate.ticket_url) &&
    !hasPostTicketEvidence(candidate.evidence, observations, media, candidate.ticket_url)) {
    decision.action = 'held'; decision.reasons.push('Ticket evidence must quote the complete destination URL')
  }
  if (decision.action === 'update' && !observations.some(post => post.authority === 'venue' || post.authority === 'organizer')) {
    decision.action = 'held'; decision.reasons.push('Corrections need organizer or venue evidence')
  }
  const old = decision.target ? catalog.find(event => event.id === decision.target!.id) : undefined
  const flyer = media.find(item => item.id === candidate.artwork_media_id)
  const eventId = decision.target?.id ?? crypto.randomUUID()
  const description = [candidate.description_es, schedule.keptFacts.has('price') ? null : candidate.price_note].filter(Boolean).join('\n\n') || null
  const payload: EventInsert = {
    name: candidate.name, ...proposedStart, ...(decision.action === 'held' ? { starts_at: `${candidate.date}T00:00:00-03:00` } : {}),
    venue_id: candidate.venue_id,
    description_es: description ?? old?.description_es as string | null ?? null,
    description_en: candidate.description_en ?? (description && description !== old?.description_es ? null : old?.description_en as string | null ?? null),
    categories: [...candidate.categories],
    facets: (old?.facets ?? EMPTY_FACETS) as EventFacets,
    price: candidate.price_kind === 'fixed' ? candidate.price_ars : candidate.price_kind === 'free' ? 0 :
      candidate.price_kind === 'unknown' ? old?.price as number | null ?? null : null,
    is_free: candidate.price_kind === 'free' || candidate.price_kind === 'unknown' && old?.is_free === true,
    ticket_url: candidate.ticket_url ?? old?.ticket_url as string | null ?? null,
    ...(candidate.organizer ? { organizer_name: candidate.organizer.name.trim(), organizer_url: candidate.organizer.url ?? null } : {}),
    performers: candidate.performers?.map(credit => ({ ...credit, name: credit.name.trim() })),
    offers_valid_from: candidate.offers_valid_from,
    doors_at: decision.action === 'held' ? undefined : candidateDoors(candidate),
    source: 'instagram', external_id: candidate.id, status: candidate.status,
    image_url: flyer ? encodeArtworkRef({ kind: 'stored', key: flyer.object_key, contentType: flyer.content_type })
      : old?.image_url as string | null ?? null,
    image_width: flyer ? null : old?.image_width as number | null ?? null,
    image_height: flyer ? null : old?.image_height as number | null ?? null,
    link: observations[0]?.post_url ?? null,
    description_unavailable: !description && !old?.description_es,
    enrichment_status: description || old?.description_es ? 'completed' : 'skipped',
  }
  const oldStart = typeof old?.starts_at === 'string' ? old.starts_at : undefined
  if (decision.action === 'update' && old && oldStart) {
    const moved = Date.parse(oldStart) !== Date.parse(schedule.startsAt)
    const startChanged = Boolean(old.time_tba) || moved
    const proposedDoors = schedule.discardDoors ? undefined : payload.doors_at
    const retainedDoors = startChanged ? retainedIntakeDoors(old.doors_at, baDate(oldStart) === baDate(schedule.startsAt), schedule.startsAt, schedule.timeTba) : null
    const doors = proposedDoors ?? retainedDoors
    if (doors && !schedule.timeTba) {
      if (Date.parse(doors) > Date.parse(schedule.startsAt)) {
        decision.action = 'held'; decision.reasons.push('Doors cannot follow the known start time')
      }
      const doorsTime = baTime(doors), doorsRetained = !proposedDoors
      if (doorsTime === baTime(schedule.startsAt) && !separatelyCitedDoors(evidence, doorsTime, observations, doorsRetained)) {
        decision.action = 'held'; decision.reasons.push(doorsRetained ? SAME_CLOCK_RETAINED_REASON : SAME_CLOCK_REASON)
      }
    }
    if (!moved) payload.ends_at = old.ends_at as string | null
    if (!descriptionChanged(old, payload)) Object.assign(payload, storedPresentation(old), {
      description_unavailable: old.description_unavailable, enrichment_status: old.enrichment_status,
    })
    if (!searchInputsChanged(old, payload)) Object.assign(payload, storedSearch(old))
    const changes = suppliedDetailFacts(candidate)
    if (old.status !== payload.status) changes.push('status')
    if (moved) changes.push('date')
    if (!schedule.timeTba && startChanged) changes.push('time')
    if (ticketDestinationChanged(old.ticket_url, candidate.ticket_url) ||
      (payload.offers_valid_from !== undefined && old.offers_valid_from !== payload.offers_valid_from)) changes.push('ticket')
    if (old.venue_id !== payload.venue_id) changes.push('venue')
    if (old.price !== payload.price || old.is_free !== payload.is_free) changes.push('price')
    // An official page can support a new event, but a correction still needs the organizer's or venue's own post.
    for (const field of changes) if (!schedule.keptFacts.has(field) && !(field === 'ticket' ? hasPostTicketEvidence(candidate.evidence, observations, media, payload.ticket_url, true) :
      candidate.evidence.some(evidence => !isOfficialPage(evidence) && evidence.fields.some(item => item === field) &&
        observations.some(post => post.id === evidence.observation_id && (post.authority === 'organizer' || post.authority === 'venue'))))) {
      decision.action = 'held'; decision.reasons.push(`Correction of ${field} needs direct organizer or venue evidence`)
    }
  }
  const plan = yield* store.insertPlan({
    candidate_id: id, revision: row.revision, action: decision.action,
    event_id: eventId, expected_event_updated_at: decision.target?.updated_at ?? null,
    payload, artwork_media_id: candidate.artwork_media_id, artwork_note: artworkNote,
    evidence: candidate.evidence, reasons: [...new Set(decision.reasons)],
  })
  return { ...plan, venue_name: venueName } as IntakePlan & { venue_name: string | null }
})

/** The allowed sites for ordinary evidence and the stored venue website required by calendar evidence. */
const officialPageSitesEffect = (store: IntakeStore, venueId: string | null, ticketUrl: string | null, evidence: Candidate['evidence'],
  observations: ReadonlyArray<Record<string, unknown>>, media: readonly Media[]) => Effect.gen(function*() {
  const venue = venueId ? yield* store.venue(venueId) : null
  const venueWebsite = venue?.website ?? null
  const ticketBacked = hasPostTicketEvidence(evidence, observations, media, ticketUrl)
  const sites = officialSites({ website: venueWebsite, ticketUrl: ticketBacked ? ticketUrl : null,
    captions: observations.map(post => String(post.caption ?? '')) })
  return { sites, venueWebsite }
})

/** Reconstruct the local facts from the plan before verifying the cited pages again. */
const planFacts = ({ payload }: IntakePlanRow) => {
  return { name: payload.name, date: baDate(payload.starts_at),
    time: payload.time_tba ? null : baTime(payload.starts_at),
    ...(payload.doors_at ? { doorsDate: baDate(payload.doors_at), doorsTime: baTime(payload.doors_at) } : {}) }
}

const storedPresentation = (event: Record<string, unknown>) => ({
  description_display_es: event.description_display_es as string | null,
  description_display_en: event.description_display_en as string | null,
  description_summary_es: event.description_summary_es as string | null,
  description_summary_en: event.description_summary_en as string | null,
})
const storedSearch = (event: Record<string, unknown>) => ({
  search_document: event.search_document as string | null,
  embedding_version: event.embedding_version as number,
})

type Publishers = {
  embed: typeof embedEventWithDocument;
  presentation: typeof buildDescriptionPresentationFields;
  readPage?: ReadPage;
}
export const commitPlanEffect = Effect.fn('intake.commit')(function*(store: IntakeStore, id: string,
  publishers: Publishers = { embed: embedEventWithDocument, presentation: buildDescriptionPresentationFields }, renderPage?: RenderPage) {
  const plan = yield* store.plan(id)
  if (plan.receipt) return yield* store.replayReceipt(plan)
  const enabled = yield* store.publishingEnabled
  if (!enabled || plan.action === 'held') return yield* failure('Publishing is disabled or this plan is held')
  // Run all stale-plan checks before provider calls or making artwork public.
  yield* store.checkPlan(id)
  const [previous] = plan.action === 'update' && (!plan.payload.embedding || plan.evidence.some(isOfficialPage))
    ? yield* store.eventsByIds([plan.event_id]) : []
  const { keptFacts } = intakePublisherPolicy(previous, plan.payload.starts_at, plan.payload.time_tba)
  const evidence = intakePageEvidence(plan.evidence, keptFacts)
  // A page can change after preview, so commit fetches it again for facts that can apply.
  if (evidence.some(isOfficialPage)) {
    const postIds = [...new Set(evidence.flatMap(item => isOfficialPage(item) ? [] : [item.observation_id]))]
    const observations = yield* store.observationsByIds(postIds)
    const media = evidence.some(item => !isOfficialPage(item) && item.media_id && item.fields.includes('ticket'))
      ? yield* store.mediaForObservations(postIds) : []
    const pageSites = yield* officialPageSitesEffect(store, plan.payload.venue_id ?? null, plan.payload.ticket_url ?? null, evidence, observations, media)
    const pages = yield* verifyOfficialPagesEffect(evidence, { ...planFacts(plan), ...pageSites }, publishers.readPage, renderPage)
    if (pages.length) return yield* failure(pages.join('; '))
  }
  if (plan.action !== 'link' && !plan.payload.embedding) {
    const rebuildSearch = !previous || searchInputsChanged(previous, plan.payload) && !hasRefusedPublisherSearchInput(previous, plan.payload)
    const rebuildPresentation = !previous || descriptionChanged(previous, plan.payload)
    const [search, presentation] = yield* Effect.all([
      rebuildSearch ? Effect.gen(function* () {
        const venue = yield* store.eventVenue(plan.payload.venue_id)
        return yield* importTry('intake.embedding', () => publishers.embed({ ...plan.payload,
          is_free: plan.payload.is_free || plan.payload.price != null ? plan.payload.is_free : undefined,
          venue_name: venue.name, venue_neighborhood: venue.neighborhood }))
      }) : Effect.succeed(null),
      rebuildPresentation ? importTry('intake.presentation', () => publishers.presentation(plan.payload))
        : Effect.succeed(storedPresentation(previous!)),
    ], { concurrency: 2 })
    if (search && (!search.embedding || search.embedding.length !== 1536 || !search.embedding.every(Number.isFinite))) {
      return yield* failure('A valid embedding is required before publishing')
    }
    yield* store.preparePlan(id, { ...plan.payload, ...presentation, ...(search
      ? { embedding: search.embedding!, search_document: search.searchDocument, embedding_version: CURRENT_EMBEDDING_VERSION }
      : storedSearch(previous!)) })
  }
  if (plan.action !== 'link' && plan.artwork_media_id) {
    const media = yield* store.artworkMedia(plan.artwork_media_id)
    yield* store.publishArtwork(media)
  }
  return yield* store.commitPlan(id)
})
