/**
 * Core Meetup Import Logic
 *
 * HTTP-independent logic for importing Meetup events.
 * Can be called from both manual import wizard and Trigger.dev jobs.
 *
 * Note: Meetup requires browser scraping and scrapes day-by-day for accurate results.
 */
import { Effect } from 'effect'
import type { SupabaseClient } from '@supabase/supabase-js'
import { addDays, format } from 'date-fns'
import {
  scrapeMeetupCatalog,
  filterInPersonEvents,
  filterByDateRange,
} from '../scrapers/meetup/browser-scraper.ts'
import type { MeetupEvent } from '../scrapers/meetup/types.ts'
import { enrichMeetupEventsWithDetails } from '../scrapers/meetup/detail.ts'
import { logger } from '#shared/lib/logger.ts'
import {
  transformMeetupEventWithExpansion,
  getUniqueVenueNames,
} from '../scrapers/meetup/transformer.ts'
import { categorizeEventsBatchWithStats } from '../scrapers/ai-categorizer.ts'
import {
  embedEventWithDocument,
  CURRENT_EMBEDDING_VERSION,
} from '#shared/lib/ai/embeddings.ts'
import { buildDescriptionPresentationFields } from '#features/events/lib/description-presentation.server.ts'
import { checkDuplicateEventsWithDataEffect, type ExistingEventData } from '../api/duplicate-detection.ts'
import { classifyScraperUpdate, getChangedMutableFields, sourceDescriptionsChanged, type ScraperUpdateKind } from './scraper-update.ts'
import { getBlocklistEntries } from '#shared/lib/db/blocklist.ts'
import { isBlockedByEntries } from '../scrapers/shared/blocklist-filter.ts'
import { settleVenuesEffect, getVenueIdFromResults, isPlaceholderResult, type VenueSettlementInput, type VenueSettlementResult } from './venue-settlement.ts'
import { delayEffect } from './nominatim.ts'
import { filterEventsByLocation } from './geo-validation.ts'
import type { EventInsert } from '#shared/lib/types.ts'
import { importTry, ImportOperationError } from './effect-utils.ts'
import { catalogImportProvenance, type CatalogImportProvenance } from './enrichment-provenance.ts'

// ============================================================================
// TYPES
// ============================================================================

export interface MeetupImportOptions {
  /** Number of days ahead to import (default: 14) */
  daysAhead?: number
  /** Start date override (YYYY-MM-DD) */
  startDate?: string
  /** End date override (YYYY-MM-DD) */
  endDate?: string
  /** Skip duplicate checking (for testing) */
  skipDuplicateCheck?: boolean
  /** Scrape run ID for audit trail */
  scrapeRunId?: string | null
  /** Number of weeks to expand recurring events (default: 4) */
  expandRecurringWeeks?: number
}

export interface MeetupImportResult {
  catalogProvenance?: CatalogImportProvenance
  // Scrape stats
  eventsFetched: number
  eventsFiltered: number
  eventsExpanded: number // After recurring event expansion

  // Import stats
  eventsInserted: number
  eventsUpdated: number
  eventsSkipped: number

  // Venue stats
  venuesMatched: number
  venuesAutoCreated: number
  venuesQueuedReview: number

  // Categorization stats
  categorizationSuccessful: number
  categorizationFallback: number
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Filter events by blocklist
 */
function filterBlockedEvents(
  events: MeetupEvent[],
  blocklistEntries: Awaited<ReturnType<typeof getBlocklistEntries>>
): MeetupEvent[] {
  return events.filter((event) => {
    const venueName = event.venue?.name || ''
    return !isBlockedByEntries(event.name, venueName, blocklistEntries)
  })
}

/**
 * Group events by day for batch processing
 */
function groupEventsByDay(events: MeetupEvent[]): Map<string, MeetupEvent[]> {
  const groups = new Map<string, MeetupEvent[]>()
  for (const event of events) {
    const dayKey = event.dateTime.split('T')[0] // YYYY-MM-DD
    const existing = groups.get(dayKey) || []
    existing.push(event)
    groups.set(dayKey, existing)
  }
  return groups
}

/**
 * Result from processing a single batch
 */
interface BatchProcessResult {
  inserted: number
  updated: number
  skipped: number
  expanded: number
  categorizationSuccessful: number
  categorizationFallback: number
}

/**
 * Process a batch of events (transform, categorize, embed, upsert)
 */
function meetupTry<A>(operation: string, run: () => PromiseLike<A>) {
  return importTry(operation, run)
}

function asMeetupError(operation: string, error: unknown): ImportOperationError {
  if (error instanceof ImportOperationError) return error
  return new ImportOperationError({
    operation,
    message: error instanceof Error ? error.message : String(error),
    cause: error,
  })
}

/** Effect-native daily batch. Pure transforms stay synchronous; AI, database,
 * presentation, and rate-limit calls are explicit side-effect leaves. */
function processMeetupBatchEffect(
  client: SupabaseClient,
  batchEvents: MeetupEvent[],
  venueResults: Map<string, VenueSettlementResult>,
  existingEventsMap: Map<string, ExistingEventData>,
  expandRecurringWeeks: number
): Effect.Effect<BatchProcessResult, ImportOperationError> {
  return Effect.gen(function* () {
    const result: BatchProcessResult = {
      inserted: 0,
      updated: 0,
      skipped: 0,
      expanded: 0,
      categorizationSuccessful: 0,
      categorizationFallback: 0,
    }

    const transformedEvents: EventInsert[] = []
    const eventSourceMap: Map<EventInsert, MeetupEvent> = new Map()
    for (const event of batchEvents) {
      const venueName = event.venue?.name || null
      const venueId = getVenueIdFromResults(venueResults, venueName)
      const expanded = transformMeetupEventWithExpansion(event, venueId, expandRecurringWeeks)
      const placeholder = isPlaceholderResult(venueResults, venueName)
      for (const transformed of expanded) {
        if (placeholder) transformed.location_tba = true
        transformedEvents.push(transformed)
        eventSourceMap.set(transformed, event)
      }
    }
    result.expanded = transformedEvents.length
    if (transformedEvents.length === 0) return result

    const eventsToProcess: Array<{
      transformed: EventInsert
      sourceEvent: MeetupEvent
      existing?: ExistingEventData
      updateKind?: ScraperUpdateKind
    }> = []
    for (const transformed of transformedEvents) {
      const sourceEvent = eventSourceMap.get(transformed)!
      const existing = transformed.external_id ? existingEventsMap.get(transformed.external_id) : undefined
      if (existing) {
        transformed.description_es = existing.description_es
        transformed.description_en = existing.description_en
        transformed.categories = existing.categories
        transformed.facets = existing.facets
      }
      eventsToProcess.push({
        transformed,
        sourceEvent,
        existing,
        updateKind: existing ? classifyScraperUpdate(transformed, existing, CURRENT_EMBEDDING_VERSION) : undefined,
      })
    }

    const { categories, stats: catStats } = yield* meetupTry(
      'meetup.categorize',
      () => categorizeEventsBatchWithStats(
        eventsToProcess.filter((item) => !item.existing).map((item) => ({
          name: item.transformed.name,
          description: item.transformed.description_es,
        })),
        100
      )
    )
    result.categorizationSuccessful = catStats.successful
    result.categorizationFallback = catStats.fallback
    const newEvents = eventsToProcess.filter((item) => !item.existing)
    for (let i = 0; i < newEvents.length; i++) newEvents[i].transformed.categories = [categories[i]]

    yield* Effect.forEach(eventsToProcess, ({ transformed, sourceEvent, existing, updateKind }) => {
      const itemProgram = Effect.gen(function* () {
        if (existing && updateKind === 'unchanged') return

        if (existing && updateKind === 'mutable-only') {
          const { error } = yield* meetupTry('meetup.update-mutable', () => client
            .from('events')
            .update(getChangedMutableFields(transformed, existing))
            .eq('id', existing.id)
          )
          if (error) {
            logger.error('[meetup] Failed to update event', { error: error.message })
            result.skipped++
          } else {
            result.updated++
          }
          return
        }

        const presentationFields = !existing || sourceDescriptionsChanged(transformed, existing)
          ? yield* meetupTry('meetup.presentation-fields', () => buildDescriptionPresentationFields({
              description_es: transformed.description_es,
              description_en: transformed.description_en,
            }))
          : {}
        const { embedding, searchDocument } = yield* meetupTry('meetup.embed', () => embedEventWithDocument({
          name: transformed.name,
          description_es: transformed.description_es,
          description_en: transformed.description_en,
          categories: transformed.categories,
          price: transformed.price,
          is_free: transformed.is_free,
          facets: transformed.facets,
          venue_name: sourceEvent.venue?.name ?? null,
          venue_neighborhood: sourceEvent.venue?.city ?? null,
        }))
        const eventWithEmbedding = {
          ...transformed,
          ...presentationFields,
          embedding,
          search_document: searchDocument,
          embedding_version: CURRENT_EMBEDDING_VERSION,
          enrichment_status: 'pending' as const,
        }

        if (existing) {
          const { error } = yield* meetupTry('meetup.update-event', () => client
            .from('events')
            .update({
              name: eventWithEmbedding.name,
              description_es: eventWithEmbedding.description_es,
              description_en: eventWithEmbedding.description_en,
              ...presentationFields,
              categories: eventWithEmbedding.categories,
              price: eventWithEmbedding.price,
              is_free: eventWithEmbedding.is_free,
              embedding: eventWithEmbedding.embedding,
              search_document: eventWithEmbedding.search_document,
              embedding_version: eventWithEmbedding.embedding_version,
              ...getChangedMutableFields(eventWithEmbedding, existing),
            })
            .eq('id', existing.id)
          )
          if (error) {
            logger.error('[meetup] Failed to update event', { error: error.message })
            result.skipped++
          } else {
            result.updated++
          }
        } else {
          const { error } = yield* meetupTry('meetup.insert-event', () => client.from('events').insert(eventWithEmbedding))
          if (error) {
            logger.error('[meetup] Failed to insert event', { error: error.message })
            result.skipped++
          } else {
            result.inserted++
          }
        }

        yield* delayEffect(100).pipe(Effect.mapError((error) => asMeetupError('meetup.rate-limit-delay', error)))
      })
      return Effect.catchEager(itemProgram, (error) => {
        logger.logError(`[meetup] Error processing event ${transformed.name}`, error)
        result.skipped++
        return Effect.succeed(undefined)
      })
    }, { concurrency: 1 })

    return result
  })
}

/** Effect-native Meetup coordinator. Browser/detail operations remain direct
 * leaves while filtering, expansion, batching, and expected item failures are
 * represented in the Effect program. */
export function processMeetupImportEffect(
  client: SupabaseClient,
  options: MeetupImportOptions = {}
): Effect.Effect<MeetupImportResult, ImportOperationError> {
  return Effect.gen(function* () {
    const daysAhead = options.daysAhead ?? 14
    const startDate = options.startDate ?? format(new Date(), 'yyyy-MM-dd')
    const endDate = options.endDate ?? format(addDays(new Date(), daysAhead), 'yyyy-MM-dd')
    const expandRecurringWeeks = options.expandRecurringWeeks ?? 4
    logger.info('[meetup] Starting import', { startDate, endDate })

    const result: MeetupImportResult = {
      eventsFetched: 0,
      eventsFiltered: 0,
      eventsExpanded: 0,
      eventsInserted: 0,
      eventsUpdated: 0,
      eventsSkipped: 0,
      venuesMatched: 0,
      venuesAutoCreated: 0,
      venuesQueuedReview: 0,
      categorizationSuccessful: 0,
      categorizationFallback: 0,
    }

    logger.info('[meetup] Scraping events from Meetup (browser mode)')
    const catalog = yield* meetupTry('meetup.scrape-events', () => scrapeMeetupCatalog({ startDate, endDate }))
    const allEvents = catalog.events
    result.catalogProvenance = catalogImportProvenance(catalog.observedAt)
    result.eventsFetched = allEvents.length
    logger.info('[meetup] Scraped events', { count: allEvents.length })

    if (allEvents.length > 0) {
      logger.info('[meetup] Enriching events from detail pages', { count: allEvents.length })
      yield* meetupTry('meetup.enrich-details', () => enrichMeetupEventsWithDetails(allEvents))
    }

    logger.info('[meetup] Filtering events')
    const blocklistEntries = yield* meetupTry('meetup.load-blocklist', () => getBlocklistEntries('meetup', client))
    const inPersonEvents = filterInPersonEvents(allEvents)
    const nonBlockedEvents = filterBlockedEvents(inPersonEvents, blocklistEntries)
    const dateFilteredEvents = filterByDateRange(nonBlockedEvents, startDate, endDate)
    const filteredEvents = filterEventsByLocation(dateFilteredEvents)
    result.eventsFiltered = filteredEvents.length
    logger.info('[meetup] Filtered to in-person events in BA', {
      afterDateFilter: dateFilteredEvents.length,
      afterGeoFilter: filteredEvents.length,
      rejectedByGeo: dateFilteredEvents.length - filteredEvents.length,
    })
    if (filteredEvents.length === 0) {
      logger.info('[meetup] No events to import')
      return result
    }

    logger.info('[meetup] Settling venues')
    const uniqueVenueNames = getUniqueVenueNames(filteredEvents)
    const venueInputs: VenueSettlementInput[] = uniqueVenueNames
      .filter((name) => name)
      .map((name) => {
        const eventWithVenue = filteredEvents.find((event) => event.venue?.name === name)
        return {
          name,
          address: eventWithVenue?.venue?.address || null,
          coordinates: eventWithVenue?.venue?.lat && eventWithVenue?.venue?.lng
            ? { lat: eventWithVenue.venue.lat, lng: eventWithVenue.venue.lng }
            : null,
        }
      })
    const { results: venueResults, stats: venueStats } = yield* settleVenuesEffect(
      client,
      venueInputs,
      { source: 'meetup', scrapeRunId: options.scrapeRunId }
    ).pipe(Effect.mapError((error) => asMeetupError('meetup.settle-venues', error)))
    result.venuesMatched = venueStats.matched
    result.venuesAutoCreated = venueStats.autoCreated
    result.venuesQueuedReview = venueStats.queuedReview

    const allExternalIds: string[] = []
    for (const event of filteredEvents) {
      const expanded = transformMeetupEventWithExpansion(event, null, expandRecurringWeeks)
      for (const transformed of expanded) {
        if (transformed.external_id) allExternalIds.push(transformed.external_id)
      }
    }
    const existingEventsMap = options.skipDuplicateCheck
      ? new Map<string, ExistingEventData>()
      : yield* checkDuplicateEventsWithDataEffect(allExternalIds, 'meetup', client).pipe(
          Effect.mapError((error) => asMeetupError('meetup.duplicate-check', error))
        )

    logger.info('[meetup] Processing events in daily batches')
    const eventsByDay = groupEventsByDay(filteredEvents)
    const sortedDays = Array.from(eventsByDay.keys()).sort()
    for (const dayKey of sortedDays) {
      const dayEvents = eventsByDay.get(dayKey)!
      logger.debug(`[meetup] Processing batch for ${dayKey}`, { count: dayEvents.length })
      const batchResult = yield* processMeetupBatchEffect(
        client,
        dayEvents,
        venueResults,
        existingEventsMap,
        expandRecurringWeeks
      ).pipe(Effect.mapError((error) => asMeetupError(`meetup.batch.${dayKey}`, error)))
      result.eventsExpanded += batchResult.expanded
      result.eventsInserted += batchResult.inserted
      result.eventsUpdated += batchResult.updated
      result.eventsSkipped += batchResult.skipped
      result.categorizationSuccessful += batchResult.categorizationSuccessful
      result.categorizationFallback += batchResult.categorizationFallback
    }

    logger.info('[meetup] Import complete', {
      inserted: result.eventsInserted,
      updated: result.eventsUpdated,
      skipped: result.eventsSkipped,
    })
    return result
  })
}

export async function processMeetupImport(
  client: SupabaseClient,
  options: MeetupImportOptions = {}
): Promise<MeetupImportResult> {
  try {
    return await Effect.runPromise(processMeetupImportEffect(client, options))
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error))
  }
}
