/**
 * Core Passline Import Logic
 *
 * HTTP-independent logic for importing Passline events.
 * Can be called from both manual import wizard and Trigger.dev jobs.
 */
import { Effect } from 'effect'
import type { SupabaseClient } from '@supabase/supabase-js'
import { addDays, format } from 'date-fns'
import {
  fetchPasslineEvents,
  filterCABAEvents,
  filterByDateRange,
  type PasslineEvent,
} from '../scrapers/passline/api.ts'
import { fetchPasslineCatalogWithBrowserbase } from '../scrapers/passline/browser-scraper.ts'
import { catalogImportProvenance, type CatalogImportProvenance } from './enrichment-provenance.ts'
import { isBrowserbaseAvailable } from '#shared/lib/browser/browserbase.ts'
import { transformPasslineEvent } from '../scrapers/passline/transformer.ts'
import { categorizeEventsBatchWithStats } from '../scrapers/ai-categorizer.ts'
import {
  embedEventWithDocument,
  CURRENT_EMBEDDING_VERSION,
} from '#shared/lib/ai/embeddings.ts'
import { getBlocklistEntries } from '#shared/lib/db/blocklist.ts'
import {
  settleVenuesEffect,
  getVenueIdFromResults,
  getVenueNeighborhoodFromResults,
  isPlaceholderResult,
  type VenueSettlementInput,
  type VenueSettlementResult,
} from './venue-settlement.ts'
import { delayEffect } from './nominatim.ts'
import type { EventInsert, Category } from '#shared/lib/types.ts'
import { EMPTY_FACETS } from '#shared/lib/search-facets.ts'
import {
  classifyPasslineEvent,
  type ExistingPasslineEvent,
  type PasslineClassification,
  type VenueSettlement,
} from './passline-classify.ts'
import { fetchExistingPasslineEventsEffect } from './passline-existing.ts'
import { logger } from '#shared/lib/logger.ts'
import { importTry, ImportOperationError } from './effect-utils.ts'

// ============================================================================
// TYPES
// ============================================================================

export interface PasslineImportOptions {
  /** Number of days ahead to import (default: 30) */
  daysAhead?: number
  /** Start date override (YYYY-MM-DD) */
  startDate?: string
  /** End date override (YYYY-MM-DD) */
  endDate?: string
  /** Skip duplicate checking (for testing) */
  skipDuplicateCheck?: boolean
  /** Scrape run ID for audit trail */
  scrapeRunId?: string | null
}

export interface PasslineImportResult {
  catalogProvenance?: CatalogImportProvenance
  // Scrape stats
  eventsFetched: number
  eventsFiltered: number

  // Import stats
  eventsInserted: number
  eventsUpdated: number
  eventsSkipped: number
  eventsUnchanged: number

  // Venue stats
  venuesMatched: number
  venuesAutoCreated: number
  venuesQueuedReview: number

  // Categorization stats
  categorizationSuccessful: number
  categorizationFallback: number
}

// ============================================================================
// BATCH PROCESSING
// ============================================================================

// In-process batch size: keeps memory + AI fan-out bounded and writes progress.
const BATCH_SIZE = 20

interface PasslineItem {
  event: PasslineEvent
  transformed: EventInsert
  venueSettlement: VenueSettlement
  existing?: ExistingPasslineEvent
  classification: PasslineClassification
  category: Category | null
}

/** Fields written on every existing-event update (scrape-owned, non-enrichment). */
function scrapeUpdateFields(t: EventInsert) {
  return {
    starts_at: t.starts_at,
    ends_at: t.ends_at,
    is_all_day: t.is_all_day ?? false,
    time_tba: t.time_tba ?? false,
    ticket_url: t.ticket_url,
    location_tba: t.location_tba ?? false,
    image_url: t.image_url,
    link: t.link,
    price: t.price,
    is_free: t.is_free,
  }
}

/**
 * Process a single event. Returns true when an embedding call was made, so the
 * caller can rate-limit only those paths.
 */
function passlineTry<A>(operation: string, run: () => PromiseLike<A>) {
  return importTry(operation, run)
}

function asPasslineError(operation: string, error: unknown): ImportOperationError {
  if (error instanceof ImportOperationError) return error
  return new ImportOperationError({
    operation,
    message: error instanceof Error ? error.message : String(error),
    cause: error,
  })
}

function processPasslineItemEffect(
  client: SupabaseClient,
  item: PasslineItem,
  venueResults: Map<string, VenueSettlementResult>,
  result: PasslineImportResult
): Effect.Effect<boolean, ImportOperationError> {
  return Effect.gen(function* () {
    const { event, transformed, existing, venueSettlement, classification } = item
    const venueNeighborhood = getVenueNeighborhoodFromResults(venueResults, event.lugar)

    if (classification.kind === 'unchanged') {
      result.eventsUnchanged++
      return false
    }

    if (classification.kind === 'new') {
      const { embedding, searchDocument } = yield* passlineTry('passline.embed-new', () =>
        embedEventWithDocument({
          name: transformed.name,
          description_es: transformed.description_es,
          description_en: transformed.description_en,
          categories: transformed.categories,
          price: transformed.price,
          is_free: transformed.is_free,
          facets: EMPTY_FACETS,
          venue_name: event.lugar || null,
          venue_neighborhood: venueNeighborhood,
        })
      )
      const { error } = yield* passlineTry('passline.insert-event', () => client.from('events').insert({
        ...transformed,
        embedding,
        search_document: searchDocument,
        embedding_version: CURRENT_EMBEDDING_VERSION,
        enrichment_status: 'pending' as const,
      }))
      if (error) {
        logger.error('[passline] Failed to insert event', { error: error.message })
        result.eventsSkipped++
      } else {
        result.eventsInserted++
      }
      return true
    }

    const venueUpdate = venueSettlement.kind === 'resolved'
      ? { venue_id: venueSettlement.venueId }
      : venueSettlement.kind === 'placeholder'
        ? { venue_id: null }
        : {}

    if (classification.kind === 'mutable-only') {
      const { error } = yield* passlineTry('passline.update-mutable', () => client
        .from('events')
        .update({ ...scrapeUpdateFields(transformed), ...venueUpdate })
        .eq('id', existing!.id)
      )
      if (error) {
        logger.error('[passline] Failed to update event', { error: error.message })
        result.eventsSkipped++
      } else {
        result.eventsUpdated++
      }
      return false
    }

    const categories = classification.kind === 'name-changed'
      ? item.category ? [item.category] : existing!.categories
      : existing!.categories
    const { embedding, searchDocument } = yield* passlineTry('passline.embed-update', () =>
      embedEventWithDocument({
        name: transformed.name,
        description_es: existing!.description_es,
        description_en: existing!.description_en,
        categories,
        price: transformed.price,
        is_free: transformed.is_free,
        facets: existing!.facets ?? EMPTY_FACETS,
        venue_name: event.lugar || null,
        venue_neighborhood: venueNeighborhood,
      })
    )
    const { error } = yield* passlineTry('passline.update-search-event', () => client
      .from('events')
      .update({
        ...scrapeUpdateFields(transformed),
        ...venueUpdate,
        ...(classification.kind === 'name-changed' ? { name: transformed.name, categories } : {}),
        embedding,
        search_document: searchDocument,
        embedding_version: CURRENT_EMBEDDING_VERSION,
      })
      .eq('id', existing!.id)
    )
    if (error) {
      logger.error('[passline] Failed to update event', { error: error.message })
      result.eventsSkipped++
    } else {
      result.eventsUpdated++
    }
    return true
  })
}

function processPasslineBatchEffect(
  client: SupabaseClient,
  batch: PasslineItem[],
  venueResults: Map<string, VenueSettlementResult>,
  result: PasslineImportResult
): Effect.Effect<void, ImportOperationError> {
  return Effect.gen(function* () {
    const toCategorize = batch.filter(
      (item) => item.classification.kind === 'new' || item.classification.kind === 'name-changed'
    )
    if (toCategorize.length > 0) {
      const { categories, stats } = yield* passlineTry(
        'passline.categorize',
        () => categorizeEventsBatchWithStats(
          toCategorize.map((item) => ({
            name: item.transformed.name,
            description: item.classification.kind === 'name-changed'
              ? item.existing!.description_es
              : null,
          })),
          100
        )
      )
      result.categorizationSuccessful += stats.successful
      result.categorizationFallback += stats.fallback
      toCategorize.forEach((item, index) => {
        item.category = categories[index]
        item.transformed.categories = [categories[index]]
      })
    }

    yield* Effect.forEach(batch, (item) => {
      const itemProgram = processPasslineItemEffect(client, item, venueResults, result)
      return Effect.catchEager(itemProgram, (error) => {
        logger.logError(`[passline] Error processing event ${item.transformed.name}`, error)
        result.eventsSkipped++
        return Effect.succeed(false)
      }).pipe(
        Effect.flatMap((didEmbed) => didEmbed
          ? delayEffect(100).pipe(Effect.mapError((error) => asPasslineError('passline.rate-limit-delay', error)), Effect.asVoid)
          : Effect.succeed(undefined)
        )
      )
    }, { concurrency: 1 })
  })
}

/** Effect-native Passline coordinator with bounded progressive batches. */
export function processPasslineImportEffect(
  client: SupabaseClient,
  options: PasslineImportOptions = {}
): Effect.Effect<PasslineImportResult, ImportOperationError> {
  return Effect.gen(function* () {
    const daysAhead = options.daysAhead ?? 30
    const startDate = options.startDate ?? format(new Date(), 'yyyy-MM-dd')
    const endDate = options.endDate ?? format(addDays(new Date(), daysAhead), 'yyyy-MM-dd')
    logger.info('[passline] Starting import', { startDate, endDate })

    const result: PasslineImportResult = {
      eventsFetched: 0,
      eventsFiltered: 0,
      eventsInserted: 0,
      eventsUpdated: 0,
      eventsSkipped: 0,
      eventsUnchanged: 0,
      venuesMatched: 0,
      venuesAutoCreated: 0,
      venuesQueuedReview: 0,
      categorizationSuccessful: 0,
      categorizationFallback: 0,
    }

    logger.info('[passline] Fetching events from API')
    const fetchStart = performance.now()
    const catalog = yield* passlineTry(
      'passline.fetch-events',
      async () => isBrowserbaseAvailable()
        ? fetchPasslineCatalogWithBrowserbase()
        : { events: await fetchPasslineEvents(), observedAt: new Date().toISOString() }
    )
    const allEvents = catalog.events
    result.catalogProvenance = catalogImportProvenance(catalog.observedAt)
    result.eventsFetched = allEvents.length
    logger.info('[passline] Fetch phase', { ms: Math.round(performance.now() - fetchStart), count: allEvents.length })

    const blocklistEntries = yield* passlineTry('passline.load-blocklist', () => getBlocklistEntries('passline', client))
    const cabaEvents = filterCABAEvents(allEvents, blocklistEntries)
    const filteredEvents = filterByDateRange(cabaEvents, { startDate, endDate })
    result.eventsFiltered = filteredEvents.length
    logger.info('[passline] Filtered to CABA events in date range', { count: filteredEvents.length })
    if (filteredEvents.length === 0) return result

    const venueInputs: VenueSettlementInput[] = filteredEvents
      .map((event) => event.lugar)
      .filter((lugar, index, self) => lugar && self.indexOf(lugar) === index)
      .map((lugar) => ({ name: lugar }))
    const venueStart = performance.now()
    const { results: venueResults, stats: venueStats } = yield* settleVenuesEffect(
      client,
      venueInputs,
      { source: 'passline', scrapeRunId: options.scrapeRunId }
    ).pipe(Effect.mapError((error) => asPasslineError('passline.settle-venues', error)))
    logger.info('[passline] Venue settlement phase', { ms: Math.round(performance.now() - venueStart), ...venueStats })
    result.venuesMatched = venueStats.matched
    result.venuesAutoCreated = venueStats.autoCreated
    result.venuesQueuedReview = venueStats.queuedReview

    const classifyStart = performance.now()
    const externalIds = filteredEvents.map((event) => event.id)
    const existingEventsMap = options.skipDuplicateCheck
      ? new Map<string, ExistingPasslineEvent>()
      : yield* fetchExistingPasslineEventsEffect(client, externalIds).pipe(
          Effect.mapError((error) => asPasslineError('passline.existing-events', error))
        )
    const items: PasslineItem[] = []
    for (const event of filteredEvents) {
      const settledVenueId = getVenueIdFromResults(venueResults, event.lugar)
      const existing = existingEventsMap.get(event.id)
      const venueSettlement: VenueSettlement = settledVenueId !== null
        ? { kind: 'resolved', venueId: settledVenueId }
        : isPlaceholderResult(venueResults, event.lugar)
          ? { kind: 'placeholder' }
          : { kind: 'unresolved' }
      const transformed = transformPasslineEvent(event, settledVenueId)
      if (venueSettlement.kind === 'placeholder') transformed.location_tba = true
      const classification = existing
        ? classifyPasslineEvent(transformed, existing, venueSettlement)
        : ({ kind: 'new' } as const)
      items.push({ event, transformed, venueSettlement, existing, classification, category: null })
    }
    logger.info('[passline] Existing lookup + classification phase', {
      ms: Math.round(performance.now() - classifyStart),
      existing: existingEventsMap.size,
      total: items.length,
    })

    logger.info('[passline] Processing events in batches', { total: items.length })
    const processStart = performance.now()
    for (let start = 0; start < items.length; start += BATCH_SIZE) {
      yield* processPasslineBatchEffect(client, items.slice(start, start + BATCH_SIZE), venueResults, result)
      logger.info('[passline] Batch processed', {
        offset: Math.min(start + BATCH_SIZE, items.length),
        total: items.length,
      })
    }
    logger.info('[passline] Processing phase', { ms: Math.round(performance.now() - processStart), total: items.length })
    logger.info('[passline] Import complete', {
      inserted: result.eventsInserted,
      updated: result.eventsUpdated,
      skipped: result.eventsSkipped,
      unchanged: result.eventsUnchanged,
    })
    return result
  })
}

export async function processPasslineImport(
  client: SupabaseClient,
  options: PasslineImportOptions = {}
): Promise<PasslineImportResult> {
  try {
    return await Effect.runPromise(processPasslineImportEffect(client, options))
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error))
  }
}
