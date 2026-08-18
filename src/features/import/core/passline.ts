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
} from '../scrapers/passline/api.ts'
import { fetchPasslineEventsWithBrowserbase } from '../scrapers/passline/browser-scraper.ts'
import { isBrowserbaseAvailable } from '#shared/lib/browser/browserbase.ts'
import { transformPasslineEvent } from '../scrapers/passline/transformer.ts'
import { categorizeEventsBatchWithStats } from '../scrapers/ai-categorizer.ts'
import {
  embedEventWithDocument,
  CURRENT_EMBEDDING_VERSION,
} from '#shared/lib/ai/embeddings.ts'
import { getBlocklistEntries } from '#shared/lib/db/blocklist.ts'
import {
  settleVenues,
  getVenueIdFromResults,
  getVenueNeighborhoodFromResults,
  isPlaceholderResult,
  type VenueSettlementInput,
  type VenueSettlementResult,
} from './venue-settlement.ts'
import { delay } from './nominatim.ts'
import type { EventInsert, Category } from '#shared/lib/types.ts'
import { EMPTY_FACETS } from '#shared/lib/search-facets.ts'
import {
  classifyPasslineEvent,
  type ExistingPasslineEvent,
  type PasslineClassification,
  type VenueSettlement,
} from './passline-classify.ts'
import { fetchExistingPasslineEvents } from './passline-existing.ts'
import { logger } from '#shared/lib/logger.ts'

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
  eventsUnchanged: number

  // Venue stats
  venuesMatched: number
  venuesAutoCreated: number
  venuesQueuedReview: number

  // Categorization stats
  categorizationSuccessful: number
  categorizationFallback: number
}

// ============================================================================
// BATCH PROCESSING
// ============================================================================

// In-process batch size: keeps memory + AI fan-out bounded and writes progress.
const BATCH_SIZE = 20

interface PasslineItem {
  event: PasslineEvent
  transformed: EventInsert
  venueSettlement: VenueSettlement
  existing?: ExistingPasslineEvent
  classification: PasslineClassification
  category: Category | null
}

/** Fields written on every existing-event update (scrape-owned, non-enrichment). */
function scrapeUpdateFields(t: EventInsert) {
  return {
    starts_at: t.starts_at,
    ends_at: t.ends_at,
    is_all_day: t.is_all_day ?? false,
    time_tba: t.time_tba ?? false,
    ticket_url: t.ticket_url,
    location_tba: t.location_tba ?? false,
    image_url: t.image_url,
    link: t.link,
    price: t.price,
    is_free: t.is_free,
  }
}

/**
 * Process a single event. Returns true when an embedding call was made, so the
 * caller can rate-limit only those paths.
 */
async function processPasslineItem(
  client: SupabaseClient,
  item: PasslineItem,
  venueResults: Map<string, VenueSettlementResult>,
  result: PasslineImportResult
): Promise<boolean> {
  const { event, transformed, existing, venueSettlement, classification } = item
  const venueNeighborhood = getVenueNeighborhoodFromResults(venueResults, event.lugar)

  if (classification.kind === 'unchanged') {
    result.eventsUnchanged++
    return false
  }

  if (classification.kind === 'new') {
    const { embedding, searchDocument } = await embedEventWithDocument({
      name: transformed.name,
      description_es: transformed.description_es,
      description_en: transformed.description_en,
      categories: transformed.categories,
      price: transformed.price,
      is_free: transformed.is_free,
      facets: EMPTY_FACETS,
      venue_name: event.lugar || null,
      venue_neighborhood: venueNeighborhood,
    })

    const { error } = await client.from('events').insert({
      ...transformed,
      embedding,
      search_document: searchDocument,
      embedding_version: CURRENT_EMBEDDING_VERSION,
      enrichment_status: 'pending' as const,
    })

    if (error) {
      logger.error('[passline] Failed to insert event', { error: error.message })
      result.eventsSkipped++
    } else {
      result.eventsInserted++
    }
    return true
  }

  // Existing event — classification is one of mutable-only | name-changed | search-input-changed.
  // A resolved settlement writes the new venue id; an explicit placeholder clears
  // the venue; an unresolved settlement leaves the existing venue untouched.
  const venueUpdate =
    venueSettlement.kind === 'resolved'
      ? { venue_id: venueSettlement.venueId }
      : venueSettlement.kind === 'placeholder'
        ? { venue_id: null }
        : {}

  if (classification.kind === 'mutable-only') {
    const { error } = await client
      .from('events')
      .update({ ...scrapeUpdateFields(transformed), ...venueUpdate })
      .eq('id', existing!.id)

    if (error) {
      logger.error('[passline] Failed to update event', { error: error.message })
      result.eventsSkipped++
    } else {
      result.eventsUpdated++
    }
    return false
  }

  // name-changed | search-input-changed both re-embed using stored descriptions.
  const categories =
    classification.kind === 'name-changed'
      ? item.category
        ? [item.category]
        : existing!.categories
      : existing!.categories

  const { embedding, searchDocument } = await embedEventWithDocument({
    name: transformed.name,
    description_es: existing!.description_es,
    description_en: existing!.description_en,
    categories,
    price: transformed.price,
    is_free: transformed.is_free,
    facets: existing!.facets ?? EMPTY_FACETS,
    venue_name: event.lugar || null,
    venue_neighborhood: venueNeighborhood,
  })

  const { error } = await client
    .from('events')
    .update({
      ...scrapeUpdateFields(transformed),
      ...venueUpdate,
      ...(classification.kind === 'name-changed'
        ? { name: transformed.name, categories }
        : {}),
      embedding,
      search_document: searchDocument,
      embedding_version: CURRENT_EMBEDDING_VERSION,
    })
    .eq('id', existing!.id)

  if (error) {
    logger.error('[passline] Failed to update event', { error: error.message })
    result.eventsSkipped++
  } else {
    result.eventsUpdated++
  }
  return true
}

async function processPasslineBatch(
  client: SupabaseClient,
  batch: PasslineItem[],
  venueResults: Map<string, VenueSettlementResult>,
  result: PasslineImportResult
): Promise<void> {
  // Only new and name-changed events need AI categorization.
  const toCategorize = batch.filter(
    (item) => item.classification.kind === 'new' || item.classification.kind === 'name-changed'
  )

  if (toCategorize.length > 0) {
    const { categories, stats } = await categorizeEventsBatchWithStats(
      toCategorize.map((item) => ({
        name: item.transformed.name,
        description:
          item.classification.kind === 'name-changed'
            ? item.existing!.description_es
            : null,
      })),
      100 // 100ms delay between requests
    )

    result.categorizationSuccessful += stats.successful
    result.categorizationFallback += stats.fallback

    toCategorize.forEach((item, index) => {
      item.category = categories[index]
      item.transformed.categories = [categories[index]]
    })
  }

  for (const item of batch) {
    let didEmbed = false
    try {
      didEmbed = await processPasslineItem(client, item, venueResults, result)
    } catch (error) {
      logger.logError(`[passline] Error processing event ${item.transformed.name}`, error)
      result.eventsSkipped++
    }
    // Rate limiting for the embedding API — only after an embedding call.
    if (didEmbed) {
      await delay(100)
    }
  }
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
 * 4. Classify each event against its existing row (new / unchanged / mutable /
 *    name-changed / search-input-changed)
 * 5. Categorize + embed + write only what each classification needs, in bounded
 *    in-process batches written progressively.
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
    eventsUnchanged: 0,
    venuesMatched: 0,
    venuesAutoCreated: 0,
    venuesQueuedReview: 0,
    categorizationSuccessful: 0,
    categorizationFallback: 0,
  }

  // Step 1: Fetch events
  // Use Browserbase (cloud browser, residential proxy) when available to bypass
  // Passline's Cloudflare protection; otherwise fall back to plain HTTP (dev).
  logger.info('[passline] Fetching events from API')
  const fetchStart = performance.now()
  const allEvents = isBrowserbaseAvailable()
    ? await fetchPasslineEventsWithBrowserbase()
    : await fetchPasslineEvents()
  result.eventsFetched = allEvents.length
  logger.info('[passline] Fetch phase', {
    ms: Math.round(performance.now() - fetchStart),
    count: allEvents.length,
  })

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

  const venueStart = performance.now()
  const { results: venueResults, stats: venueStats } = await settleVenues(
    client,
    venueInputs,
    { source: 'passline', scrapeRunId: options.scrapeRunId }
  )
  logger.info('[passline] Venue settlement phase', {
    ms: Math.round(performance.now() - venueStart),
    ...venueStats,
  })

  result.venuesMatched = venueStats.matched
  result.venuesAutoCreated = venueStats.autoCreated
  result.venuesQueuedReview = venueStats.queuedReview

  // Step 4: Load existing rows and classify each event
  const classifyStart = performance.now()
  const externalIds = filteredEvents.map((e) => e.id)
  const existingEventsMap = options.skipDuplicateCheck
    ? new Map()
    : await fetchExistingPasslineEvents(client, externalIds)

  logger.info('[passline] Classifying events')
  const items: PasslineItem[] = []

  for (const event of filteredEvents) {
    const settledVenueId = getVenueIdFromResults(venueResults, event.lugar)
    const existing = existingEventsMap.get(event.id)

    const venueSettlement: VenueSettlement = settledVenueId !== null
      ? { kind: 'resolved', venueId: settledVenueId }
      : isPlaceholderResult(venueResults, event.lugar)
        ? { kind: 'placeholder' }
        : { kind: 'unresolved' }

    const transformed = transformPasslineEvent(event, settledVenueId)

    if (venueSettlement.kind === 'placeholder') {
      transformed.location_tba = true
    }

    const classification = existing
      ? classifyPasslineEvent(transformed, existing, venueSettlement)
      : ({ kind: 'new' } as const)

    items.push({
      event,
      transformed,
      venueSettlement,
      existing,
      classification,
      category: null,
    })
  }
  logger.info('[passline] Existing lookup + classification phase', {
    ms: Math.round(performance.now() - classifyStart),
    existing: existingEventsMap.size,
    total: items.length,
  })

  // Step 5: Process in bounded batches, writing progressively.
  logger.info('[passline] Processing events in batches', { total: items.length })
  const processStart = performance.now()
  for (let start = 0; start < items.length; start += BATCH_SIZE) {
    const batch = items.slice(start, start + BATCH_SIZE)
    await processPasslineBatch(client, batch, venueResults, result)
    logger.info('[passline] Batch processed', {
      offset: Math.min(start + BATCH_SIZE, items.length),
      total: items.length,
    })
  }
  logger.info('[passline] Processing phase', {
    ms: Math.round(performance.now() - processStart),
    total: items.length,
  })

  logger.info('[passline] Import complete', {
    inserted: result.eventsInserted,
    updated: result.eventsUpdated,
    skipped: result.eventsSkipped,
    unchanged: result.eventsUnchanged,
  })

  return result
}
