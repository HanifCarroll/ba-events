/**
 * Core Venti Import Logic
 *
 * HTTP-independent logic for importing Venti events.
 * Used by the Trigger.dev daily scrape job.
 *
 * Venti's public API includes Spanish descriptions and venue coordinates in
 * the catalog response, so this pipeline is lighter than other sources:
 * no per-event detail fetches, native category mapping (party/concert/
 * festival/gastronomy), and prices from the per-event availability endpoint.
 */
import { Effect } from 'effect'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchVentiEvents, filterCABAEvents, fetchVentiAvailabilityBatch } from '../scrapers/venti/api.ts'
import { transformVentiEvent, getAllVenueInfo, getVenueName } from '../scrapers/venti/transformer.ts'
import type { VentiEvent } from '../scrapers/venti/types.ts'
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
import { settleVenuesEffect, getVenueIdFromResults, getVenueNeighborhoodFromResults, type VenueSettlementInput } from './venue-settlement.ts'
import { delayEffect } from './nominatim.ts'
import { importTry, ImportOperationError } from './effect-utils.ts'
import type { EventInsert, ImportBlocklistEntry } from '#shared/lib/types.ts'

// ============================================================================
// TYPES
// ============================================================================

export interface VentiImportOptions {
  /** Skip duplicate checking (for testing) */
  skipDuplicateCheck?: boolean
  /** Scrape run ID for audit trail */
  scrapeRunId?: string | null
}

export interface VentiImportResult {
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
  events: VentiEvent[],
  blocklistEntries: ImportBlocklistEntry[]
): VentiEvent[] {
  return events.filter((event) => {
    const venueName = getVenueName(event) || ''
    return !isBlockedByEntries(event.name, venueName, blocklistEntries)
  })
}

// ============================================================================
// MAIN IMPORT FUNCTION
// ============================================================================

/**
 * Process a full Venti import.
 *
 * Steps:
 * 1. Fetch all events from Venti's catalog API
 * 2. Filter to CABA events + blocklist filter
 * 3. Fetch ticket availability (prices) for remaining events
 * 4. Settle venues (match, auto-create, or queue for review)
 * 5. Check for duplicates
 * 6. Transform events, map native categories (AI fallback for unknowns)
 * 7. Generate embeddings and upsert events
 */
function ventiTry<A>(operation: string, run: () => PromiseLike<A>) {
  return importTry(operation, run)
}

function asVentiError(operation: string, error: unknown): ImportOperationError {
  if (error instanceof ImportOperationError) return error
  return new ImportOperationError({
    operation,
    message: error instanceof Error ? error.message : String(error),
    cause: error,
  })
}

/** Effect-native Venti import coordinator. */
export function processVentiImportEffect(
  client: SupabaseClient,
  options: VentiImportOptions = {}
): Effect.Effect<VentiImportResult, ImportOperationError> {
  return Effect.gen(function* () {
    console.log('[venti] Starting import')
    const result: VentiImportResult = {
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

    console.log('[venti] Fetching events from catalog API...')
    const allEvents = yield* ventiTry('venti.fetch-events', () => fetchVentiEvents())
    result.eventsFetched = allEvents.length
    console.log(`[venti] Fetched ${allEvents.length} events`)

    console.log('[venti] Filtering events...')
    const cabaEvents = filterCABAEvents(allEvents)
    const blocklistEntries = yield* ventiTry('venti.load-blocklist', () => getBlocklistEntries('venti', client))
    const filteredEvents = filterBlockedEvents(cabaEvents, blocklistEntries)
    result.eventsFiltered = filteredEvents.length
    console.log(`[venti] Filtered to ${filteredEvents.length} events (${cabaEvents.length} CABA, blocklist applied)`)
    if (filteredEvents.length === 0) return result

    console.log('[venti] Fetching ticket availability...')
    const availabilityMap = yield* ventiTry(
      'venti.fetch-availability',
      () => fetchVentiAvailabilityBatch(filteredEvents)
    )

    console.log('[venti] Settling venues...')
    const venueInfoMap = getAllVenueInfo(filteredEvents)
    const venueInputs: VenueSettlementInput[] = Array.from(venueInfoMap.entries()).map(([name, info]) => ({
      name,
      address: info.address,
      coordinates: info.latitude && info.longitude
        ? { lat: info.latitude, lng: info.longitude }
        : null,
    }))
    const { results: venueResults, stats: venueStats } = yield* settleVenuesEffect(
      client,
      venueInputs,
      { source: 'venti', scrapeRunId: options.scrapeRunId }
    ).pipe(Effect.mapError((error) => asVentiError('venti.settle-venues', error)))
    result.venuesMatched = venueStats.matched
    result.venuesAutoCreated = venueStats.autoCreated
    result.venuesQueuedReview = venueStats.queuedReview

    const externalIds = filteredEvents.map((event) => String(event.id))
    const existingEventsMap = options.skipDuplicateCheck
      ? new Map<string, ExistingEventData>()
      : yield* checkDuplicateEventsWithDataEffect(externalIds, 'venti', client).pipe(
          Effect.mapError((error) => asVentiError('venti.duplicate-check', error))
        )

    console.log('[venti] Transforming events...')
    const eventsToProcess: Array<{
      event: VentiEvent
      transformed: EventInsert
      existing?: ExistingEventData
      updateKind?: ScraperUpdateKind
    }> = []
    for (const event of filteredEvents) {
      const venueName = getVenueName(event)
      const venueId = getVenueIdFromResults(venueResults, venueName)
      const availability = availabilityMap.get(event.id) ?? null
      const transformed = transformVentiEvent(event, venueId, availability)
      const existing = existingEventsMap.get(String(event.id))
      if (existing) {
        transformed.facets = existing.facets
        if (!(transformed.categories?.length)) transformed.categories = existing.categories
      }
      eventsToProcess.push({
        event,
        transformed,
        existing,
        updateKind: existing ? classifyScraperUpdate(transformed, existing, CURRENT_EMBEDDING_VERSION) : undefined,
      })
    }

    const uncategorized = eventsToProcess.filter(
      (item) => (item.transformed.categories ?? []).length === 0 &&
        (!item.existing || item.updateKind === 'search-input/stale-embedding')
    )
    if (uncategorized.length > 0) {
      console.log(`[venti] Categorizing ${uncategorized.length} events with unknown categories...`)
      const { categories, stats: catStats } = yield* ventiTry(
        'venti.categorize',
        () => categorizeEventsBatchWithStats(
          uncategorized.map((item) => ({
            name: item.transformed.name,
            description: item.transformed.description_es,
          })),
          1500
        )
      )
      result.categorizationSuccessful = catStats.successful
      result.categorizationFallback = catStats.fallback
      for (let i = 0; i < uncategorized.length; i++) uncategorized[i].transformed.categories = [categories[i]]
    }

    console.log('[venti] Generating embeddings and upserting events...')
    yield* Effect.forEach(eventsToProcess, ({ event, transformed, existing, updateKind }) => {
      const itemProgram = Effect.gen(function* () {
        if (existing && updateKind === 'unchanged') return
        if (existing && updateKind === 'mutable-only') {
          const { error } = yield* ventiTry('venti.update-mutable', () => client
            .from('events')
            .update(getChangedMutableFields(transformed, existing))
            .eq('id', existing.id)
          )
          if (error) {
            console.error(`[venti] Failed to update event: ${error.message}`)
            result.eventsSkipped++
          } else {
            result.eventsUpdated++
          }
          return
        }

        const presentationFields = !existing || sourceDescriptionsChanged(transformed, existing)
          ? yield* ventiTry('venti.presentation-fields', () => buildDescriptionPresentationFields({
              description_es: transformed.description_es,
              description_en: transformed.description_en,
            }))
          : {}
        const { embedding, searchDocument } = yield* ventiTry('venti.embed', () => embedEventWithDocument({
          name: transformed.name,
          description_es: transformed.description_es,
          description_en: transformed.description_en,
          categories: transformed.categories,
          price: transformed.price,
          is_free: transformed.is_free,
          facets: transformed.facets,
          venue_name: getVenueName(event) ?? null,
          venue_neighborhood: getVenueNeighborhoodFromResults(venueResults, getVenueName(event)),
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
          const { error } = yield* ventiTry('venti.update-event', () => client
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
            console.error(`[venti] Failed to update event: ${error.message}`)
            result.eventsSkipped++
          } else {
            result.eventsUpdated++
          }
        } else {
          const { error } = yield* ventiTry('venti.insert-event', () => client.from('events').insert(eventWithEmbedding))
          if (error) {
            console.error(`[venti] Failed to insert event: ${error.message}`)
            result.eventsSkipped++
          } else {
            result.eventsInserted++
          }
        }
        yield* delayEffect(100).pipe(Effect.mapError((error) => asVentiError('venti.rate-limit-delay', error)))
      })
      return Effect.catchEager(itemProgram, (error) => {
        console.error(`[venti] Error processing event ${transformed.name}:`, error)
        result.eventsSkipped++
        return Effect.succeed(undefined)
      })
    }, { concurrency: 1 })

    console.log(
      `[venti] Import complete: ${result.eventsInserted} inserted, ${result.eventsUpdated} updated, ${result.eventsSkipped} skipped`
    )
    return result
  })
}

export async function processVentiImport(
  client: SupabaseClient,
  options: VentiImportOptions = {}
): Promise<VentiImportResult> {
  try {
    return await Effect.runPromise(processVentiImportEffect(client, options))
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error))
  }
}
