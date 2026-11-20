/**
 * Core Event Enrichment Logic
 *
 * Handles event description enrichment, venue extraction, and embedding generation
 * for automated scraping jobs. Uses existing AI functions from shared lib.
 */
import { Data, Effect } from 'effect'
import type { EventCredit, EventSourceDetails, Neighborhood } from '#shared/lib/types.ts'
import {
  enrichEventFull,
  extractVenueFromUrl,
  detectLanguage,
  translateText,
} from '#shared/lib/ai/enrichment.ts'
import { HttpError } from '#shared/lib/errors.ts'
import { getEnrichmentAdapter } from '#features/import/adapters/enrichment/registry.ts'
import { hasServerEnrichment, EnrichmentSkippedError } from '#features/import/adapters/enrichment-types.ts'
import type { ImportSource } from '#features/import/adapters/types.ts'
import {
  embedEventWithDocument,
  CURRENT_EMBEDDING_VERSION,
} from '#shared/lib/ai/embeddings.ts'
import { extractEventFacets, type EventFacetExtraction } from '#shared/lib/ai/extract-facets.ts'
import { isEmptyFacets, type EventFacets } from '#shared/lib/search-facets.ts'
import { buildDescriptionPresentationFields } from '#features/events/lib/description-presentation.server.ts'
import { type VenueSettlementResult, settleVenueEffect } from './venue-settlement.ts'
import { delayEffect } from './nominatim.ts'
import { importTry } from './effect-utils.ts'
import type { CatalogStore } from './catalog-store.ts'
import { enrichmentStageRecord, type EnrichmentProvenance } from './enrichment-provenance.ts'

// ============================================================================
// QUEUE SELECTION FILTERS
// ============================================================================

/**
 * Catch-up only selects events that have not started yet.
 * `now` is injectable so tests can pin the boundary.
 */
export function enrichmentStartsAtFloor(now: Date = new Date()): string {
  return now.toISOString()
}

// ============================================================================
// TYPES
// ============================================================================

export interface EventEnrichmentInput extends EventSourceDetails {
  enrichment_provenance?: EnrichmentProvenance | null
  id: string
  name: string
  link: string | null
  source: string
  categories?: string[] | null
  venue_id?: string | null // Existing venue ID (if any)
  description_es?: string | null // Existing Spanish description (translate-only fast path)
  description_en?: string | null // Existing English description (skip if already present)
  enrichment_status?: 'pending' | 'completed' | 'failed' | 'skipped' | null // Used to route the facets-only path
  embedding?: number[] | null // Existing embedding (facets-only path rewrites it only when facets are non-empty)
  price?: number | null // Existing price — embedded into the search document
  is_free?: boolean // Existing free/paid flag — embedded into the search document
}

export interface EventEnrichmentResult {
  eventId: string
  success: boolean
  enriched: boolean
  canceled?: boolean // Event page returned 404 - event marked as canceled
  error?: string
  venueSettlement?: VenueSettlementResult // Info about venue extraction/settlement
}

export interface EnrichmentStats {
  total: number
  enriched: number
  skipped: number
  failed: number
  canceled: number // Events whose pages returned 404 - marked as canceled
  errors: Array<{ eventId: string; eventName: string; error: string }>
}

export class EventEnrichmentError extends Data.TaggedError('EventEnrichmentError')<{
  readonly operation: string
  readonly message: string
  readonly cause?: unknown
}> {}

const enrichmentError = (operation: string, message: string, cause?: unknown) =>
  new EventEnrichmentError({ operation, message, cause })

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Resolve an existing venue's name + neighborhood by id, so an already-settled
 * venue feeds the canonical search document even when no new settlement happens
 * during this enrichment pass (e.g. sources that ship a venue_id at import).
 */
function getVenueNameAndNeighborhoodEffect(
  catalog: CatalogStore,
  venueId: string
): Effect.Effect<{ name: string | null; neighborhood: Neighborhood | null }, EventEnrichmentError> {
  return importTry('event-enrichment.load-venue', () => catalog.venueNameAndNeighborhood(venueId)).pipe(
    Effect.mapError((error) => enrichmentError('event-enrichment.load-venue', error.message, error)),
    Effect.map((venue) => ({ name: venue.name, neighborhood: venue.neighborhood as Neighborhood | null }))
  )
}

/**
 * Update event with enrichment data.
 */
function updateEventEnrichmentEffect(
  catalog: CatalogStore,
  eventId: string,
  data: EventSourceDetails & {
    description_es?: string | null
    description_en?: string | null
    description_display_es?: string | null
    description_display_en?: string | null
    description_summary_es?: string | null
    description_summary_en?: string | null
    embedding?: number[] | null
    search_document?: string | null
    embedding_version?: number
    venue_id?: string | null
    location_hidden?: boolean
    facets?: EventFacets
    enrichment_status?: 'pending' | 'completed' | 'failed' | 'skipped'
    enrichment_error?: string | null
    enriched_at?: string | null
    enrichment_provenance?: EnrichmentProvenance
    status?: 'scheduled' | 'canceled' | 'postponed' | 'past' | 'pending_review'
  }
): Effect.Effect<void, EventEnrichmentError> {
  return importTry('event-enrichment.update-event', () => catalog.updateEvent(eventId, data)).pipe(
    Effect.mapError((error) => enrichmentError('event-enrichment.update-event', `Failed to update event: ${error.message}`, error))
  )
}

// ============================================================================
// SINGLE EVENT ENRICHMENT
// ============================================================================

/**
 * Injectable dependency for structured-facet extraction, so tests can
 * supply a fake without mocking the whole extract-facets module (whose mock
 * registry leaks across files in a shared vitest process). Defaults to the
 * real implementation.
 */
export type ExtractFacetsFn = (
  input: {
    name: string
    description_es: string | null
    description_en?: string | null
    categories?: string[] | null
  }
) => Promise<EventFacetExtraction>

function missingCredits(input: EventSourceDetails, organizer?: EventCredit, performers?: readonly EventCredit[]): EventSourceDetails {
  return {
    ...(!input.organizer_name && organizer ? { organizer_name: organizer.name, organizer_url: organizer.url ?? null } : {}),
    ...(!input.performers?.length && performers?.length ? { performers } : {}),
  }
}

export interface EnrichSingleEventOptions {
  extractFacets?: ExtractFacetsFn
  buildPresentationFields?: typeof buildDescriptionPresentationFields
  translate?: typeof translateText
}

interface EnrichmentPayload {
  sourceObservedAt?: string | null
  sourceValidatedAt?: string | null
  description_es: string | null
  description_en: string | null
  venue_name: string | null
  organizer?: EventCredit
  location_hidden?: boolean
}

/**
 * Enrich a single event with description, venue, and embedding.
 */
function enrichmentTry<A>(operation: string, run: () => PromiseLike<A>) {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => enrichmentError(
      operation,
      cause instanceof Error ? cause.message : String(cause),
      cause,
    ),
  })
}

/**
 * Effect-native event enrichment graph. Vendor AI/browser calls are leaves;
 * the branching, persistence, and expected cancellation/fallback outcomes
 * stay in this program until the Trigger adapter runs it.
 */
export function enrichSingleEventEffect(
  catalog: CatalogStore,
  input: EventEnrichmentInput,
  options: EnrichSingleEventOptions = {}
): Effect.Effect<EventEnrichmentResult, EventEnrichmentError> {
  const { id, name, link, source, categories, venue_id, price, is_free } = input
  const extractFacets = options.extractFacets ?? extractEventFacets
  const buildPresentationFields = options.buildPresentationFields ?? buildDescriptionPresentationFields
  const translate = options.translate ?? translateText

  const program = Effect.gen(function* () {
    if (!link) {
      return {
        eventId: id,
        success: true,
        enriched: false,
        error: 'No link available',
      } satisfies EventEnrichmentResult
    }

    // Only a completed row gets the facets-only backfill. Imports arrive with an
    // embedding but still `pending`; they take the full path below, which reuses the
    // stored description and writes `completed`, so they leave the queue.
    if (input.description_es && input.enrichment_status === 'completed') {
      console.log(`[event-enrichment] Backfilling facets only for: ${name}`)
      const { organizer, performers, ...facets } = yield* enrichmentTry('event-enrichment.extract-facets', () => extractFacets({
        name,
        description_es: input.description_es!,
        description_en: input.description_en,
        categories,
      }))
      const credits = missingCredits(input, organizer, performers)

      if (isEmptyFacets(facets)) {
        yield* updateEventEnrichmentEffect(catalog, id, {
          facets,
          ...credits,
          enrichment_provenance: {
            ...input.enrichment_provenance,
            facets: enrichmentStageRecord('stored_description', {}, false),
          },
        })
      } else {
        let venueName: string | null = null
        let venueNeighborhood: Neighborhood | null = null
        if (venue_id) {
          const existingVenue = yield* getVenueNameAndNeighborhoodEffect(catalog, venue_id)
          venueName = existingVenue.name
          venueNeighborhood = existingVenue.neighborhood
        }

        const { embedding, searchDocument } = yield* enrichmentTry('event-enrichment.embed-facets', () =>
          embedEventWithDocument({
            name,
            description_es: input.description_es,
            description_en: input.description_en,
            categories: categories || null,
            facets,
            price: price ?? null,
            is_free,
            venue_name: venueName ?? null,
            venue_neighborhood: venueNeighborhood ?? null,
          })
        )

        yield* updateEventEnrichmentEffect(catalog, id, {
          facets,
          embedding,
          search_document: searchDocument,
          embedding_version: CURRENT_EMBEDDING_VERSION,
          ...credits,
          enrichment_provenance: {
            ...input.enrichment_provenance,
            facets: enrichmentStageRecord('stored_description', {}, true),
          },
        })
      }

      return {
        eventId: id,
        success: true,
        enriched: true,
      } satisfies EventEnrichmentResult
    }

    console.log(`[event-enrichment] Enriching: ${name}`)
    const adapter = getEnrichmentAdapter(source as ImportSource)
    const needsVenue = !venue_id

    if (adapter?.config.requiresClientSide && !adapter.serverEnrich) {
      yield* updateEventEnrichmentEffect(catalog, id, {
        enrichment_status: 'skipped',
        enrichment_error: `${source} requires client-side extraction`,
      })
      return {
        eventId: id,
        success: true,
        enriched: false,
      } satisfies EventEnrichmentResult
    }

    let enrichmentResult: EnrichmentPayload | null = null

    if (input.description_es) {
      console.log(`[event-enrichment] Reusing stored Spanish description for ${name}`)
      const organizer = (source === 'luma' || source === 'ba-tourism') && !input.organizer_name && adapter?.serverEnrich
        ? (yield* enrichmentTry('event-enrichment.detail-organizer', () => adapter.serverEnrich!(link, { organizerOnly: true })))?.organizer
        : undefined
      enrichmentResult = {
        organizer,
        // A stored description may have changed since a prior full pass.
        // Without an acquisition receipt for these exact inputs, age is unknown.
        sourceObservedAt: null,
        sourceValidatedAt: null,
        description_es: input.description_es,
        description_en: input.description_en
          ? input.description_en
          : yield* enrichmentTry('event-enrichment.translate-spanish', () =>
              translate(input.description_es!, 'es-to-en')
            ),
        venue_name: null,
      }
    } else if (adapter && hasServerEnrichment(adapter)) {
      console.log(`[event-enrichment] Using adapter for ${source}`)
      enrichmentResult = yield* enrichmentTry('event-enrichment.server-adapter', () =>
        adapter.serverEnrich(link, { extractVenue: needsVenue })
      )

      // Persist the source's privacy reading first, so a missing description or a later
      // translation or embedding failure can't leave a newly hidden event public with a venue.
      if (enrichmentResult?.location_hidden !== undefined) {
        yield* updateEventEnrichmentEffect(catalog, id, enrichmentResult.location_hidden
          ? { location_hidden: true, venue_id: null }
          : { location_hidden: false })
      }

      if (enrichmentResult?.description_en && !enrichmentResult.description_es) {
        const detectedLang = yield* enrichmentTry('event-enrichment.detect-language', () =>
          detectLanguage(enrichmentResult!.description_en!)
        )
        console.log(`[event-enrichment] Detected language: ${detectedLang}`)

        if (detectedLang === 'spanish') {
          enrichmentResult.description_es = enrichmentResult.description_en
          enrichmentResult.description_en = yield* enrichmentTry('event-enrichment.translate-spanish', () =>
            translate(enrichmentResult!.description_es!, 'es-to-en')
          )
        } else {
          enrichmentResult.description_es = yield* enrichmentTry('event-enrichment.translate-english', () =>
            translate(enrichmentResult!.description_en!, 'en-to-es')
          )
        }
      }
    } else {
      console.log(`[event-enrichment] Using generic enrichment for ${source}`)
      const knownLanguage = adapter?.config.knownLanguage === 'es' ? 'spanish' : undefined
      enrichmentResult = yield* enrichmentTry('event-enrichment.generic', () => enrichEventFull(link, {
        knownLanguage,
        extractVenue: needsVenue,
      }))
    }

    if (enrichmentResult?.organizer && !input.organizer_name) {
      const { name: organizerName, url } = enrichmentResult.organizer
      yield* updateEventEnrichmentEffect(catalog, id, { organizer_name: organizerName,
        organizer_url: url ?? null })
    }

    if (!enrichmentResult || !enrichmentResult.description_es) {
      yield* updateEventEnrichmentEffect(catalog, id, {
        enrichment_status: 'failed',
        enrichment_error: 'Failed to extract description',
      })
      return {
        eventId: id,
        success: false,
        enriched: false,
        error: 'Failed to extract description',
      } satisfies EventEnrichmentResult
    }

    if (!enrichmentResult.description_en) {
      // translateText returns null on provider errors. Keep the Spanish text and
      // leave the row retryable (`failed`) instead of completing it untranslated.
      const error = 'Failed to translate description to English'
      yield* updateEventEnrichmentEffect(catalog, id, {
        description_es: enrichmentResult.description_es,
        enrichment_status: 'failed',
        enrichment_error: error,
      })
      return { eventId: id, success: false, enriched: false, error } satisfies EventEnrichmentResult
    }

    let venueSettlement: VenueSettlementResult | undefined
    let settledVenueId: string | null = null

    // The source says the address comes after registration: no venue, whatever a name would match.
    const hidden = enrichmentResult.location_hidden === true
    if (needsVenue && enrichmentResult.venue_name && !hidden) {
      console.log(`[event-enrichment] Settling venue: ${enrichmentResult.venue_name}`)
      venueSettlement = yield* settleVenueEffect(catalog, {
        name: enrichmentResult.venue_name,
      }, {
        source,
        eventIds: [id],
      }).pipe(Effect.mapError((error) => enrichmentError(
        'event-enrichment.settle-venue', error.message, error
      )))
      settledVenueId = venueSettlement.venueId
      console.log(`[event-enrichment] Venue settled: ${venueSettlement.action} (${venueSettlement.venueId})`)
    }

    const { organizer, performers, ...facets } = yield* enrichmentTry('event-enrichment.extract-facets', () => extractFacets({
      name,
      description_es: enrichmentResult!.description_es,
      description_en: enrichmentResult!.description_en,
      categories,
    }))

    let venueName: string | null = null
    let venueNeighborhood: Neighborhood | null = null
    if (hidden) {
      // No venue in the search document either.
    } else if (settledVenueId) {
      venueName = venueSettlement!.venueName
    } else if (venue_id) {
      const existingVenue = yield* getVenueNameAndNeighborhoodEffect(catalog, venue_id)
      venueName = existingVenue.name
      venueNeighborhood = existingVenue.neighborhood
    } else {
      venueName = enrichmentResult.venue_name ?? null
    }
    if (settledVenueId) venueNeighborhood = venueSettlement!.neighborhood ?? null

    const { embedding, searchDocument } = yield* enrichmentTry('event-enrichment.embed', () =>
      embedEventWithDocument({
        name,
        description_es: enrichmentResult!.description_es,
        description_en: enrichmentResult!.description_en,
        categories: categories || null,
        facets,
        price: price ?? null,
        is_free,
        venue_name: venueName ?? null,
        venue_neighborhood: venueNeighborhood ?? null,
      })
    )
    const presentationFields = yield* enrichmentTry('event-enrichment.presentation-fields', () =>
      buildPresentationFields({
        description_es: enrichmentResult!.description_es,
        description_en: enrichmentResult!.description_en,
      })
    )

    const provenance = enrichmentStageRecord(input.description_es ? 'stored_description' : 'detail', enrichmentResult, true)
    const updateData: Parameters<typeof updateEventEnrichmentEffect>[2] = {
      description_es: enrichmentResult.description_es,
      description_en: enrichmentResult.description_en,
      ...presentationFields,
      embedding,
      search_document: searchDocument,
      embedding_version: CURRENT_EMBEDDING_VERSION,
      facets,
      ...missingCredits(input, enrichmentResult.organizer ? undefined : organizer, performers),
      enrichment_status: 'completed',
      enrichment_error: null,
      enriched_at: provenance.processedAt,
      enrichment_provenance: { ...input.enrichment_provenance, full: provenance },
    }
    if (settledVenueId) updateData.venue_id = settledVenueId

    yield* updateEventEnrichmentEffect(catalog, id, updateData)
    console.log(`[event-enrichment] Enriched: ${name}${settledVenueId ? ` (venue: ${enrichmentResult.venue_name})` : ''}`)

    return {
      eventId: id,
      success: true,
      enriched: true,
      venueSettlement,
    } satisfies EventEnrichmentResult
  })

  return Effect.catchEager(program, (error): Effect.Effect<EventEnrichmentResult, EventEnrichmentError> => {
    const cause = error instanceof EventEnrichmentError ? error.cause : error
    if (cause instanceof EnrichmentSkippedError) {
      const errorMsg = cause.message
      console.log(`[event-enrichment] Marking as skipped: ${name} (${errorMsg})`)
      return updateEventEnrichmentEffect(catalog, id, {
        enrichment_status: 'skipped',
        enrichment_error: errorMsg,
      }).pipe(Effect.as({
        eventId: id,
        success: true,
        enriched: false,
        error: errorMsg,
      } satisfies EventEnrichmentResult))
    }

    if (cause instanceof HttpError && cause.isNotFound) {
      const errorMsg = `HTTP ${cause.status} - Event page not found`
      console.log(`[event-enrichment] Event page gone (${cause.status}), marking as canceled: ${name}`)
      return updateEventEnrichmentEffect(catalog, id, {
        status: 'canceled',
        enrichment_status: 'skipped',
        enrichment_error: errorMsg,
      }).pipe(Effect.as({
        eventId: id,
        success: false,
        enriched: false,
        canceled: true,
        error: errorMsg,
      } satisfies EventEnrichmentResult))
    }

    const errorMsg = cause instanceof Error ? cause.message : 'Unknown error'
    console.error(`[event-enrichment] Failed to enrich ${name}:`, errorMsg)
    return updateEventEnrichmentEffect(catalog, id, {
      enrichment_status: 'failed',
      enrichment_error: errorMsg,
    }).pipe(Effect.as({
      eventId: id,
      success: false,
      enriched: false,
      error: errorMsg,
    } satisfies EventEnrichmentResult))
  })
}

/** Promise compatibility adapter for Trigger jobs and existing scripts. */
export async function enrichSingleEvent(
  catalog: CatalogStore,
  input: EventEnrichmentInput,
  options: EnrichSingleEventOptions = {}
): Promise<EventEnrichmentResult> {
  try {
    return await Effect.runPromise(enrichSingleEventEffect(catalog, input, options))
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error))
  }
}

// ============================================================================
// BATCH ENRICHMENT
// ============================================================================

interface BatchEnrichmentOptions extends EnrichSingleEventOptions {
  delayMs?: number
  concurrency?: number
  onProgress?: (current: number, total: number, result: EventEnrichmentResult) => void
}

type EnrichmentHandler = (
  catalog: CatalogStore,
  input: EventEnrichmentInput,
  options?: EnrichSingleEventOptions
) => Promise<EventEnrichmentResult>

type EnrichmentHandlerEffect = (
  catalog: CatalogStore,
  input: EventEnrichmentInput,
  options?: EnrichSingleEventOptions
) => Effect.Effect<EventEnrichmentResult, EventEnrichmentError>

const DEFAULT_ENRICHMENT_CONCURRENCY = 4

/**
 * Generic batch processor for event enrichment.
 * Bounded concurrency; optional delay after each item (default none).
 */
function processBatchEffect(
  catalog: CatalogStore,
  events: EventEnrichmentInput[],
  handler: EnrichmentHandlerEffect,
  logPrefix: string,
  options?: BatchEnrichmentOptions
): Effect.Effect<EnrichmentStats, EventEnrichmentError> {
  const delayMs = options?.delayMs ?? 0
  const concurrency = Math.max(1, options?.concurrency ?? DEFAULT_ENRICHMENT_CONCURRENCY)
  const enrichOptions = options?.extractFacets || options?.buildPresentationFields || options?.translate
    ? { extractFacets: options.extractFacets, buildPresentationFields: options.buildPresentationFields, translate: options.translate }
    : undefined

  return Effect.gen(function* () {
    const stats: EnrichmentStats = {
      total: events.length,
      enriched: 0,
      skipped: 0,
      failed: 0,
      canceled: 0,
      errors: [],
    }
    let completed = 0

    console.log(
      `[event-enrichment] Starting ${logPrefix} for ${events.length} events (concurrency ${concurrency})`
    )

    yield* Effect.forEach(events, (event) => Effect.gen(function* () {
      const result = yield* handler(catalog, event, enrichOptions)

      if (result.canceled) {
        stats.canceled++
      } else if (result.enriched) {
        stats.enriched++
      } else if (result.success) {
        stats.skipped++
      } else {
        stats.failed++
        if (result.error) {
          stats.errors.push({ eventId: result.eventId, eventName: event.name, error: result.error })
        }
      }

      completed++
      options?.onProgress?.(completed, events.length, result)
      if (delayMs > 0 && completed < events.length) {
        yield* delayEffect(delayMs).pipe(
          Effect.mapError((error) => enrichmentError('event-enrichment.batch-delay', error.message, error))
        )
      }
    }), { concurrency })

    console.log(
      `[event-enrichment] ${logPrefix} completed: ${stats.enriched} enriched, ${stats.skipped} skipped, ${stats.failed} failed, ${stats.canceled} canceled`
    )
    return stats
  })
}

/**
 * Enrich multiple events with bounded concurrency.
 */
export function enrichEvents(
  catalog: CatalogStore,
  events: EventEnrichmentInput[],
  options?: BatchEnrichmentOptions
): Promise<EnrichmentStats> {
  return Effect.runPromise(enrichEventsEffect(catalog, events, options))
}

export function enrichEventsEffect(
  catalog: CatalogStore,
  events: EventEnrichmentInput[],
  options?: BatchEnrichmentOptions
): Effect.Effect<EnrichmentStats, EventEnrichmentError> {
  return processBatchEffect(catalog, events, enrichSingleEventEffect, 'batch enrichment', options)
}

// ============================================================================
// QUERY FUNCTIONS
// ============================================================================

/**
 * Get events that need enrichment: `pending` or `failed` rows with a link,
 * not canceled, and not already started (`starts_at >= now`).
 * `failed` stays retryable; `skipped`/`completed` are terminal for this job.
 */
/** Sources removed from the daily import. Their events stay and age out without paid enrichment. */
export const RETIRED_SOURCES = ['passline', 'eventbrite', 'venti'] as const

interface EnrichmentQueryOptions {
  source?: string
  limit?: number
  createdAfter?: string
  statuses?: Array<'pending' | 'failed'>
}

const enrichmentQuery = (options?: EnrichmentQueryOptions) => ({
  ...options,
  startsAtFloor: enrichmentStartsAtFloor(),
  retiredSources: RETIRED_SOURCES,
})

export function getEventsNeedingEnrichmentEffect(
  catalog: CatalogStore,
  options?: EnrichmentQueryOptions
): Effect.Effect<EventEnrichmentInput[], EventEnrichmentError> {
  return importTry('event-enrichment.load-pending', () => catalog.eventsNeedingEnrichment(enrichmentQuery(options))).pipe(
    Effect.map((rows) => rows as EventEnrichmentInput[]),
    Effect.mapError((error) => enrichmentError('event-enrichment.load-pending', error.message, error))
  )
}

export async function getEventsNeedingEnrichment(
  catalog: CatalogStore,
  options?: EnrichmentQueryOptions
): Promise<EventEnrichmentInput[]> {
  return Effect.runPromise(Effect.catchEager(
    getEventsNeedingEnrichmentEffect(catalog, options),
    () => Effect.succeed([] as EventEnrichmentInput[])
  ))
}

export function countEventsNeedingEnrichmentEffect(
  catalog: CatalogStore,
  options?: Omit<EnrichmentQueryOptions, 'limit'>
): Effect.Effect<number, EventEnrichmentError> {
  return importTry('event-enrichment.count-pending', () => catalog.countEventsNeedingEnrichment(enrichmentQuery(options))).pipe(
    Effect.mapError((error) => enrichmentError('event-enrichment.count-pending', error.message, error))
  )
}

export async function countEventsNeedingEnrichment(
  catalog: CatalogStore,
  options?: Omit<EnrichmentQueryOptions, 'limit'>
): Promise<number> {
  return Effect.runPromise(Effect.catchEager(
    countEventsNeedingEnrichmentEffect(catalog, options),
    () => Effect.succeed(0)
  ))
}
