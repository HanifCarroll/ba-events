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
import { checkDuplicateEventsWithData } from '../api/duplicate-detection.ts'
import { getBlocklistEntries } from '#shared/lib/db/blocklist.ts'
import { isBlockedByEntries } from '../scrapers/shared/blocklist-filter.ts'
import { settleVenues, getVenueIdFromResults, isPlaceholderResult, type VenueSettlementInput } from './venue-settlement.ts'
import { delay } from './nominatim.ts'
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
  const blocklistEntries = await getBlocklistEntries('eventbrite', client)
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
    : await checkDuplicateEventsWithData(externalIds, 'eventbrite', client)

  // Step 5: Transform events with venue IDs
  console.log('[eventbrite] Transforming events...')
  const eventsToProcess: Array<{ event: EventbriteEvent; transformed: EventInsert; isUpdate: boolean }> = []

  for (const event of filteredEvents) {
    const venueName = event.location?.name || null
    const venueId = getVenueIdFromResults(venueResults, venueName)
    const transformed = transformEventbriteEvent(event, venueId)

    // Check if venue was detected as a placeholder (TBA)
    const isPlaceholder = isPlaceholderResult(venueResults, venueName)
    if (isPlaceholder) {
      transformed.location_tba = true
    }

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

  // Step 6: Enrich from detail pages (times, price, min_age)
  // The listing JSON-LD is date-only; real times/price/age come from each event page.
  console.log('[eventbrite] Enriching from detail pages (times, price, min_age)...')
  const detailTargets = eventsToProcess
    .map(({ event }) => {
      const id = extractEventId(event.url)
      return id ? { id, url: event.url } : null
    })
    .filter((t): t is { id: string; url: string } => t !== null)
  const detailMap = await fetchEventbriteDetailsBatch(detailTargets)

  for (const { event, transformed } of eventsToProcess) {
    const extId = extractEventId(event.url)
    const detail = extId ? detailMap.get(extId) : undefined
    if (!detail) continue

    if (detail.starts_at) {
      transformed.starts_at = detail.starts_at
      if (detail.ends_at) transformed.ends_at = detail.ends_at
      // Real times mean it is a timed event, not all-day
      transformed.is_all_day = false
      transformed.time_tba = false
    }
    if (detail.hasPrice) {
      transformed.is_free = detail.is_free
      transformed.price = detail.is_free ? 0 : detail.price
    }
    if (detail.min_age !== null) {
      transformed.min_age = detail.min_age
    }
    if (detail.image_url) {
      transformed.image_url = detail.image_url
      transformed.image_width = detail.image_width
      transformed.image_height = detail.image_height
    }
  }

  // Step 7: Categorize events with AI
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

  // Step 8: Generate embeddings and upsert
  console.log('[eventbrite] Generating embeddings and upserting events...')
  for (const { event, transformed, isUpdate } of eventsToProcess) {
    try {
      const presentationFields = await buildDescriptionPresentationFields({
        description_es: transformed.description_es,
        description_en: transformed.description_en,
      })

      // Generate embedding + search document together (they must not drift).
      // Eventbrite provides the venue name + address locality on the source
      // event, and they feed the canonical document alongside facets, price
      // and free/paid status.
      const eventbriteVenueName = event.location?.name ?? null
      const eventbriteNeighborhood = event.location?.address?.addressLocality ?? null
      const { embedding, searchDocument } = await embedEventWithDocument({
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
            is_all_day: eventWithEmbedding.is_all_day,
            time_tba: eventWithEmbedding.time_tba ?? false,
            venue_id: eventWithEmbedding.venue_id,
            categories: eventWithEmbedding.categories,
            price: eventWithEmbedding.price,
            is_free: eventWithEmbedding.is_free,
            min_age: eventWithEmbedding.min_age ?? null,
            image_url: eventWithEmbedding.image_url,
            image_width: eventWithEmbedding.image_width ?? null,
            image_height: eventWithEmbedding.image_height ?? null,
            embedding: eventWithEmbedding.embedding,
            search_document: eventWithEmbedding.search_document,
            embedding_version: eventWithEmbedding.embedding_version,
            location_tba: eventWithEmbedding.location_tba ?? false,
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
