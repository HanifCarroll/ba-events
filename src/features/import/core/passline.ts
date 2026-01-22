/**
 * Core Passline Import Logic
 *
 * HTTP-independent logic for importing Passline events.
 * Can be called from both manual import wizard and Trigger.dev jobs.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { addDays, format } from 'date-fns'
import {
  fetchPasslineEvents,
  filterCABAEvents,
  filterByDateRange,
  type PasslineEvent,
} from '../scrapers/passline/api'
import { transformPasslineEvent } from '../scrapers/passline/transformer'
import { categorizeEventsBatchWithStats } from '../scrapers/ai-categorizer'
import { generateEventEmbedding } from '@/shared/lib/ai/embeddings'
import { checkDuplicateEventsWithData } from '../api/duplicate-detection'
import { getBlocklistEntries } from '@/shared/lib/db/blocklist'
import { settleVenues, getVenueIdFromResults, isPlaceholderResult, type VenueSettlementInput } from './venue-settlement'
import { delay } from './nominatim'
import type { EventInsert } from '@/shared/lib/types'
import { logger } from '@/shared/lib/logger'

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
// MAIN IMPORT FUNCTION
// ============================================================================

/**
 * Process a full Passline import.
 *
 * Steps:
 * 1. Fetch events from Passline API
 * 2. Filter to CABA region, apply blocklist, filter by date range
 * 3. Settle venues (match, auto-create, or queue for review)
 * 4. Check for duplicates
 * 5. Categorize events with AI
 * 6. Generate embeddings
 * 7. Upsert events to database
 */
export async function processPasslineImport(
  client: SupabaseClient,
  options: PasslineImportOptions = {}
): Promise<PasslineImportResult> {
  const daysAhead = options.daysAhead ?? 30
  const startDate = options.startDate ?? format(new Date(), 'yyyy-MM-dd')
  const endDate = options.endDate ?? format(addDays(new Date(), daysAhead), 'yyyy-MM-dd')

  logger.info('[passline] Starting import', { startDate, endDate })

  // Initialize result
  const result: PasslineImportResult = {
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

  // Step 1: Fetch events
  logger.info('[passline] Fetching events from API')
  const allEvents = await fetchPasslineEvents()
  result.eventsFetched = allEvents.length
  logger.info('[passline] Fetched events', { count: allEvents.length })

  // Step 2: Filter events
  logger.debug('[passline] Filtering events')
  const blocklistEntries = await getBlocklistEntries('passline')
  const cabaEvents = filterCABAEvents(allEvents, blocklistEntries)
  const filteredEvents = filterByDateRange(cabaEvents, { startDate, endDate })
  result.eventsFiltered = filteredEvents.length
  logger.info('[passline] Filtered to CABA events in date range', { count: filteredEvents.length })

  if (filteredEvents.length === 0) {
    logger.info('[passline] No events to import')
    return result
  }

  // Step 3: Settle venues
  logger.info('[passline] Settling venues')
  const venueInputs: VenueSettlementInput[] = filteredEvents
    .map((e) => e.lugar)
    .filter((lugar, index, self) => lugar && self.indexOf(lugar) === index) // Dedupe
    .map((lugar) => ({ name: lugar }))

  const { results: venueResults, stats: venueStats } = await settleVenues(
    client,
    venueInputs,
    { source: 'passline', scrapeRunId: options.scrapeRunId }
  )

  result.venuesMatched = venueStats.matched
  result.venuesAutoCreated = venueStats.autoCreated
  result.venuesQueuedReview = venueStats.queuedReview

  // Step 4: Check duplicates
  const externalIds = filteredEvents.map((e) => e.id)
  const existingEventsMap = options.skipDuplicateCheck
    ? new Map()
    : await checkDuplicateEventsWithData(externalIds, 'passline', client)

  // Step 5: Transform events with venue IDs
  logger.info('[passline] Transforming events')
  const eventsToProcess: Array<{ event: PasslineEvent; transformed: EventInsert; isUpdate: boolean }> = []

  for (const event of filteredEvents) {
    const venueId = getVenueIdFromResults(venueResults, event.lugar)
    const transformed = transformPasslineEvent(event, venueId)

    // Check if venue was detected as a placeholder (TBA)
    const isPlaceholder = isPlaceholderResult(venueResults, event.lugar)
    if (isPlaceholder) {
      transformed.location_tba = true
    }

    const existing = existingEventsMap.get(event.id)
    if (existing) {
      // Event exists - check if we should update
      eventsToProcess.push({ event, transformed, isUpdate: true })
    } else {
      // New event
      eventsToProcess.push({ event, transformed, isUpdate: false })
    }
  }

  // Step 6: Categorize events with AI
  logger.info('[passline] Categorizing events')
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
  logger.info('[passline] Generating embeddings and upserting events')
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
          logger.error('[passline] Failed to update event', { error: error.message })
          result.eventsSkipped++
        } else {
          result.eventsUpdated++
        }
      } else {
        // Insert new event
        const { error } = await client.from('events').insert(eventWithEmbedding)

        if (error) {
          logger.error('[passline] Failed to insert event', { error: error.message })
          result.eventsSkipped++
        } else {
          result.eventsInserted++
        }
      }

      // Rate limiting for embedding API
      await delay(100)
    } catch (error) {
      logger.logError(`[passline] Error processing event ${transformed.name}`, error)
      result.eventsSkipped++
    }
  }

  logger.info('[passline] Import complete', {
    inserted: result.eventsInserted,
    updated: result.eventsUpdated,
    skipped: result.eventsSkipped,
  })

  return result
}
