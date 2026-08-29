/**
 * Core BA Tourism Import Logic
 *
 * HTTP-independent logic for importing BA Tourism events.
 * Can be called from both manual import wizard and Trigger.dev jobs.
 *
 * Note: BA Tourism website shows events for the current week only.
 * The site is updated weekly, so we import all events (no date range filter).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  scrapeBATourismEventsWithBrowser,
} from '../scrapers/ba-tourism/browser-scraper.ts'
import {
  transformBATourismEvent,
  getUniqueVenueNames,
} from '../scrapers/ba-tourism/transformer.ts'
import type { BATourismEvent } from '../scrapers/ba-tourism/types.ts'
import { categorizeEventsBatchWithStats } from '../scrapers/ai-categorizer.ts'
import {
  embedEventWithDocument,
  CURRENT_EMBEDDING_VERSION,
} from '#shared/lib/ai/embeddings.ts'
import { buildDescriptionPresentationFields } from '#features/events/lib/description-presentation.server.ts'
import { checkDuplicateEventsWithData, type ExistingEventData } from '../api/duplicate-detection.ts'
import { classifyScraperUpdate, getChangedMutableFields, sourceDescriptionsChanged, type ScraperUpdateKind } from './scraper-update.ts'
import { getBlocklistEntries } from '#shared/lib/db/blocklist.ts'
import { isBlockedByEntries } from '../scrapers/shared/blocklist-filter.ts'
import { settleVenues, getVenueIdFromResults, isPlaceholderResult, type VenueSettlementInput } from './venue-settlement.ts'
import { delay } from './nominatim.ts'
import type { EventInsert } from '#shared/lib/types.ts'

// ============================================================================
// TYPES
// ============================================================================

export interface BATourismImportOptions {
  /** Skip duplicate checking (for testing) */
  skipDuplicateCheck?: boolean
  /** Scrape run ID for audit trail */
  scrapeRunId?: string | null
  /** Reference date for date parsing (default: current date) */
  referenceDate?: Date
}

export interface BATourismImportResult {
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
  blocklistEntries: Awaited<ReturnType<typeof getBlocklistEntries>>
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
export async function processBATourismImport(
  client: SupabaseClient,
  options: BATourismImportOptions = {}
): Promise<BATourismImportResult> {
  const referenceDate = options.referenceDate ?? new Date()

  console.log('[ba-tourism] Starting import')

  // Initialize result
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

  // Step 1: Scrape events
  console.log('[ba-tourism] Scraping events from website (browser mode)...')
  const { events: allEvents, weekContext } = await scrapeBATourismEventsWithBrowser()
  result.eventsFetched = allEvents.length
  result.weekStart = weekContext.startDate?.toISOString() || null
  result.weekEnd = weekContext.endDate?.toISOString() || null
  console.log(`[ba-tourism] Scraped ${allEvents.length} events for week ${result.weekStart} to ${result.weekEnd}`)

  // Step 2: Apply blocklist filter
  console.log('[ba-tourism] Filtering events...')
  const blocklistEntries = await getBlocklistEntries('ba_tourism', client)
  const filteredEvents = filterBlockedEvents(allEvents, blocklistEntries)
  result.eventsFiltered = filteredEvents.length
  console.log(`[ba-tourism] Filtered to ${filteredEvents.length} events after blocklist`)

  if (filteredEvents.length === 0) {
    console.log('[ba-tourism] No events to import')
    return result
  }

  // Step 3: Settle venues
  console.log('[ba-tourism] Settling venues...')
  const uniqueVenueNames = getUniqueVenueNames(filteredEvents)
  const venueInputs: VenueSettlementInput[] = uniqueVenueNames
    .filter((name) => name && name !== 'Ubicación no especificada')
    .map((name) => {
      // Find first event with this venue for coordinates/neighborhood
      const eventWithVenue = filteredEvents.find((e) => e.venueName === name)
      return {
        name,
        address: eventWithVenue?.address || null,
        neighborhood: eventWithVenue?.neighborhood || null, // BA Tourism provides neighborhood directly
        coordinates: eventWithVenue?.coordinates || null,
      }
    })

  const { results: venueResults, stats: venueStats } = await settleVenues(
    client,
    venueInputs,
    { source: 'ba-tourism', scrapeRunId: options.scrapeRunId }
  )

  result.venuesMatched = venueStats.matched
  result.venuesAutoCreated = venueStats.autoCreated
  result.venuesQueuedReview = venueStats.queuedReview

  // Step 4: Transform events with venue IDs (handles multi-day expansion)
  console.log('[ba-tourism] Transforming events...')
  const transformedEvents: EventInsert[] = []
  const eventSourceMap: Map<EventInsert, BATourismEvent> = new Map()

  for (const event of filteredEvents) {
    const venueId = getVenueIdFromResults(venueResults, event.venueName)
    const expanded = transformBATourismEvent(event, weekContext, venueId, referenceDate)

    // Check if venue was detected as a placeholder (TBA)
    const isPlaceholder = isPlaceholderResult(venueResults, event.venueName)

    for (const transformed of expanded) {
      if (isPlaceholder) {
        transformed.location_tba = true
      }
      transformedEvents.push(transformed)
      eventSourceMap.set(transformed, event)
    }
  }
  result.eventsExpanded = transformedEvents.length
  console.log(`[ba-tourism] Expanded to ${transformedEvents.length} event entries`)

  // Step 5: Check duplicates
  const externalIds = transformedEvents
    .map((e) => e.external_id)
    .filter((id): id is string => id !== null)
  const existingEventsMap = options.skipDuplicateCheck
    ? new Map()
    : await checkDuplicateEventsWithData(externalIds, 'ba-tourism', client)

  // Build list of events to process with update status
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

  // Step 6: Categorize events with AI
  console.log('[ba-tourism] Categorizing events...')
  const { categories, stats: catStats } = await categorizeEventsBatchWithStats(
    eventsToProcess.filter((e) => !e.existing).map((e) => ({
      name: e.transformed.name,
      description: e.transformed.description_es,
    })),
    100 // 100ms delay between requests
  )

  result.categorizationSuccessful = catStats.successful
  result.categorizationFallback = catStats.fallback

  const newEvents = eventsToProcess.filter((e) => !e.existing)
  for (let i = 0; i < newEvents.length; i++) {
    newEvents[i].transformed.categories = [categories[i]]
  }

  // Step 7: Generate embeddings and upsert
  console.log('[ba-tourism] Generating embeddings and upserting events...')
  for (const { transformed, sourceEvent, existing, updateKind } of eventsToProcess) {
    if (existing && updateKind === 'unchanged') continue

    try {
      if (existing && updateKind === 'mutable-only') {
        const { error } = await client
          .from('events')
          .update(getChangedMutableFields(transformed, existing))
          .eq('id', existing.id)
        if (error) {
          console.error(`[ba-tourism] Failed to update event: ${error.message}`)
          result.eventsSkipped++
        } else {
          result.eventsUpdated++
        }
        continue
      }

      const presentationFields = !existing || sourceDescriptionsChanged(transformed, existing)
        ? await buildDescriptionPresentationFields({
            description_es: transformed.description_es,
            description_en: transformed.description_en,
          })
        : {}

      // Generate embedding + search document together (they must not drift).
      // BA Tourism provides the venue name + neighborhood directly on the
      // source event, so they feed the canonical document alongside facets,
      // price and free/paid status.
      const { embedding, searchDocument } = await embedEventWithDocument({
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

      const eventWithEmbedding = {
        ...transformed,
        ...presentationFields,
        embedding,
        search_document: searchDocument,
        embedding_version: CURRENT_EMBEDDING_VERSION,
        enrichment_status: 'pending' as const,
      }

      if (existing) {
        const { error } = await client
          .from('events')
          .update({
            name: eventWithEmbedding.name,
            description_es: eventWithEmbedding.description_es,
            description_en: eventWithEmbedding.description_en,
            ...presentationFields,
            categories: eventWithEmbedding.categories,
            is_free: eventWithEmbedding.is_free,
            embedding: eventWithEmbedding.embedding,
            search_document: eventWithEmbedding.search_document,
            embedding_version: eventWithEmbedding.embedding_version,
            ...getChangedMutableFields(eventWithEmbedding, existing),
          })
          .eq('id', existing.id)

        if (error) {
          console.error(`[ba-tourism] Failed to update event: ${error.message}`)
          result.eventsSkipped++
        } else {
          result.eventsUpdated++
        }
      } else {
        // Insert new event
        const { error } = await client.from('events').insert(eventWithEmbedding)

        if (error) {
          console.error(`[ba-tourism] Failed to insert event: ${error.message}`)
          result.eventsSkipped++
        } else {
          result.eventsInserted++
        }
      }

      // Rate limiting for embedding API
      await delay(100)
    } catch (error) {
      console.error(`[ba-tourism] Error processing event ${transformed.name}:`, error)
      result.eventsSkipped++
    }
  }

  console.log(
    `[ba-tourism] Import complete: ${result.eventsInserted} inserted, ${result.eventsUpdated} updated, ${result.eventsSkipped} skipped`
  )

  return result
}
