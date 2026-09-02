/**
 * Core Eventbrite Import Logic
 *
 * HTTP-independent logic for importing Eventbrite events.
 * Can be called from both manual import wizard and Trigger.dev jobs.
 */
import { Effect } from 'effect'
import type { SupabaseClient } from '@supabase/supabase-js'
import { addDays, format } from 'date-fns'
import {
  fetchEventbriteEvents,
  filterInPersonEvents,
  filterByDateRange,
  extractEventId,
  type EventbriteEvent,
} from '../scrapers/eventbrite/api.ts'
import {
  transformEventbriteEvent,
  getAllVenueInfo,
} from '../scrapers/eventbrite/transformer.ts'
import { fetchEventbriteDetailsBatch } from '../scrapers/eventbrite/detail.ts'
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
import { settleVenuesEffect, getVenueIdFromResults, isPlaceholderResult, type VenueSettlementInput } from './venue-settlement.ts'
import { delayEffect } from './nominatim.ts'
import { importTry, ImportOperationError } from './effect-utils.ts'
import type { EventInsert } from '#shared/lib/types.ts'

// ============================================================================
// TYPES
// ============================================================================

export interface EventbriteImportOptions {
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

export interface EventbriteImportResult {
  // Scrape stats
  eventsFetched: number
  eventsFiltered: number

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
  events: EventbriteEvent[],
  blocklistEntries: Awaited<ReturnType<typeof getBlocklistEntries>>
): EventbriteEvent[] {
  return events.filter((event) => {
    const venueName = event.location?.name || ''
    return !isBlockedByEntries(event.name, venueName, blocklistEntries)
  })
}

// ============================================================================
// MAIN IMPORT FUNCTION
// ============================================================================

/**
 * Process a full Eventbrite import.
 *
 * Steps:
 * 1. Fetch events from Eventbrite page (JSON-LD)
 * 2. Filter in-person events, apply blocklist, filter by date range
 * 3. Settle venues (match, auto-create, or queue for review)
 * 4. Check for duplicates
 * 5. Categorize events with AI
 * 6. Generate embeddings
 * 7. Upsert events to database
 */
function eventbriteTry<A>(operation: string, run: () => PromiseLike<A>) {
  return importTry(operation, run)
}

function asEventbriteError(operation: string, error: unknown): ImportOperationError {
  if (error instanceof ImportOperationError) return error
  return new ImportOperationError({
    operation,
    message: error instanceof Error ? error.message : String(error),
    cause: error,
  })
}

/** Effect-native Eventbrite coordinator. Source parsing stays pure and all
 * external fetch, AI, and persistence operations are explicit leaves. */
export function processEventbriteImportEffect(
  client: SupabaseClient,
  options: EventbriteImportOptions = {}
): Effect.Effect<EventbriteImportResult, ImportOperationError> {
  return Effect.gen(function* () {
    const daysAhead = options.daysAhead ?? 30
    const startDate = options.startDate ?? format(new Date(), 'yyyy-MM-dd')
    const endDate = options.endDate ?? format(addDays(new Date(), daysAhead), 'yyyy-MM-dd')
    console.log(`[eventbrite] Starting import: ${startDate} to ${endDate}`)

    const result: EventbriteImportResult = {
      eventsFetched: 0,
      eventsFiltered: 0,
      eventsInserted: 0,
      eventsUpdated: 0,
      eventsSkipped: 0,
      venuesMatched: 0,
      venuesAutoCreated: 0,
      venuesQueuedReview: 0,
      categorizationSuccessful: 0,
      categorizationFallback: 0,
    }

    console.log('[eventbrite] Fetching events from page...')
    const allEvents = yield* eventbriteTry('eventbrite.fetch-events', () => fetchEventbriteEvents())
    result.eventsFetched = allEvents.length
    console.log(`[eventbrite] Fetched ${allEvents.length} events`)

    console.log('[eventbrite] Filtering events...')
    const blocklistEntries = yield* eventbriteTry('eventbrite.load-blocklist', () =>
      getBlocklistEntries('eventbrite', client)
    )
    const inPersonEvents = filterInPersonEvents(allEvents)
    const nonBlockedEvents = filterBlockedEvents(inPersonEvents, blocklistEntries)
    const filteredEvents = filterByDateRange(nonBlockedEvents, startDate, endDate)
    result.eventsFiltered = filteredEvents.length
    console.log(`[eventbrite] Filtered to ${filteredEvents.length} in-person events in date range`)

    if (filteredEvents.length === 0) return result

    console.log('[eventbrite] Settling venues...')
    const venueInfoMap = getAllVenueInfo(filteredEvents)
    const venueInputs: VenueSettlementInput[] = Array.from(venueInfoMap.entries())
      .filter(([name]) => name)
      .map(([name, info]) => ({
        name,
        address: info.address,
        coordinates: info.latitude && info.longitude
          ? { lat: parseFloat(info.latitude), lng: parseFloat(info.longitude) }
          : null,
      }))

    const { results: venueResults, stats: venueStats } = yield* settleVenuesEffect(
      client,
      venueInputs,
      { source: 'eventbrite', scrapeRunId: options.scrapeRunId }
    ).pipe(Effect.mapError((error) => asEventbriteError('eventbrite.settle-venues', error)))
    result.venuesMatched = venueStats.matched
    result.venuesAutoCreated = venueStats.autoCreated
    result.venuesQueuedReview = venueStats.queuedReview

    const externalIds = filteredEvents
      .map((e) => extractEventId(e.url))
      .filter((id): id is string => id !== null)
    const existingEventsMap = options.skipDuplicateCheck
      ? new Map<string, ExistingEventData>()
      : yield* checkDuplicateEventsWithDataEffect(externalIds, 'eventbrite', client).pipe(
          Effect.mapError((error) => asEventbriteError('eventbrite.duplicate-check', error))
        )

    console.log('[eventbrite] Transforming events...')
    const eventsToProcess: Array<{
      event: EventbriteEvent
      transformed: EventInsert
      existing?: ExistingEventData
      updateKind?: ScraperUpdateKind
    }> = []

    for (const event of filteredEvents) {
      const venueName = event.location?.name || null
      const venueId = getVenueIdFromResults(venueResults, venueName)
      const transformed = transformEventbriteEvent(event, venueId)
      if (isPlaceholderResult(venueResults, venueName)) transformed.location_tba = true
      const externalId = extractEventId(event.url)
      const existing = externalId ? existingEventsMap.get(externalId) : undefined
      eventsToProcess.push({ event, transformed, existing })
    }

    console.log('[eventbrite] Enriching from detail pages (times, price, min_age)...')
    const detailTargets = eventsToProcess
      .map(({ event }) => {
        const id = extractEventId(event.url)
        return id ? { id, url: event.url } : null
      })
      .filter((target): target is { id: string; url: string } => target !== null)
    const detailMap = yield* eventbriteTry(
      'eventbrite.fetch-details',
      () => fetchEventbriteDetailsBatch(detailTargets)
    )

    for (const { event, transformed } of eventsToProcess) {
      const extId = extractEventId(event.url)
      const detail = extId ? detailMap.get(extId) : undefined
      if (!detail) continue
      if (detail.starts_at) {
        transformed.starts_at = detail.starts_at
        if (detail.ends_at) transformed.ends_at = detail.ends_at
        transformed.is_all_day = false
        transformed.time_tba = false
      }
      if (detail.hasPrice) {
        transformed.is_free = detail.is_free
        transformed.price = detail.is_free ? 0 : detail.price
      }
      if (detail.min_age !== null) transformed.min_age = detail.min_age
      if (detail.image_url) {
        transformed.image_url = detail.image_url
        transformed.image_width = detail.image_width
        transformed.image_height = detail.image_height
      }
    }

    for (const item of eventsToProcess) {
      if (!item.existing) continue
      item.transformed.description_es = item.existing.description_es
      item.transformed.description_en = item.existing.description_en
      item.transformed.categories = item.existing.categories
      item.transformed.facets = item.existing.facets
      item.updateKind = classifyScraperUpdate(item.transformed, item.existing, CURRENT_EMBEDDING_VERSION)
    }

    console.log('[eventbrite] Categorizing events...')
    const { categories, stats: catStats } = yield* eventbriteTry(
      'eventbrite.categorize',
      () => categorizeEventsBatchWithStats(
        eventsToProcess.filter((e) => !e.existing).map((e) => ({
          name: e.transformed.name,
          description: e.transformed.description_es,
        })),
        100
      )
    )
    result.categorizationSuccessful = catStats.successful
    result.categorizationFallback = catStats.fallback
    const newEvents = eventsToProcess.filter((e) => !e.existing)
    for (let i = 0; i < newEvents.length; i++) newEvents[i].transformed.categories = [categories[i]]

    console.log('[eventbrite] Generating embeddings and upserting events...')
    yield* Effect.forEach(eventsToProcess, ({ event, transformed, existing, updateKind }) => {
      const itemProgram = Effect.gen(function* () {
        if (existing && updateKind === 'unchanged') return

        if (existing && updateKind === 'mutable-only') {
          const { error } = yield* eventbriteTry('eventbrite.update-mutable', () => client
            .from('events')
            .update(getChangedMutableFields(transformed, existing))
            .eq('id', existing.id)
          )
          if (error) {
            console.error(`[eventbrite] Failed to update event: ${error.message}`)
            result.eventsSkipped++
          } else {
            result.eventsUpdated++
          }
          return
        }

        const presentationFields = !existing || sourceDescriptionsChanged(transformed, existing)
          ? yield* eventbriteTry('eventbrite.presentation-fields', () => buildDescriptionPresentationFields({
              description_es: transformed.description_es,
              description_en: transformed.description_en,
            }))
          : {}
        const eventbriteVenueName = event.location?.name ?? null
        const eventbriteNeighborhood = event.location?.address?.addressLocality ?? null
        const { embedding, searchDocument } = yield* eventbriteTry('eventbrite.embed', () =>
          embedEventWithDocument({
            name: transformed.name,
            description_es: transformed.description_es,
            description_en: transformed.description_en,
            categories: transformed.categories,
            price: transformed.price,
            is_free: transformed.is_free,
            facets: transformed.facets,
            venue_name: eventbriteVenueName,
            venue_neighborhood: eventbriteNeighborhood,
          })
        )
        const eventWithEmbedding = {
          ...transformed,
          ...presentationFields,
          embedding,
          search_document: searchDocument,
          embedding_version: CURRENT_EMBEDDING_VERSION,
          enrichment_status: 'pending' as const,
        }

        if (existing) {
          const { error } = yield* eventbriteTry('eventbrite.update-event', () => client
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
            console.error(`[eventbrite] Failed to update event: ${error.message}`)
            result.eventsSkipped++
          } else {
            result.eventsUpdated++
          }
        } else {
          const { error } = yield* eventbriteTry('eventbrite.insert-event', () =>
            client.from('events').insert(eventWithEmbedding)
          )
          if (error) {
            console.error(`[eventbrite] Failed to insert event: ${error.message}`)
            result.eventsSkipped++
          } else {
            result.eventsInserted++
          }
        }
        yield* delayEffect(100).pipe(Effect.mapError((error) => asEventbriteError('eventbrite.rate-limit-delay', error)))
      })
      return Effect.catchEager(itemProgram, (error) => {
        console.error(`[eventbrite] Error processing event ${transformed.name}:`, error)
        result.eventsSkipped++
        return Effect.succeed(undefined)
      })
    }, { concurrency: 1 })

    console.log(
      `[eventbrite] Import complete: ${result.eventsInserted} inserted, ${result.eventsUpdated} updated, ${result.eventsSkipped} skipped`
    )
    return result
  })
}

export async function processEventbriteImport(
  client: SupabaseClient,
  options: EventbriteImportOptions = {}
): Promise<EventbriteImportResult> {
  try {
    return await Effect.runPromise(processEventbriteImportEffect(client, options))
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error))
  }
}
