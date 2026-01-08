/**
 * Core Eventbrite Import Logic
 *
 * HTTP-independent logic for importing Eventbrite events.
 * Can be called from both manual import wizard and Trigger.dev jobs.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { addDays, format } from 'date-fns'
import {
  fetchEventbriteEvents,
  filterInPersonEvents,
  filterByDateRange,
  extractEventId,
  type EventbriteEvent,
} from '../scrapers/eventbrite/api'
import {
  transformEventbriteEvent,
  getAllVenueInfo,
} from '../scrapers/eventbrite/transformer'
import { categorizeEventsBatchWithStats } from '../scrapers/ai-categorizer'
import { generateEventEmbedding } from '@/shared/lib/ai/embeddings'
import { checkDuplicateEventsWithData } from '../api/duplicate-detection'
import { getBlocklistEntries } from '@/shared/lib/db/blocklist'
import { isBlockedByEntries } from '../scrapers/shared/blocklist-filter'
import { settleVenues, getVenueIdFromResults, type VenueSettlementInput } from './venue-settlement'
import { delay } from './nominatim'
import type { EventInsert } from '@/shared/lib/types'

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
export async function processEventbriteImport(
  client: SupabaseClient,
  options: EventbriteImportOptions = {}
): Promise<EventbriteImportResult> {
  const daysAhead = options.daysAhead ?? 30
  const startDate = options.startDate ?? format(new Date(), 'yyyy-MM-dd')
  const endDate = options.endDate ?? format(addDays(new Date(), daysAhead), 'yyyy-MM-dd')

  console.log(`[eventbrite] Starting import: ${startDate} to ${endDate}`)

  // Initialize result
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

  // Step 1: Fetch events
  console.log('[eventbrite] Fetching events from page...')
  const allEvents = await fetchEventbriteEvents()
  result.eventsFetched = allEvents.length
  console.log(`[eventbrite] Fetched ${allEvents.length} events`)

  // Step 2: Filter events
  console.log('[eventbrite] Filtering events...')
  const blocklistEntries = await getBlocklistEntries('eventbrite')
  const inPersonEvents = filterInPersonEvents(allEvents)
  const nonBlockedEvents = filterBlockedEvents(inPersonEvents, blocklistEntries)
  const filteredEvents = filterByDateRange(nonBlockedEvents, startDate, endDate)
  result.eventsFiltered = filteredEvents.length
  console.log(`[eventbrite] Filtered to ${filteredEvents.length} in-person events in date range`)

  if (filteredEvents.length === 0) {
    console.log('[eventbrite] No events to import')
    return result
  }

  // Step 3: Settle venues
  console.log('[eventbrite] Settling venues...')
  const venueInfoMap = getAllVenueInfo(filteredEvents)
  const venueInputs: VenueSettlementInput[] = Array.from(venueInfoMap.entries())
    .filter(([name]) => name) // Skip events without venues
    .map(([name, info]) => ({
      name,
      address: info.address,
      coordinates: info.latitude && info.longitude
        ? { lat: parseFloat(info.latitude), lng: parseFloat(info.longitude) }
        : null,
    }))

  const { results: venueResults, stats: venueStats } = await settleVenues(
    client,
    venueInputs,
    { source: 'eventbrite', scrapeRunId: options.scrapeRunId }
  )

  result.venuesMatched = venueStats.matched
  result.venuesAutoCreated = venueStats.autoCreated
  result.venuesQueuedReview = venueStats.queuedReview

  // Step 4: Check duplicates
  const externalIds = filteredEvents
    .map((e) => extractEventId(e.url))
    .filter((id): id is string => id !== null)
  const existingEventsMap = options.skipDuplicateCheck
    ? new Map()
    : await checkDuplicateEventsWithData(externalIds, 'eventbrite')

  // Step 5: Transform events with venue IDs
  console.log('[eventbrite] Transforming events...')
  const eventsToProcess: Array<{ event: EventbriteEvent; transformed: EventInsert; isUpdate: boolean }> = []

  for (const event of filteredEvents) {
    const venueName = event.location?.name || null
    const venueId = getVenueIdFromResults(venueResults, venueName)
    const transformed = transformEventbriteEvent(event, venueId)

    const externalId = extractEventId(event.url)
    const existing = externalId ? existingEventsMap.get(externalId) : undefined
    if (existing) {
      // Event exists - check if we should update
      eventsToProcess.push({ event, transformed, isUpdate: true })
    } else {
      // New event
      eventsToProcess.push({ event, transformed, isUpdate: false })
    }
  }

  // Step 6: Categorize events with AI
  console.log('[eventbrite] Categorizing events...')
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
  console.log('[eventbrite] Generating embeddings and upserting events...')
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
          })
          .eq('id', existing!.id)

        if (error) {
          console.error(`[eventbrite] Failed to update event: ${error.message}`)
          result.eventsSkipped++
        } else {
          result.eventsUpdated++
        }
      } else {
        // Insert new event
        const { error } = await client.from('events').insert(eventWithEmbedding)

        if (error) {
          console.error(`[eventbrite] Failed to insert event: ${error.message}`)
          result.eventsSkipped++
        } else {
          result.eventsInserted++
        }
      }

      // Rate limiting for embedding API
      await delay(100)
    } catch (error) {
      console.error(`[eventbrite] Error processing event ${transformed.name}:`, error)
      result.eventsSkipped++
    }
  }

  console.log(
    `[eventbrite] Import complete: ${result.eventsInserted} inserted, ${result.eventsUpdated} updated, ${result.eventsSkipped} skipped`
  )

  return result
}
