/**
 * Core Event Enrichment Logic
 *
 * Handles event description enrichment, venue extraction, and embedding generation
 * for automated scraping jobs. Uses existing AI functions from shared lib.
 */
import { Data, Effect } from 'effect'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Neighborhood } from '#shared/lib/types.ts'
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
import { extractEventFacets } from '#shared/lib/ai/extract-facets.ts'
import { isEmptyFacets, type EventFacets } from '#shared/lib/search-facets.ts'
import { buildDescriptionPresentationFields } from '#features/events/lib/description-presentation.server.ts'
import { type VenueSettlementResult, settleVenueEffect } from './venue-settlement.ts'
import { delayEffect } from './nominatim.ts'
import { importTry } from './effect-utils.ts'

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

export interface EventEnrichmentInput {
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
  client: SupabaseClient,
  venueId: string
): Effect.Effect<{ name: string | null; neighborhood: Neighborhood | null }, EventEnrichmentError> {
  return importTry('event-enrichment.load-venue', () => client
    .from('venues')
    .select('name, neighborhood')
    .eq('id', venueId)
    .maybeSingle()
  ).pipe(
    Effect.mapError((error) => enrichmentError('event-enrichment.load-venue', error.message, error)),
    Effect.map(({ data, error }) => {
      if (error) {
        console.error(`[event-enrichment] Failed to fetch venue ${venueId}:`, error)
        return { name: null, neighborhood: null }
      }
      return {
        name: data?.name ?? null,
        neighborhood: (data?.neighborhood as Neighborhood | null) ?? null,
      }
    })
  )
}

/**
 * Update event with enrichment data.
 */
function updateEventEnrichmentEffect(
  client: SupabaseClient,
  eventId: string,
  data: {
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
    facets?: EventFacets
    enrichment_status?: 'pending' | 'completed' | 'failed' | 'skipped'
    enrichment_error?: string | null
    enriched_at?: string | null
    status?: 'scheduled' | 'canceled' | 'postponed' | 'past' | 'pending_review'
  }
): Effect.Effect<void, EventEnrichmentError> {
  return importTry('event-enrichment.update-event', () => client
    .from('events')
    .update(data)
    .eq('id', eventId)
  ).pipe(
    Effect.flatMap(({ error }) => error
      ? Effect.fail(enrichmentError('event-enrichment.update-event', `Failed to update event: ${error.message}`, error))
      : Effect.succeed(undefined)
    ),
    Effect.mapError((error) => error instanceof EventEnrichmentError
      ? error
      : enrichmentError('event-enrichment.update-event', error.message, error))
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
) => Promise<import('#shared/lib/search-facets.ts').EventFacets>

export interface EnrichSingleEventOptions {
  extractFacets?: ExtractFacetsFn
}

interface EnrichmentPayload {
  description_es: string | null
  description_en: string | null
  venue_name: string | null
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
  client: SupabaseClient,
  input: EventEnrichmentInput,
  options: EnrichSingleEventOptions = {}
): Effect.Effect<EventEnrichmentResult, EventEnrichmentError> {
  const { id, name, link, source, categories, venue_id, price, is_free } = input
  const extractFacets = options.extractFacets ?? extractEventFacets

  const program = Effect.gen(function* () {
    if (!link) {
      return {
        eventId: id,
        success: true,
        enriched: false,
        error: 'No link available',
      } satisfies EventEnrichmentResult
    }

    const alreadyEnriched =
      input.enrichment_status === 'completed' ||
      (Array.isArray(input.embedding) && input.embedding.length > 0)

    if (input.description_es && alreadyEnriched) {
      console.log(`[event-enrichment] Backfilling facets only for: ${name}`)
      const facets = yield* enrichmentTry('event-enrichment.extract-facets', () => extractFacets({
        name,
        description_es: input.description_es!,
        description_en: input.description_en,
        categories,
      }))

      if (isEmptyFacets(facets)) {
        yield* updateEventEnrichmentEffect(client, id, { facets })
      } else {
        let venueName: string | null = null
        let venueNeighborhood: Neighborhood | null = null
        if (venue_id) {
          const existingVenue = yield* getVenueNameAndNeighborhoodEffect(client, venue_id)
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

        yield* updateEventEnrichmentEffect(client, id, {
          facets,
          embedding,
          search_document: searchDocument,
          embedding_version: CURRENT_EMBEDDING_VERSION,
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
      yield* updateEventEnrichmentEffect(client, id, {
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
      enrichmentResult = {
        description_es: input.description_es,
        description_en: input.description_en
          ? input.description_en
          : yield* enrichmentTry('event-enrichment.translate-spanish', () =>
              translateText(input.description_es!, 'es-to-en')
            ),
        venue_name: null,
      }
    } else if (adapter && hasServerEnrichment(adapter)) {
      console.log(`[event-enrichment] Using adapter for ${source}`)
      enrichmentResult = yield* enrichmentTry('event-enrichment.server-adapter', () =>
        adapter.serverEnrich(link, { extractVenue: needsVenue })
      )

      if (enrichmentResult?.description_en && !enrichmentResult.description_es) {
        const detectedLang = yield* enrichmentTry('event-enrichment.detect-language', () =>
          detectLanguage(enrichmentResult!.description_en!)
        )
        console.log(`[event-enrichment] Detected language: ${detectedLang}`)

        if (detectedLang === 'spanish') {
          enrichmentResult.description_es = enrichmentResult.description_en
          enrichmentResult.description_en = yield* enrichmentTry('event-enrichment.translate-spanish', () =>
            translateText(enrichmentResult!.description_es!, 'es-to-en')
          )
        } else {
          enrichmentResult.description_es = yield* enrichmentTry('event-enrichment.translate-english', () =>
            translateText(enrichmentResult!.description_en!, 'en-to-es')
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

    if (!enrichmentResult || !enrichmentResult.description_es) {
      yield* updateEventEnrichmentEffect(client, id, {
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

    let venueSettlement: VenueSettlementResult | undefined
    let settledVenueId: string | null = null

    if (needsVenue && enrichmentResult.venue_name) {
      console.log(`[event-enrichment] Settling venue: ${enrichmentResult.venue_name}`)
      venueSettlement = yield* settleVenueEffect(client, {
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

    const facets = yield* enrichmentTry('event-enrichment.extract-facets', () => extractFacets({
      name,
      description_es: enrichmentResult!.description_es,
      description_en: enrichmentResult!.description_en,
      categories,
    }))

    let venueName: string | null = null
    let venueNeighborhood: Neighborhood | null = null
    if (settledVenueId) {
      venueName = venueSettlement!.venueName
    } else if (venue_id) {
      const existingVenue = yield* getVenueNameAndNeighborhoodEffect(client, venue_id)
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
      buildDescriptionPresentationFields({
        description_es: enrichmentResult!.description_es,
        description_en: enrichmentResult!.description_en,
      })
    )

    const updateData: Parameters<typeof updateEventEnrichmentEffect>[2] = {
      description_es: enrichmentResult.description_es,
      description_en: enrichmentResult.description_en,
      ...presentationFields,
      embedding,
      search_document: searchDocument,
      embedding_version: CURRENT_EMBEDDING_VERSION,
      facets,
      enrichment_status: 'completed',
      enrichment_error: null,
      enriched_at: new Date().toISOString(),
    }
    if (settledVenueId) updateData.venue_id = settledVenueId

    yield* updateEventEnrichmentEffect(client, id, updateData)
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
      return updateEventEnrichmentEffect(client, id, {
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
      return updateEventEnrichmentEffect(client, id, {
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
    return updateEventEnrichmentEffect(client, id, {
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
  client: SupabaseClient,
  input: EventEnrichmentInput,
  options: EnrichSingleEventOptions = {}
): Promise<EventEnrichmentResult> {
  try {
    return await Effect.runPromise(enrichSingleEventEffect(client, input, options))
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error))
  }
}

// ============================================================================
// BATCH ENRICHMENT
// ============================================================================

interface BatchEnrichmentOptions {
  delayMs?: number
  concurrency?: number
  onProgress?: (current: number, total: number, result: EventEnrichmentResult) => void
  extractFacets?: ExtractFacetsFn
}

type EnrichmentHandler = (
  client: SupabaseClient,
  input: EventEnrichmentInput,
  options?: EnrichSingleEventOptions
) => Promise<EventEnrichmentResult>

type EnrichmentHandlerEffect = (
  client: SupabaseClient,
  input: EventEnrichmentInput,
  options?: EnrichSingleEventOptions
) => Effect.Effect<EventEnrichmentResult, EventEnrichmentError>

const DEFAULT_ENRICHMENT_CONCURRENCY = 4

/**
 * Generic batch processor for event enrichment.
 * Bounded concurrency; optional delay after each item (default none).
 */
function processBatchEffect(
  client: SupabaseClient,
  events: EventEnrichmentInput[],
  handler: EnrichmentHandlerEffect,
  logPrefix: string,
  options?: BatchEnrichmentOptions
): Effect.Effect<EnrichmentStats, EventEnrichmentError> {
  const delayMs = options?.delayMs ?? 0
  const concurrency = Math.max(1, options?.concurrency ?? DEFAULT_ENRICHMENT_CONCURRENCY)
  const enrichOptions = options?.extractFacets
    ? { extractFacets: options.extractFacets }
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
      const result = yield* handler(client, event, enrichOptions)

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
  client: SupabaseClient,
  events: EventEnrichmentInput[],
  options?: BatchEnrichmentOptions
): Promise<EnrichmentStats> {
  return Effect.runPromise(enrichEventsEffect(client, events, options))
}

export function enrichEventsEffect(
  client: SupabaseClient,
  events: EventEnrichmentInput[],
  options?: BatchEnrichmentOptions
): Effect.Effect<EnrichmentStats, EventEnrichmentError> {
  return processBatchEffect(client, events, enrichSingleEventEffect, 'batch enrichment', options)
}

// ============================================================================
// QUERY FUNCTIONS
// ============================================================================

/**
 * Get events that need enrichment: `pending` or `failed` rows with a link,
 * not canceled, and not already started (`starts_at >= now`).
 * `failed` stays retryable; `skipped`/`completed` are terminal for this job.
 */
interface EnrichmentQueryOptions {
  source?: string
  limit?: number
  createdAfter?: string
  statuses?: Array<'pending' | 'failed'>
}

export function getEventsNeedingEnrichmentEffect(
  client: SupabaseClient,
  options?: EnrichmentQueryOptions
): Effect.Effect<EventEnrichmentInput[], EventEnrichmentError> {
  let query = client
    .from('events')
    .select(
      'id, name, link, source, categories, venue_id, description_es, description_en, facets, enrichment_status, embedding, price, is_free'
    )
    .in('enrichment_status', options?.statuses ?? ['pending', 'failed'])
    .neq('status', 'canceled')
    .neq('status', 'past')
    .gte('starts_at', enrichmentStartsAtFloor())
    .not('link', 'is', null)
    .order('starts_at', { ascending: true })

  if (options?.source) query = query.eq('source', options.source)
  if (options?.createdAfter) query = query.gte('created_at', options.createdAfter)
  query = query.limit(options?.limit || 100)

  return importTry('event-enrichment.load-pending', () => query).pipe(
    Effect.flatMap(({ data, error }) => {
      if (error) {
        console.error('[event-enrichment] Failed to get events needing enrichment:', error)
      }
      return Effect.succeed((data || []) as EventEnrichmentInput[])
    }),
    Effect.mapError((error) => enrichmentError('event-enrichment.load-pending', error.message, error))
  )
}

export async function getEventsNeedingEnrichment(
  client: SupabaseClient,
  options?: EnrichmentQueryOptions
): Promise<EventEnrichmentInput[]> {
  return Effect.runPromise(Effect.catchEager(
    getEventsNeedingEnrichmentEffect(client, options),
    () => Effect.succeed([] as EventEnrichmentInput[])
  ))
}

export function countEventsNeedingEnrichmentEffect(
  client: SupabaseClient,
  options?: Omit<EnrichmentQueryOptions, 'limit'>
): Effect.Effect<number, EventEnrichmentError> {
  let query = client
    .from('events')
    .select('*', { count: 'exact', head: true })
    .in('enrichment_status', options?.statuses ?? ['pending', 'failed'])
    .neq('status', 'canceled')
    .neq('status', 'past')
    .gte('starts_at', enrichmentStartsAtFloor())
    .not('link', 'is', null)

  if (options?.source) query = query.eq('source', options.source)
  if (options?.createdAfter) query = query.gte('created_at', options.createdAfter)

  return importTry('event-enrichment.count-pending', () => query).pipe(
    Effect.flatMap(({ count, error }) => {
      if (error) {
        console.error('[event-enrichment] Failed to count events needing enrichment:', error)
      }
      return Effect.succeed(count ?? 0)
    }),
    Effect.mapError((error) => enrichmentError('event-enrichment.count-pending', error.message, error))
  )
}

export async function countEventsNeedingEnrichment(
  client: SupabaseClient,
  options?: Omit<EnrichmentQueryOptions, 'limit'>
): Promise<number> {
  return Effect.runPromise(Effect.catchEager(
    countEventsNeedingEnrichmentEffect(client, options),
    () => Effect.succeed(0)
  ))
}

export function getEnrichmentPendingCountsEffect(
  client: SupabaseClient
): Effect.Effect<Record<string, number>, EventEnrichmentError> {
  return importTry('event-enrichment.count-by-source', () => client
    .from('events')
    .select('source')
    .eq('enrichment_status', 'pending')
    .not('link', 'is', null)
  ).pipe(
    Effect.flatMap(({ data, error }) => {
      if (error) {
        console.error('[event-enrichment] Failed to get pending counts:', error)
      }
      const counts: Record<string, number> = {}
      for (const event of data || []) {
        const source = event.source || 'unknown'
        counts[source] = (counts[source] || 0) + 1
      }
      return Effect.succeed(counts)
    }),
    Effect.mapError((error) => enrichmentError('event-enrichment.count-by-source', error.message, error))
  )
}

export async function getEnrichmentPendingCounts(
  client: SupabaseClient
): Promise<Record<string, number>> {
  return Effect.runPromise(Effect.catchEager(
    getEnrichmentPendingCountsEffect(client),
    () => Effect.succeed({} as Record<string, number>)
  ))
}

// ============================================================================
// VENUE-ONLY ENRICHMENT
// ============================================================================

/**
 * Enrich a single event with only venue extraction (for events that already have descriptions).
 */
export function enrichEventVenueOnlyEffect(
  client: SupabaseClient,
  input: EventEnrichmentInput,
  _options?: EnrichSingleEventOptions
): Effect.Effect<EventEnrichmentResult, EventEnrichmentError> {
  const { id, name, link, source, venue_id } = input

  const program = Effect.gen(function* () {
    if (!link) {
      return {
        eventId: id,
        success: true,
        enriched: false,
        error: 'No link available',
      } satisfies EventEnrichmentResult
    }

    if (venue_id) {
      return {
        eventId: id,
        success: true,
        enriched: false,
        error: 'Already has venue',
      } satisfies EventEnrichmentResult
    }

    console.log(`[event-enrichment] Extracting venue for: ${name}`)
    const venueName = yield* enrichmentTry('event-enrichment.extract-venue', () => extractVenueFromUrl(link))

    if (!venueName) {
      console.log(`[event-enrichment] No venue found for: ${name}`)
      return {
        eventId: id,
        success: true,
        enriched: false,
        error: 'No venue found on page',
      } satisfies EventEnrichmentResult
    }

    console.log(`[event-enrichment] Settling venue: ${venueName}`)
    const venueSettlement = yield* settleVenueEffect(client, { name: venueName }, {
      source,
      eventIds: [id],
    }).pipe(Effect.mapError((error) => enrichmentError(
      'event-enrichment.settle-venue-only', error.message, error
    )))

    if (!venueSettlement.venueId) {
      console.log(`[event-enrichment] Venue settlement returned no ID for: ${name}`)
      return {
        eventId: id,
        success: true,
        enriched: false,
        error: 'Venue settlement failed',
        venueSettlement,
      } satisfies EventEnrichmentResult
    }

    yield* updateEventEnrichmentEffect(client, id, { venue_id: venueSettlement.venueId })
    console.log(`[event-enrichment] Added venue to: ${name} (${venueName})`)

    return {
      eventId: id,
      success: true,
      enriched: true,
      venueSettlement,
    } satisfies EventEnrichmentResult
  })

  return Effect.catchEager(program, (error) => {
    const cause = error instanceof EventEnrichmentError ? error.cause : error
    if (cause instanceof HttpError && cause.isNotFound) {
      const errorMsg = `HTTP ${cause.status} - Event page not found`
      console.log(`[event-enrichment] Event page gone (${cause.status}), marking as canceled: ${name}`)
      const cancellation = importTry('event-enrichment.mark-canceled', () => client
        .from('events')
        .update({ status: 'canceled', enrichment_error: errorMsg })
        .eq('id', id)
      ).pipe(
        Effect.catchEager((update) => {
          console.error('[event-enrichment] Failed to mark event as canceled:', update)
          return Effect.succeed(undefined)
        }),
        Effect.as({
          eventId: id,
          success: false,
          enriched: false,
          canceled: true,
          error: errorMsg,
        } satisfies EventEnrichmentResult)
      )
      return cancellation
    }

    const errorMsg = cause instanceof Error ? cause.message : 'Unknown error'
    console.error(`[event-enrichment] Failed venue enrichment for ${name}:`, errorMsg)
    return Effect.succeed({
      eventId: id,
      success: false,
      enriched: false,
      error: errorMsg,
    } satisfies EventEnrichmentResult)
  })
}

export async function enrichEventVenueOnly(
  client: SupabaseClient,
  input: EventEnrichmentInput,
  options?: EnrichSingleEventOptions
): Promise<EventEnrichmentResult> {
  try {
    return await Effect.runPromise(enrichEventVenueOnlyEffect(client, input, options))
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error))
  }
}

/**
 * Get events that have descriptions but are missing venues.
 */
export function getEventsNeedingVenueOnlyEffect(
  client: SupabaseClient,
  options?: { limit?: number }
): Effect.Effect<EventEnrichmentInput[], EventEnrichmentError> {
  let query = client
    .from('events')
    .select('id, name, link, source, categories, venue_id')
    .eq('enrichment_status', 'completed')
    .is('venue_id', null)
    .not('link', 'is', null)
    .order('starts_at', { ascending: true })
    .limit(options?.limit || 100)

  return importTry('event-enrichment.load-venue-pending', () => query).pipe(
    Effect.flatMap(({ data, error }) => {
      if (error) {
        console.error('[event-enrichment] Failed to get events needing venue:', error)
      }
      return Effect.succeed((data || []) as EventEnrichmentInput[])
    }),
    Effect.mapError((error) => enrichmentError('event-enrichment.load-venue-pending', error.message, error))
  )
}

export async function getEventsNeedingVenueOnly(
  client: SupabaseClient,
  options?: { limit?: number }
): Promise<EventEnrichmentInput[]> {
  return Effect.runPromise(Effect.catchEager(
    getEventsNeedingVenueOnlyEffect(client, options),
    () => Effect.succeed([] as EventEnrichmentInput[])
  ))
}

/**
 * Enrich multiple events with venue only.
 */
export function enrichEventsVenueOnly(
  client: SupabaseClient,
  events: EventEnrichmentInput[],
  options?: BatchEnrichmentOptions
): Promise<EnrichmentStats> {
  return Effect.runPromise(enrichEventsVenueOnlyEffect(client, events, options))
}

export function enrichEventsVenueOnlyEffect(
  client: SupabaseClient,
  events: EventEnrichmentInput[],
  options?: BatchEnrichmentOptions
): Effect.Effect<EnrichmentStats, EventEnrichmentError> {
  return processBatchEffect(client, events, enrichEventVenueOnlyEffect, 'venue-only enrichment', options)
}
