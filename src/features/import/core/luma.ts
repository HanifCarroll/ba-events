/**
 * Core Luma Import Logic
 *
 * HTTP-independent logic for importing Luma events.
 * Can be called from both manual import wizard and Trigger.dev jobs.
 *
 * Note: Luma shows all upcoming events on their Buenos Aires page.
 * We import all visible events (no date range filter per user request).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchLumaEvents } from '../scrapers/luma/api.ts'
import type { LumaEvent } from '../scrapers/luma/types.ts'
import {
  transformLumaEvent,
  getAllVenueInfo,
} from '../scrapers/luma/transformer.ts'
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

export interface LumaImportOptions {
  /** Skip duplicate checking (for testing) */
  skipDuplicateCheck?: boolean
  /** Scrape run ID for audit trail */
  scrapeRunId?: string | null
}

export interface LumaImportResult {
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
  events: LumaEvent[],
  blocklistEntries: Awaited<ReturnType<typeof getBlocklistEntries>>
): LumaEvent[] {
  return events.filter((event) => {
    const venueName = event.venue?.name || ''
    return !isBlockedByEntries(event.name, venueName, blocklistEntries)
  })
}

// ============================================================================
// MAIN IMPORT FUNCTION
// ============================================================================

/**
 * Process a full Luma import.
 *
 * Steps:
 * 1. Fetch all events from Luma Buenos Aires page
 * 2. Apply blocklist filter
 * 3. Settle venues (match, auto-create, or queue for review)
 * 4. Check for duplicates
 * 5. Categorize events with AI
 * 6. Generate embeddings
 * 7. Upsert events to database
 */
export async function processLumaImport(
  client: SupabaseClient,
  options: LumaImportOptions = {}
): Promise<LumaImportResult> {
  console.log('[luma] Starting import (all visible events)')

  // Initialize result
  const result: LumaImportResult = {
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
  console.log('[luma] Fetching events from page...')
  const allEvents = await fetchLumaEvents()
  result.eventsFetched = allEvents.length
  console.log(`[luma] Fetched ${allEvents.length} events`)

  // Step 2: Filter events (blocklist only - no date range filter for Luma)
  console.log('[luma] Filtering events...')
  const blocklistEntries = await getBlocklistEntries('luma', client)
  const filteredEvents = filterBlockedEvents(allEvents, blocklistEntries)
  result.eventsFiltered = filteredEvents.length
  console.log(`[luma] Filtered to ${filteredEvents.length} events after blocklist`)

  if (filteredEvents.length === 0) {
    console.log('[luma] No events to import')
    return result
  }

  // Step 3: Settle venues
  console.log('[luma] Settling venues...')
  const venueInfoMap = getAllVenueInfo(filteredEvents)
  const venueInputs: VenueSettlementInput[] = Array.from(venueInfoMap.entries())
    .filter(([name]) => name) // Skip events without venues
    .map(([name, info]) => ({
      name,
      address: info.address,
      coordinates: info.latitude && info.longitude
        ? { lat: info.latitude, lng: info.longitude }
        : null,
    }))

  const { results: venueResults, stats: venueStats } = await settleVenues(
    client,
    venueInputs,
    { source: 'luma', scrapeRunId: options.scrapeRunId }
  )

  result.venuesMatched = venueStats.matched
  result.venuesAutoCreated = venueStats.autoCreated
  result.venuesQueuedReview = venueStats.queuedReview

  // Step 4: Check duplicates
  const externalIds = filteredEvents
    .map((e) => e.api_id)
    .filter((id): id is string => id !== null)
  const existingEventsMap = options.skipDuplicateCheck
    ? new Map()
    : await checkDuplicateEventsWithData(externalIds, 'luma', client)

  // Step 5: Transform events with venue IDs
  console.log('[luma] Transforming events...')
  const eventsToProcess: Array<{
    event: LumaEvent
    transformed: EventInsert
    existing?: ExistingEventData
    updateKind?: ScraperUpdateKind
  }> = []

  for (const event of filteredEvents) {
    const venueName = event.venue?.name || null
    const venueId = getVenueIdFromResults(venueResults, venueName)
    const transformed = transformLumaEvent(event, venueId)

    // Check if venue was detected as a placeholder (e.g., "Register to See Address")
    const locationHidden = isPlaceholderResult(venueResults, venueName)
    if (locationHidden) {
      ;(transformed as EventInsert & { location_hidden?: boolean }).location_hidden = true
    }

    const existing = existingEventsMap.get(event.api_id)
    if (existing) {
      transformed.description_es = existing.description_es
      transformed.description_en = existing.description_en
      transformed.categories = existing.categories
      transformed.facets = existing.facets
    }
    eventsToProcess.push({
      event,
      transformed,
      existing,
      updateKind: existing ? classifyScraperUpdate(transformed, existing, CURRENT_EMBEDDING_VERSION) : undefined,
    })
  }

  // Step 6: Categorize events with AI
  console.log('[luma] Categorizing events...')
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
  console.log('[luma] Generating embeddings and upserting events...')
  for (const { event, transformed, existing, updateKind } of eventsToProcess) {
    if (existing && updateKind === 'unchanged') continue

    try {
      if (existing && updateKind === 'mutable-only') {
        const { error } = await client
          .from('events')
          .update(getChangedMutableFields(transformed, existing))
          .eq('id', existing.id)
        if (error) {
          console.error(`[luma] Failed to update event: ${error.message}`)
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
      // Luma provides the venue name + city on the source event, and they feed
      // the canonical document alongside facets, price and free/paid status.
      const { embedding, searchDocument } = await embedEventWithDocument({
        name: transformed.name,
        description_es: transformed.description_es,
        description_en: transformed.description_en,
        categories: transformed.categories,
        price: transformed.price,
        is_free: transformed.is_free,
        facets: transformed.facets,
        venue_name: event.venue?.name ?? null,
        venue_neighborhood: event.venue?.city ?? null,
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
            price: eventWithEmbedding.price,
            is_free: eventWithEmbedding.is_free,
            embedding: eventWithEmbedding.embedding,
            search_document: eventWithEmbedding.search_document,
            embedding_version: eventWithEmbedding.embedding_version,
            ...getChangedMutableFields(eventWithEmbedding, existing),
          })
          .eq('id', existing.id)

        if (error) {
          console.error(`[luma] Failed to update event: ${error.message}`)
          result.eventsSkipped++
        } else {
          result.eventsUpdated++
        }
      } else {
        // Insert new event
        const { error } = await client.from('events').insert(eventWithEmbedding)

        if (error) {
          console.error(`[luma] Failed to insert event: ${error.message}`)
          result.eventsSkipped++
        } else {
          result.eventsInserted++
        }
      }

      // Rate limiting for embedding API
      await delay(100)
    } catch (error) {
      console.error(`[luma] Error processing event ${transformed.name}:`, error)
      result.eventsSkipped++
    }
  }

  console.log(
    `[luma] Import complete: ${result.eventsInserted} inserted, ${result.eventsUpdated} updated, ${result.eventsSkipped} skipped`
  )

  return result
}
