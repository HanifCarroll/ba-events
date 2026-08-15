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
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchVentiEvents, filterCABAEvents, fetchVentiAvailabilityBatch } from '../scrapers/venti/api'
import { transformVentiEvent, getAllVenueInfo, getVenueName } from '../scrapers/venti/transformer'
import type { VentiEvent } from '../scrapers/venti/types'
import { categorizeEventsBatchWithStats } from '../scrapers/ai-categorizer'
import {
  embedEventWithDocument,
  CURRENT_EMBEDDING_VERSION,
} from '@/shared/lib/ai/embeddings'
import { buildDescriptionPresentationFields } from '@/features/events/lib/description-presentation.server'
import { checkDuplicateEventsWithData } from '../api/duplicate-detection'
import { getBlocklistEntries } from '@/shared/lib/db/blocklist'
import { isBlockedByEntries } from '../scrapers/shared/blocklist-filter'
import { settleVenues, getVenueIdFromResults, getVenueNeighborhoodFromResults, type VenueSettlementInput } from './venue-settlement'
import { delay } from './nominatim'
import type { EventInsert, ImportBlocklistEntry } from '@/shared/lib/types'

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
export async function processVentiImport(
  client: SupabaseClient,
  options: VentiImportOptions = {}
): Promise<VentiImportResult> {
  console.log('[venti] Starting import')

  // Initialize result
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

  // Step 1: Fetch events
  console.log('[venti] Fetching events from catalog API...')
  const allEvents = await fetchVentiEvents()
  result.eventsFetched = allEvents.length
  console.log(`[venti] Fetched ${allEvents.length} events`)

  // Step 2: Filter to CABA + blocklist
  console.log('[venti] Filtering events...')
  const cabaEvents = filterCABAEvents(allEvents)
  const blocklistEntries = await getBlocklistEntries('venti')
  const filteredEvents = filterBlockedEvents(cabaEvents, blocklistEntries)
  result.eventsFiltered = filteredEvents.length
  console.log(
    `[venti] Filtered to ${filteredEvents.length} events (${cabaEvents.length} CABA, blocklist applied)`
  )

  if (filteredEvents.length === 0) {
    console.log('[venti] No events to import')
    return result
  }

  // Step 3: Fetch ticket availability (prices)
  console.log('[venti] Fetching ticket availability...')
  const availabilityMap = await fetchVentiAvailabilityBatch(filteredEvents)

  // Step 4: Settle venues
  console.log('[venti] Settling venues...')
  const venueInfoMap = getAllVenueInfo(filteredEvents)
  const venueInputs: VenueSettlementInput[] = Array.from(venueInfoMap.entries()).map(
    ([name, info]) => ({
      name,
      address: info.address,
      coordinates:
        info.latitude && info.longitude
          ? { lat: info.latitude, lng: info.longitude }
          : null,
    })
  )

  const { results: venueResults, stats: venueStats } = await settleVenues(
    client,
    venueInputs,
    { source: 'venti', scrapeRunId: options.scrapeRunId }
  )

  result.venuesMatched = venueStats.matched
  result.venuesAutoCreated = venueStats.autoCreated
  result.venuesQueuedReview = venueStats.queuedReview

  // Step 5: Check duplicates
  const externalIds = filteredEvents.map((e) => String(e.id))
  const existingEventsMap = options.skipDuplicateCheck
    ? new Map()
    : await checkDuplicateEventsWithData(externalIds, 'venti', client)

  // Step 6: Transform events with venue IDs
  console.log('[venti] Transforming events...')
  const eventsToProcess: Array<{ event: VentiEvent; transformed: EventInsert; isUpdate: boolean }> = []

  for (const event of filteredEvents) {
    const venueName = getVenueName(event)
    const venueId = getVenueIdFromResults(venueResults, venueName)
    const availability = availabilityMap.get(event.id) ?? null
    const transformed = transformVentiEvent(event, venueId, availability)

    const existing = existingEventsMap.get(String(event.id))
    eventsToProcess.push({ event, transformed, isUpdate: !!existing })
  }

  // Step 7: Categorize events missing a native category mapping
  // Venti provides category natively (party/concert/festival/gastronomy),
  // so the AI categorizer only runs for events with unknown categories.
  const uncategorized = eventsToProcess.filter(
    (e) => (e.transformed.categories ?? []).length === 0
  )

  if (uncategorized.length > 0) {
    console.log(`[venti] Categorizing ${uncategorized.length} events with unknown categories...`)
    const { categories, stats: catStats } = await categorizeEventsBatchWithStats(
      uncategorized.map((e) => ({
        name: e.transformed.name,
        description: e.transformed.description_es,
      })),
      1500 // 1.5s delay between requests (rate limit safety)
    )

    result.categorizationSuccessful = catStats.successful
    result.categorizationFallback = catStats.fallback

    for (let i = 0; i < uncategorized.length; i++) {
      uncategorized[i].transformed.categories = [categories[i]]
    }
  }

  // Step 8: Generate embeddings and upsert
  console.log('[venti] Generating embeddings and upserting events...')
  for (const { event, transformed, isUpdate } of eventsToProcess) {
    try {
      const presentationFields = await buildDescriptionPresentationFields({
        description_es: transformed.description_es,
        description_en: transformed.description_en,
      })

      // Generate embedding + search document together (they must not drift).
      // Venti provides the venue name on the source event; when the settlement
      // resolved a CABA neighborhood for that venue, prefer it so the canonical
      // document carries real neighborhood context.
      const { embedding, searchDocument } = await embedEventWithDocument({
        name: transformed.name,
        description_es: transformed.description_es,
        description_en: transformed.description_en,
        categories: transformed.categories,
        price: transformed.price,
        is_free: transformed.is_free,
        facets: transformed.facets,
        venue_name: getVenueName(event) ?? null,
        venue_neighborhood: getVenueNeighborhoodFromResults(venueResults, getVenueName(event)),
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
            venue_id: eventWithEmbedding.venue_id,
            categories: eventWithEmbedding.categories,
            price: eventWithEmbedding.price,
            is_free: eventWithEmbedding.is_free,
            image_url: eventWithEmbedding.image_url,
            embedding: eventWithEmbedding.embedding,
            search_document: eventWithEmbedding.search_document,
            embedding_version: eventWithEmbedding.embedding_version,
          })
          .eq('id', existing!.id)

        if (error) {
          console.error(`[venti] Failed to update event: ${error.message}`)
          result.eventsSkipped++
        } else {
          result.eventsUpdated++
        }
      } else {
        // Insert new event
        const { error } = await client.from('events').insert(eventWithEmbedding)

        if (error) {
          console.error(`[venti] Failed to insert event: ${error.message}`)
          result.eventsSkipped++
        } else {
          result.eventsInserted++
        }
      }

      // Rate limiting for embedding API
      await delay(100)
    } catch (error) {
      console.error(`[venti] Error processing event ${transformed.name}:`, error)
      result.eventsSkipped++
    }
  }

  console.log(
    `[venti] Import complete: ${result.eventsInserted} inserted, ${result.eventsUpdated} updated, ${result.eventsSkipped} skipped`
  )

  return result
}
