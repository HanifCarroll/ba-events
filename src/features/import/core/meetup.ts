/**
 * Core Meetup Import Logic
 *
 * HTTP-independent logic for importing Meetup events.
 * Can be called from both manual import wizard and Trigger.dev jobs.
 *
 * Note: Meetup requires browser scraping and scrapes day-by-day for accurate results.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { addDays, format } from 'date-fns'
import {
  scrapeMeetupEvents,
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
import { checkDuplicateEventsWithData } from '../api/duplicate-detection.ts'
import { getBlocklistEntries } from '#shared/lib/db/blocklist.ts'
import { isBlockedByEntries } from '../scrapers/shared/blocklist-filter.ts'
import { settleVenues, getVenueIdFromResults, isPlaceholderResult, type VenueSettlementInput } from './venue-settlement.ts'
import { delay } from './nominatim.ts'
import { filterEventsByLocation } from './geo-validation.ts'
import type { EventInsert } from '#shared/lib/types.ts'

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
async function processBatch(
  client: SupabaseClient,
  batchEvents: MeetupEvent[],
  venueResults: Map<string, import('./venue-settlement.ts').VenueSettlementResult>,
  existingEventsMap: Map<string, import('../api/duplicate-detection.ts').ExistingEventData>,
  expandRecurringWeeks: number
): Promise<BatchProcessResult> {
  const result: BatchProcessResult = {
    inserted: 0,
    updated: 0,
    skipped: 0,
    expanded: 0,
    categorizationSuccessful: 0,
    categorizationFallback: 0,
  }

  // Transform events with venue IDs (handles recurring expansion)
  const transformedEvents: EventInsert[] = []
  const eventSourceMap: Map<EventInsert, MeetupEvent> = new Map()

  for (const event of batchEvents) {
    const venueName = event.venue?.name || null
    const venueId = getVenueIdFromResults(venueResults, venueName)
    const expanded = transformMeetupEventWithExpansion(event, venueId, expandRecurringWeeks)

    // Check if venue was detected as a placeholder (TBA)
    const isPlaceholder = isPlaceholderResult(venueResults, venueName)

    for (const transformed of expanded) {
      if (isPlaceholder) {
        transformed.location_tba = true
      }
      transformedEvents.push(transformed)
      eventSourceMap.set(transformed, event)
    }
  }
  result.expanded = transformedEvents.length

  if (transformedEvents.length === 0) {
    return result
  }

  // Build list of events to process with update status
  const eventsToProcess: Array<{ transformed: EventInsert; sourceEvent: MeetupEvent; isUpdate: boolean }> = []
  for (const transformed of transformedEvents) {
    const sourceEvent = eventSourceMap.get(transformed)!
    const existing = transformed.external_id ? existingEventsMap.get(transformed.external_id) : undefined
    eventsToProcess.push({
      transformed,
      sourceEvent,
      isUpdate: !!existing,
    })
  }

  // Categorize events with AI
  const { categories, stats: catStats } = await categorizeEventsBatchWithStats(
    eventsToProcess.map((e) => ({
      name: e.transformed.name,
      description: e.transformed.description_es,
    })),
    100 // 100ms delay between requests
  )

  result.categorizationSuccessful = catStats.successful
  result.categorizationFallback = catStats.fallback

  // Apply categories to events
  for (let i = 0; i < eventsToProcess.length; i++) {
    eventsToProcess[i].transformed.categories = [categories[i]]
  }

  // Generate embeddings and upsert
  for (const { transformed, sourceEvent, isUpdate } of eventsToProcess) {
    try {
      const presentationFields = await buildDescriptionPresentationFields({
        description_es: transformed.description_es,
        description_en: transformed.description_en,
      })

      // Generate embedding + search document together (they must not drift).
      // Meetup provides the venue name + city on the source event, and they
      // feed the canonical document alongside facets, price and free/paid.
      const { embedding, searchDocument } = await embedEventWithDocument({
        name: transformed.name,
        description_es: transformed.description_es,
        description_en: transformed.description_en,
        categories: transformed.categories,
        price: transformed.price,
        is_free: transformed.is_free,
        facets: transformed.facets,
        venue_name: sourceEvent.venue?.name ?? null,
        venue_neighborhood: sourceEvent.venue?.city ?? null,
      })

      const eventWithEmbedding = {
        ...transformed,
        ...presentationFields,
        embedding,
        search_document: searchDocument,
        embedding_version: CURRENT_EMBEDDING_VERSION,
        enrichment_status: 'pending' as const,
      }

      if (isUpdate) {
        // Update existing event
        const existing = existingEventsMap.get(transformed.external_id!)
        const { error } = await client
          .from('events')
          .update({
            name: eventWithEmbedding.name,
            description_es: eventWithEmbedding.description_es,
            description_en: eventWithEmbedding.description_en,
            description_display_es: eventWithEmbedding.description_display_es,
            description_display_en: eventWithEmbedding.description_display_en,
            description_summary_es: eventWithEmbedding.description_summary_es,
            description_summary_en: eventWithEmbedding.description_summary_en,
            starts_at: eventWithEmbedding.starts_at,
            ends_at: eventWithEmbedding.ends_at,
            status: eventWithEmbedding.status,
            venue_id: eventWithEmbedding.venue_id,
            categories: eventWithEmbedding.categories,
            price: eventWithEmbedding.price,
            is_free: eventWithEmbedding.is_free,
            image_url: eventWithEmbedding.image_url,
            embedding: eventWithEmbedding.embedding,
            search_document: eventWithEmbedding.search_document,
            embedding_version: eventWithEmbedding.embedding_version,
            location_tba: eventWithEmbedding.location_tba ?? false,
          })
          .eq('id', existing!.id)

        if (error) {
          logger.error('[meetup] Failed to update event', { error: error.message })
          result.skipped++
        } else {
          result.updated++
        }
      } else {
        // Insert new event
        const { error } = await client.from('events').insert(eventWithEmbedding)

        if (error) {
          logger.error('[meetup] Failed to insert event', { error: error.message })
          result.skipped++
        } else {
          result.inserted++
        }
      }

      // Rate limiting for embedding API
      await delay(100)
    } catch (error) {
      logger.logError(`[meetup] Error processing event ${transformed.name}`, error)
      result.skipped++
    }
  }

  return result
}

// ============================================================================
// MAIN IMPORT FUNCTION
// ============================================================================

/**
 * Process a full Meetup import.
 *
 * Steps:
 * 1. Scrape events from Meetup (day-by-day browser scraping)
 * 2. Filter in-person events, apply blocklist, filter by date range
 * 3. Settle venues (match, auto-create, or queue for review)
 * 4. Transform events (handles recurring event expansion)
 * 5. Check for duplicates
 * 6. Categorize events with AI
 * 7. Generate embeddings
 * 8. Upsert events to database
 */
export async function processMeetupImport(
  client: SupabaseClient,
  options: MeetupImportOptions = {}
): Promise<MeetupImportResult> {
  const daysAhead = options.daysAhead ?? 14
  const startDate = options.startDate ?? format(new Date(), 'yyyy-MM-dd')
  const endDate = options.endDate ?? format(addDays(new Date(), daysAhead), 'yyyy-MM-dd')
  const expandRecurringWeeks = options.expandRecurringWeeks ?? 4

  logger.info('[meetup] Starting import', { startDate, endDate })

  // Initialize result
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

  // Step 1: Scrape events (day-by-day)
  logger.info('[meetup] Scraping events from Meetup (browser mode)')
  const allEvents = await scrapeMeetupEvents({ startDate, endDate })
  result.eventsFetched = allEvents.length
  logger.info('[meetup] Scraped events', { count: allEvents.length })

  // Step 1.5: Fetch each detail page once for description, venue, dates, and status.
  if (allEvents.length > 0) {
    logger.info('[meetup] Enriching events from detail pages', { count: allEvents.length })
    await enrichMeetupEventsWithDetails(allEvents)
  }

  // Step 2: Filter events
  logger.info('[meetup] Filtering events')
  const blocklistEntries = await getBlocklistEntries('meetup', client)
  const inPersonEvents = filterInPersonEvents(allEvents)
  const nonBlockedEvents = filterBlockedEvents(inPersonEvents, blocklistEntries)
  const dateFilteredEvents = filterByDateRange(nonBlockedEvents, startDate, endDate)

  // Step 2.5: Filter by geographic location (reject events outside Buenos Aires)
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

  // Step 3: Settle venues
  logger.info('[meetup] Settling venues')
  const uniqueVenueNames = getUniqueVenueNames(filteredEvents)
  const venueInputs: VenueSettlementInput[] = uniqueVenueNames
    .filter((name) => name)
    .map((name) => {
      // Find first event with this venue for coordinates
      const eventWithVenue = filteredEvents.find((e) => e.venue?.name === name)
      return {
        name,
        address: eventWithVenue?.venue?.address || null,
        coordinates: eventWithVenue?.venue?.lat && eventWithVenue?.venue?.lng
          ? { lat: eventWithVenue.venue.lat, lng: eventWithVenue.venue.lng }
          : null,
      }
    })

  const { results: venueResults, stats: venueStats } = await settleVenues(
    client,
    venueInputs,
    { source: 'meetup', scrapeRunId: options.scrapeRunId }
  )

  result.venuesMatched = venueStats.matched
  result.venuesAutoCreated = venueStats.autoCreated
  result.venuesQueuedReview = venueStats.queuedReview

  // Step 4: Get all external IDs upfront for duplicate checking
  // We need to expand events first to get their external IDs
  const allExternalIds: string[] = []
  for (const event of filteredEvents) {
    const expanded = transformMeetupEventWithExpansion(event, null, expandRecurringWeeks)
    for (const e of expanded) {
      if (e.external_id) allExternalIds.push(e.external_id)
    }
  }

  const existingEventsMap = options.skipDuplicateCheck
    ? new Map()
    : await checkDuplicateEventsWithData(allExternalIds, 'meetup', client)

  // Step 5: Process in daily batches to reduce memory pressure
  logger.info('[meetup] Processing events in daily batches')
  const eventsByDay = groupEventsByDay(filteredEvents)
  const sortedDays = Array.from(eventsByDay.keys()).sort()

  for (const dayKey of sortedDays) {
    const dayEvents = eventsByDay.get(dayKey)!
    logger.debug(`[meetup] Processing batch for ${dayKey}`, { count: dayEvents.length })

    const batchResult = await processBatch(
      client,
      dayEvents,
      venueResults,
      existingEventsMap,
      expandRecurringWeeks
    )

    // Accumulate stats
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
}
