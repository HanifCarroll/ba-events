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
  enrichMeetupEventsWithVenues,
  type MeetupEvent,
} from '../scrapers/meetup'
import { logger } from '@/shared/lib/logger'
import {
  transformMeetupEventWithExpansion,
  getUniqueVenueNames,
} from '../scrapers/meetup/transformer'
import { categorizeEventsBatchWithStats } from '../scrapers/ai-categorizer'
import { generateEventEmbedding } from '@/shared/lib/ai/embeddings'
import { checkDuplicateEventsWithData } from '../api/duplicate-detection'
import { getBlocklistEntries } from '@/shared/lib/db/blocklist'
import { isBlockedByEntries } from '../scrapers/shared/blocklist-filter'
import { settleVenues, getVenueIdFromResults, isPlaceholderResult, type VenueSettlementInput } from './venue-settlement'
import { delay } from './nominatim'
import type { EventInsert } from '@/shared/lib/types'

// ============================================================================
// TYPES
// ============================================================================

export interface MeetupImportOptions {
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
  const daysAhead = options.daysAhead ?? 30
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

  // Step 1.5: Enrich events with venue data (fetches individual event pages)
  // This is needed because venue data is not available in the list view
  const eventsNeedingVenues = allEvents.filter((e) => !e.venue && !e.isOnline)
  if (eventsNeedingVenues.length > 0) {
    logger.info('[meetup] Enriching events with venue data', { count: eventsNeedingVenues.length })
    const venueResults = await enrichMeetupEventsWithVenues(
      eventsNeedingVenues.map((e) => ({ id: e.id, eventUrl: e.eventUrl })),
      5, // concurrency
      500 // delay between batches
    )

    // Apply venue data back to events
    for (const venueResult of venueResults) {
      if (venueResult.venue) {
        const event = allEvents.find((e) => e.id === venueResult.eventId)
        if (event) {
          event.venue = {
            name: venueResult.venue.name,
            address: venueResult.venue.address,
            city: 'Buenos Aires',
            lat: null,
            lng: null,
          }
        }
      }
    }

    const enrichedCount = venueResults.filter((r) => r.venue).length
    logger.info('[meetup] Venue enrichment complete', { enriched: enrichedCount, total: eventsNeedingVenues.length })
  }

  // Step 2: Filter events
  logger.info('[meetup] Filtering events')
  const blocklistEntries = await getBlocklistEntries('meetup')
  const inPersonEvents = filterInPersonEvents(allEvents)
  const nonBlockedEvents = filterBlockedEvents(inPersonEvents, blocklistEntries)
  const filteredEvents = filterByDateRange(nonBlockedEvents, startDate, endDate)
  result.eventsFiltered = filteredEvents.length
  logger.info('[meetup] Filtered to in-person events in date range', { count: filteredEvents.length })

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

  // Step 4: Transform events with venue IDs (handles recurring expansion)
  logger.info('[meetup] Transforming events')
  const transformedEvents: EventInsert[] = []
  const eventSourceMap: Map<EventInsert, MeetupEvent> = new Map()

  for (const event of filteredEvents) {
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
  result.eventsExpanded = transformedEvents.length
  logger.info('[meetup] Expanded event entries', { count: transformedEvents.length })

  // Step 5: Check duplicates
  const externalIds = transformedEvents
    .map((e) => e.external_id)
    .filter((id): id is string => id !== null)
  const existingEventsMap = options.skipDuplicateCheck
    ? new Map()
    : await checkDuplicateEventsWithData(externalIds, 'meetup', client)

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

  // Step 6: Categorize events with AI
  logger.info('[meetup] Categorizing events')
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

  // Step 7: Generate embeddings and upsert
  logger.info('[meetup] Generating embeddings and upserting events')
  for (const { transformed, isUpdate } of eventsToProcess) {
    try {
      // Generate embedding
      const embedding = await generateEventEmbedding({
        name: transformed.name,
        description_es: transformed.description_es,
        categories: transformed.categories,
      })

      const eventWithEmbedding = {
        ...transformed,
        embedding,
        enrichment_status: 'pending' as const,
      }

      if (isUpdate) {
        // Update existing event
        const existing = existingEventsMap.get(transformed.external_id!)
        const { error } = await client
          .from('events')
          .update({
            name: eventWithEmbedding.name,
            starts_at: eventWithEmbedding.starts_at,
            ends_at: eventWithEmbedding.ends_at,
            venue_id: eventWithEmbedding.venue_id,
            categories: eventWithEmbedding.categories,
            price: eventWithEmbedding.price,
            is_free: eventWithEmbedding.is_free,
            image_url: eventWithEmbedding.image_url,
            embedding: eventWithEmbedding.embedding,
            location_tba: eventWithEmbedding.location_tba ?? false,
          })
          .eq('id', existing!.id)

        if (error) {
          logger.error('[meetup] Failed to update event', { error: error.message })
          result.eventsSkipped++
        } else {
          result.eventsUpdated++
        }
      } else {
        // Insert new event
        const { error } = await client.from('events').insert(eventWithEmbedding)

        if (error) {
          logger.error('[meetup] Failed to insert event', { error: error.message })
          result.eventsSkipped++
        } else {
          result.eventsInserted++
        }
      }

      // Rate limiting for embedding API
      await delay(100)
    } catch (error) {
      logger.logError(`[meetup] Error processing event ${transformed.name}`, error)
      result.eventsSkipped++
    }
  }

  logger.info('[meetup] Import complete', {
    inserted: result.eventsInserted,
    updated: result.eventsUpdated,
    skipped: result.eventsSkipped,
  })

  return result
}
