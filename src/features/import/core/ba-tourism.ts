/**
 * Core BA Tourism Import Logic
 *
 * HTTP-independent logic for importing BA Tourism events.
 * Called by the jobs Worker's daily scrape Workflow.
 *
 * Note: BA Tourism website shows events for the current week only.
 * The site is updated weekly, so we import all events (no date range filter).
 */
import { Effect } from 'effect'
import {
  scrapeBATourismEventsWithBrowser,
} from '../scrapers/ba-tourism/browser-scraper.ts'
import {
  transformBATourismEvent,
} from '../scrapers/ba-tourism/transformer.ts'
import type { BATourismEvent } from '../scrapers/ba-tourism/types.ts'
import type { OpenBrowser } from '../acquisition/run.ts'
import { categorizeEventsBatchWithStats } from '../scrapers/ai-categorizer.ts'
import {
  embedEventWithDocument,
  CURRENT_EMBEDDING_VERSION,
} from '#shared/lib/ai/embeddings.ts'
import { buildDescriptionPresentationFields } from '#features/events/lib/description-presentation.server.ts'
import { catalogImportProvenance, type CatalogImportProvenance } from './enrichment-provenance.ts'
import { checkDuplicateEventsWithDataEffect, type ExistingEventData } from '../api/duplicate-detection.ts'
import { classifyScraperUpdate, getChangedMutableFields, sourceDescriptionsChanged, type ScraperUpdateKind } from './scraper-update.ts'
import { isBlockedByEntries } from '../scrapers/shared/blocklist-filter.ts'
import { settleVenuesEffect, getVenueIdFromResults, isPlaceholderResult, type VenueSettlementInput } from './venue-settlement.ts'
import { delayEffect } from './nominatim.ts'
import type { CatalogStore } from './catalog-store.ts'
import { importTry, ImportOperationError } from './effect-utils.ts'
import { hasRefusedPublisherSearchInput } from '#shared/lib/db/event-write.ts'
import type { EventInsert, ImportBlocklistEntry } from '#shared/lib/types.ts'

// ============================================================================
// TYPES
// ============================================================================

export interface BATourismImportOptions {
  /** Opens the Browser Rendering session used for the weekly page */
  openBrowser: OpenBrowser
  /** Skip duplicate checking (for testing) */
  skipDuplicateCheck?: boolean
  /** Scrape run ID for audit trail */
  scrapeRunId?: string | null
  /** Reference date for date parsing (default: current date) */
  referenceDate?: Date
}

export interface BATourismImportResult {
  catalogProvenance?: CatalogImportProvenance
  // Scrape stats
  eventsFetched: number
  eventsFiltered: number
  eventsExpanded: number // After multi-day expansion

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

  // Week context
  weekStart: string | null
  weekEnd: string | null
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Filter events by blocklist
 */
function filterBlockedEvents(
  events: BATourismEvent[],
  blocklistEntries: ImportBlocklistEntry[]
): BATourismEvent[] {
  return events.filter((event) => {
    return !isBlockedByEntries(event.name, event.venueName, blocklistEntries)
  })
}

// ============================================================================
// MAIN IMPORT FUNCTION
// ============================================================================

/**
 * Process a full BA Tourism import.
 *
 * Steps:
 * 1. Scrape events from BA Tourism website (requires browser)
 * 2. Apply blocklist filter
 * 3. Settle venues (match, auto-create, or queue for review)
 * 4. Transform events (expands multi-day events)
 * 5. Check for duplicates
 * 6. Categorize events with AI
 * 7. Generate embeddings
 * 8. Upsert events to database
 */
function baTourismTry<A>(operation: string, run: () => PromiseLike<A>) {
  return importTry(operation, run)
}

function asBATourismError(operation: string, error: unknown): ImportOperationError {
  if (error instanceof ImportOperationError) return error
  return new ImportOperationError({
    operation,
    message: error instanceof Error ? error.message : String(error),
    cause: error,
  })
}

/** Effect-native BA Tourism coordinator. Browser scraping is a leaf; import
 * filtering, persistence, and per-event fallback are controlled here. */
export function processBATourismImportEffect(
  catalog: CatalogStore,
  options: BATourismImportOptions
): Effect.Effect<BATourismImportResult, ImportOperationError> {
  return Effect.gen(function* () {
    const referenceDate = options.referenceDate ?? new Date()
    console.log('[ba-tourism] Starting import')
    const result: BATourismImportResult = {
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
      weekStart: null,
      weekEnd: null,
    }

    console.log('[ba-tourism] Scraping events from website (browser mode)...')
    const { events: allEvents, weekContext } = yield* baTourismTry(
      'ba-tourism.scrape',
      () => scrapeBATourismEventsWithBrowser(options.openBrowser)
    )
    result.catalogProvenance = catalogImportProvenance(new Date().toISOString())
    result.eventsFetched = allEvents.length
    result.weekStart = weekContext.startDate?.toISOString() || null
    result.weekEnd = weekContext.endDate?.toISOString() || null
    console.log(`[ba-tourism] Scraped ${allEvents.length} events for week ${result.weekStart} to ${result.weekEnd}`)

    console.log('[ba-tourism] Filtering events...')
    const blocklistEntries = yield* baTourismTry(
      'ba-tourism.load-blocklist',
      () => catalog.blocklistEntries('ba_tourism')
    )
    const filteredEvents = filterBlockedEvents(allEvents, blocklistEntries)
    result.eventsFiltered = filteredEvents.length
    console.log(`[ba-tourism] Filtered to ${filteredEvents.length} events after blocklist`)
    if (filteredEvents.length === 0) return result

    console.log('[ba-tourism] Settling venues...')
    // One input per event; settlement dedupes by `venueSettlementKey` (name plus street and number).
    const venueInputs: VenueSettlementInput[] = filteredEvents
      .filter((event) => event.venueName && event.venueName !== 'Ubicación no especificada')
      .map((event) => ({
        name: event.venueName,
        address: event.address || null,
        neighborhood: event.neighborhood || null,
        coordinates: event.coordinates || null,
      }))
    const { results: venueResults, stats: venueStats } = yield* settleVenuesEffect(
      catalog,
      venueInputs,
      { source: 'ba-tourism', scrapeRunId: options.scrapeRunId }
    ).pipe(Effect.mapError((error) => asBATourismError('ba-tourism.settle-venues', error)))
    result.venuesMatched = venueStats.matched
    result.venuesAutoCreated = venueStats.autoCreated
    result.venuesQueuedReview = venueStats.queuedReview

    console.log('[ba-tourism] Transforming events...')
    const transformedEvents: EventInsert[] = []
    const eventSourceMap: Map<EventInsert, BATourismEvent> = new Map()
    for (const event of filteredEvents) {
      const venueId = getVenueIdFromResults(venueResults, event.venueName, event.address)
      const expanded = transformBATourismEvent(event, weekContext, venueId, referenceDate)
      const isPlaceholder = isPlaceholderResult(venueResults, event.venueName, event.address)
      for (const transformed of expanded) {
        if (isPlaceholder) transformed.location_tba = true
        transformedEvents.push(transformed)
        eventSourceMap.set(transformed, event)
      }
    }
    result.eventsExpanded = transformedEvents.length
    console.log(`[ba-tourism] Expanded to ${transformedEvents.length} event entries`)

    const externalIds = transformedEvents
      .map((event) => event.external_id)
      .filter((id): id is string => id !== null)
    const existingEventsMap = options.skipDuplicateCheck
      ? new Map<string, ExistingEventData>()
      : yield* checkDuplicateEventsWithDataEffect(externalIds, 'ba-tourism', catalog).pipe(
          Effect.mapError((error) => asBATourismError('ba-tourism.duplicate-check', error))
        )

    const eventsToProcess: Array<{
      transformed: EventInsert
      sourceEvent: BATourismEvent
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

    console.log('[ba-tourism] Categorizing events...')
    const { categories, stats: catStats } = yield* baTourismTry(
      'ba-tourism.categorize',
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

    console.log('[ba-tourism] Generating embeddings and upserting events...')
    yield* Effect.forEach(eventsToProcess, ({ transformed, sourceEvent, existing, updateKind }) => {
      const itemProgram = Effect.gen(function* () {
        if (existing && updateKind === 'unchanged') return
        if (existing && updateKind === 'mutable-only') {
          const write = yield* baTourismTry('ba-tourism.update-mutable', () => catalog.updateEvent(existing.id, getChangedMutableFields(transformed, existing)).catch((error: Error) => error))
          if (write instanceof Error) {
            console.error(`[ba-tourism] Failed to update event: ${write.message}`)
            result.eventsSkipped++
          } else if (write.applied.length) {
            result.eventsUpdated++
          }
          return
        }

        // Drain both provider calls on failure before advancing the rate-limited item loop.
        const [presentationResult, embeddingResult] = yield* Effect.all([
          !existing || sourceDescriptionsChanged(transformed, existing)
            ? baTourismTry('ba-tourism.presentation-fields', () => buildDescriptionPresentationFields({
              description_es: transformed.description_es,
              description_en: transformed.description_en,
            }))
            : Effect.succeed({}),
          hasRefusedPublisherSearchInput(existing && { ...existing }, transformed) ? Effect.succeed(null) : baTourismTry('ba-tourism.embed', () =>
            embedEventWithDocument({
              name: transformed.name,
              description_es: transformed.description_es,
              description_en: transformed.description_en,
              categories: transformed.categories,
              price: transformed.price,
              is_free: transformed.is_free,
              facets: transformed.facets,
              venue_name: sourceEvent.venueName || null,
              venue_neighborhood: sourceEvent.neighborhood || null,
            })
          ),
        ], { concurrency: 2, mode: 'result' })
        const presentationFields = yield* Effect.fromResult(presentationResult)
        const indexed = yield* Effect.fromResult(embeddingResult)
        const indexFields = indexed ? { embedding: indexed.embedding, search_document: indexed.searchDocument, embedding_version: CURRENT_EMBEDDING_VERSION } : {}
        const eventWithEmbedding = {
          ...transformed,
          ...presentationFields,
          ...indexFields,
          enrichment_status: 'pending' as const,
        }

        if (existing) {
          const write = yield* baTourismTry('ba-tourism.update-event', () => catalog.updateEvent(existing.id, {
              name: eventWithEmbedding.name,
              description_es: eventWithEmbedding.description_es,
              description_en: eventWithEmbedding.description_en,
              ...presentationFields,
              categories: eventWithEmbedding.categories,
              is_free: eventWithEmbedding.is_free,
              ...indexFields,
              ...getChangedMutableFields(eventWithEmbedding, existing),
            }).catch((error: Error) => error)
          )
          if (write instanceof Error) {
            console.error(`[ba-tourism] Failed to update event: ${write.message}`)
            result.eventsSkipped++
          } else if (write.applied.length) {
            result.eventsUpdated++
          }
        } else {
          const error = yield* baTourismTry('ba-tourism.insert-event', () => catalog.insertEvent(eventWithEmbedding).then(() => null, (error: Error) => error))
          if (error) {
            console.error(`[ba-tourism] Failed to insert event: ${error.message}`)
            result.eventsSkipped++
          } else {
            result.eventsInserted++
          }
        }
        yield* delayEffect(100).pipe(Effect.mapError((error) => asBATourismError('ba-tourism.rate-limit-delay', error)))
      })
      return Effect.catchEager(itemProgram, (error) => {
        console.error(`[ba-tourism] Error processing event ${transformed.name}:`, error)
        result.eventsSkipped++
        return Effect.undefined
      })
    }, { concurrency: 1 })

    console.log(
      `[ba-tourism] Import complete: ${result.eventsInserted} inserted, ${result.eventsUpdated} updated, ${result.eventsSkipped} skipped`
    )
    return result
  })
}

export async function processBATourismImport(
  catalog: CatalogStore,
  options: BATourismImportOptions
): Promise<BATourismImportResult> {
  try {
    return await Effect.runPromise(processBATourismImportEffect(catalog, options))
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error))
  }
}
