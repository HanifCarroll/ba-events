/**
 * Core Event Enrichment Logic
 *
 * Handles event description enrichment, venue extraction, and embedding generation
 * for automated scraping jobs. Uses existing AI functions from shared lib.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  enrichEventFull,
  extractVenueFromUrl,
  getKnownLanguageForSource,
  detectLanguage,
  translateText,
} from '@/shared/lib/ai/enrichment'
import { fetchMeetupDescriptionFromDetailPage } from '@/features/import/scrapers/meetup/description-enrichment'
import { fetchMeetupVenueFromUrl } from '@/features/import/scrapers/meetup/venue-enrichment'
import { generateEventEmbedding } from '@/shared/lib/ai/embeddings'
import { settleVenue, type VenueSettlementResult } from './venue-settlement'
import { delay } from './nominatim'

// ============================================================================
// TYPES
// ============================================================================

export interface EventEnrichmentInput {
  id: string
  name: string
  link: string | null
  source: string
  categories?: string[] | null
  venue_id?: string | null // Existing venue ID (if any)
}

export interface EventEnrichmentResult {
  eventId: string
  success: boolean
  enriched: boolean
  error?: string
  venueSettlement?: VenueSettlementResult // Info about venue extraction/settlement
}

export interface EnrichmentStats {
  total: number
  enriched: number
  skipped: number
  failed: number
  errors: Array<{ eventId: string; eventName: string; error: string }>
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Update event with enrichment data.
 */
async function updateEventEnrichment(
  client: SupabaseClient,
  eventId: string,
  data: {
    description_es?: string | null
    description_en?: string | null
    embedding?: number[] | null
    venue_id?: string | null
    enrichment_status: 'pending' | 'completed' | 'failed'
    enrichment_error?: string | null
    enriched_at?: string | null
  }
): Promise<void> {
  const { error } = await client
    .from('events')
    .update(data)
    .eq('id', eventId)

  if (error) {
    throw new Error(`Failed to update event: ${error.message}`)
  }
}

// ============================================================================
// MEETUP-SPECIFIC ENRICHMENT
// ============================================================================

/**
 * Enrich a Meetup event with description and venue.
 *
 * Meetup blocks Jina Reader (HTTP 451), so we use direct HTML fetch instead.
 * Description is extracted from __NEXT_DATA__ in the page HTML.
 */
async function enrichMeetupEvent(
  link: string,
  options?: { extractVenue?: boolean }
): Promise<{
  description_es: string | null
  description_en: string | null
  venue_name: string | null
} | null> {
  // Step 1: Fetch description from Meetup page
  const description = await fetchMeetupDescriptionFromDetailPage(link)

  if (!description) {
    console.log('[event-enrichment] No description found for Meetup event')
    return null
  }

  console.log(
    `[event-enrichment] Meetup description fetched (${description.length} chars)`
  )

  // Step 2: Detect language (Meetup can have Spanish or English descriptions)
  const detectedLang = await detectLanguage(description)
  console.log(`[event-enrichment] Detected language: ${detectedLang}`)

  // Step 3: Get both language versions
  let description_es: string | null = null
  let description_en: string | null = null

  if (detectedLang === 'spanish') {
    description_es = description
    description_en = await translateText(description, 'es-to-en')
  } else {
    description_en = description
    description_es = await translateText(description, 'en-to-es')
  }

  // Step 4: Extract venue if needed
  let venue_name: string | null = null
  if (options?.extractVenue) {
    try {
      const venueInfo = await fetchMeetupVenueFromUrl(link)
      venue_name = venueInfo?.name || null
      if (venue_name) {
        console.log(`[event-enrichment] Meetup venue extracted: ${venue_name}`)
      }
    } catch (error) {
      console.log(
        `[event-enrichment] Failed to extract venue: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }

  return {
    description_es,
    description_en,
    venue_name,
  }
}

// ============================================================================
// SINGLE EVENT ENRICHMENT
// ============================================================================

/**
 * Enrich a single event with description, venue, and embedding.
 */
export async function enrichSingleEvent(
  client: SupabaseClient,
  input: EventEnrichmentInput
): Promise<EventEnrichmentResult> {
  const { id, name, link, source, categories, venue_id } = input

  // Skip events without links
  if (!link) {
    return {
      eventId: id,
      success: true,
      enriched: false,
      error: 'No link available',
    }
  }

  console.log(`[event-enrichment] Enriching: ${name}`)

  try {
    // Step 1: Fetch and extract bilingual descriptions + venue name
    const needsVenue = !venue_id

    // Route Meetup events to dedicated enrichment (Jina Reader returns 451 for Meetup)
    const enrichmentResult =
      source === 'meetup'
        ? await enrichMeetupEvent(link, { extractVenue: needsVenue })
        : await enrichEventFull(link, {
            knownLanguage: getKnownLanguageForSource(source),
            extractVenue: needsVenue,
          })

    if (!enrichmentResult || !enrichmentResult.description_es) {
      await updateEventEnrichment(client, id, {
        enrichment_status: 'failed',
        enrichment_error: 'Failed to extract description',
      })

      return {
        eventId: id,
        success: false,
        enriched: false,
        error: 'Failed to extract description',
      }
    }

    // Step 2: Settle venue if needed and we extracted a venue name
    let venueSettlement: VenueSettlementResult | undefined
    let settledVenueId: string | null = null

    if (needsVenue && enrichmentResult.venue_name) {
      console.log(`[event-enrichment] Settling venue: ${enrichmentResult.venue_name}`)
      venueSettlement = await settleVenue(client, {
        name: enrichmentResult.venue_name,
      }, {
        source,
        eventIds: [id],
      })
      settledVenueId = venueSettlement.venueId
      console.log(`[event-enrichment] Venue settled: ${venueSettlement.action} (${venueSettlement.venueId})`)
    }

    // Step 3: Generate embedding with new Spanish description
    const embedding = await generateEventEmbedding({
      name,
      description_es: enrichmentResult.description_es,
      categories: categories || null,
    })

    // Step 4: Update event with all enrichment data
    const updateData: Parameters<typeof updateEventEnrichment>[2] = {
      description_es: enrichmentResult.description_es,
      description_en: enrichmentResult.description_en,
      embedding,
      enrichment_status: 'completed',
      enrichment_error: null,
      enriched_at: new Date().toISOString(),
    }

    // Only update venue_id if we settled a venue
    if (settledVenueId) {
      updateData.venue_id = settledVenueId
    }

    await updateEventEnrichment(client, id, updateData)

    console.log(`[event-enrichment] Enriched: ${name}${settledVenueId ? ` (venue: ${enrichmentResult.venue_name})` : ''}`)

    return {
      eventId: id,
      success: true,
      enriched: true,
      venueSettlement,
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error'
    console.error(`[event-enrichment] Failed to enrich ${name}:`, errorMsg)

    await updateEventEnrichment(client, id, {
      enrichment_status: 'failed',
      enrichment_error: errorMsg,
    })

    return {
      eventId: id,
      success: false,
      enriched: false,
      error: errorMsg,
    }
  }
}

// ============================================================================
// BATCH ENRICHMENT
// ============================================================================

interface BatchEnrichmentOptions {
  delayMs?: number
  onProgress?: (current: number, total: number, result: EventEnrichmentResult) => void
}

type EnrichmentHandler = (
  client: SupabaseClient,
  input: EventEnrichmentInput
) => Promise<EventEnrichmentResult>

/**
 * Generic batch processor for event enrichment.
 * Handles rate limiting, progress tracking, and stats collection.
 */
async function processBatch(
  client: SupabaseClient,
  events: EventEnrichmentInput[],
  handler: EnrichmentHandler,
  logPrefix: string,
  options?: BatchEnrichmentOptions
): Promise<EnrichmentStats> {
  const delayMs = options?.delayMs ?? 1000

  const stats: EnrichmentStats = {
    total: events.length,
    enriched: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  }

  console.log(`[event-enrichment] Starting ${logPrefix} for ${events.length} events`)

  for (let i = 0; i < events.length; i++) {
    const event = events[i]
    const result = await handler(client, event)

    // Update stats
    if (result.enriched) {
      stats.enriched++
    } else if (result.success) {
      stats.skipped++
    } else {
      stats.failed++
      if (result.error) {
        stats.errors.push({
          eventId: result.eventId,
          eventName: event.name,
          error: result.error,
        })
      }
    }

    options?.onProgress?.(i + 1, events.length, result)

    // Rate limiting (except for last item)
    if (i < events.length - 1) {
      await delay(delayMs)
    }
  }

  console.log(
    `[event-enrichment] ${logPrefix} completed: ${stats.enriched} enriched, ${stats.skipped} skipped, ${stats.failed} failed`
  )

  return stats
}

/**
 * Enrich multiple events with rate limiting.
 * Processes sequentially with 1 second delay between requests.
 */
export function enrichEvents(
  client: SupabaseClient,
  events: EventEnrichmentInput[],
  options?: BatchEnrichmentOptions
): Promise<EnrichmentStats> {
  return processBatch(client, events, enrichSingleEvent, 'batch enrichment', options)
}

// ============================================================================
// QUERY FUNCTIONS
// ============================================================================

/**
 * Get events that need enrichment (pending status, have link).
 */
export async function getEventsNeedingEnrichment(
  client: SupabaseClient,
  options?: {
    source?: string
    limit?: number
    createdAfter?: string
  }
): Promise<EventEnrichmentInput[]> {
  let query = client
    .from('events')
    .select('id, name, link, source, categories, venue_id')
    .eq('enrichment_status', 'pending')
    .not('link', 'is', null)
    .order('starts_at', { ascending: true })

  if (options?.source) {
    query = query.eq('source', options.source)
  }

  if (options?.createdAfter) {
    query = query.gte('created_at', options.createdAfter)
  }

  if (options?.limit) {
    query = query.limit(options.limit)
  } else {
    query = query.limit(100) // Default limit
  }

  const { data, error } = await query

  if (error) {
    console.error('[event-enrichment] Failed to get events needing enrichment:', error)
    return []
  }

  return (data || []) as EventEnrichmentInput[]
}

/**
 * Get count of events needing enrichment by source.
 */
export async function getEnrichmentPendingCounts(
  client: SupabaseClient
): Promise<Record<string, number>> {
  const { data, error } = await client
    .from('events')
    .select('source')
    .eq('enrichment_status', 'pending')
    .not('link', 'is', null)

  if (error) {
    console.error('[event-enrichment] Failed to get pending counts:', error)
    return {}
  }

  // Count by source
  const counts: Record<string, number> = {}
  for (const event of data || []) {
    const source = event.source || 'unknown'
    counts[source] = (counts[source] || 0) + 1
  }

  return counts
}

// ============================================================================
// VENUE-ONLY ENRICHMENT
// ============================================================================

/**
 * Enrich a single event with only venue extraction (for events that already have descriptions).
 */
export async function enrichEventVenueOnly(
  client: SupabaseClient,
  input: EventEnrichmentInput
): Promise<EventEnrichmentResult> {
  const { id, name, link, source, venue_id } = input

  // Skip events without links or that already have venues
  if (!link) {
    return {
      eventId: id,
      success: true,
      enriched: false,
      error: 'No link available',
    }
  }

  if (venue_id) {
    return {
      eventId: id,
      success: true,
      enriched: false,
      error: 'Already has venue',
    }
  }

  console.log(`[event-enrichment] Extracting venue for: ${name}`)

  try {
    // Step 1: Extract venue name from page
    const venueName = await extractVenueFromUrl(link)

    if (!venueName) {
      console.log(`[event-enrichment] No venue found for: ${name}`)
      return {
        eventId: id,
        success: true,
        enriched: false,
        error: 'No venue found on page',
      }
    }

    // Step 2: Settle venue
    console.log(`[event-enrichment] Settling venue: ${venueName}`)
    const venueSettlement = await settleVenue(client, {
      name: venueName,
    }, {
      source,
      eventIds: [id],
    })

    if (!venueSettlement.venueId) {
      console.log(`[event-enrichment] Venue settlement returned no ID for: ${name}`)
      return {
        eventId: id,
        success: true,
        enriched: false,
        error: 'Venue settlement failed',
        venueSettlement,
      }
    }

    // Step 3: Update event with venue
    const { error } = await client
      .from('events')
      .update({ venue_id: venueSettlement.venueId })
      .eq('id', id)

    if (error) {
      throw new Error(`Failed to update event: ${error.message}`)
    }

    console.log(`[event-enrichment] Added venue to: ${name} (${venueName})`)

    return {
      eventId: id,
      success: true,
      enriched: true,
      venueSettlement,
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error'
    console.error(`[event-enrichment] Failed venue enrichment for ${name}:`, errorMsg)

    return {
      eventId: id,
      success: false,
      enriched: false,
      error: errorMsg,
    }
  }
}

/**
 * Get events that have descriptions but are missing venues.
 */
export async function getEventsNeedingVenueOnly(
  client: SupabaseClient,
  options?: {
    limit?: number
  }
): Promise<EventEnrichmentInput[]> {
  let query = client
    .from('events')
    .select('id, name, link, source, categories, venue_id')
    .eq('enrichment_status', 'completed')
    .is('venue_id', null)
    .not('link', 'is', null)
    .order('starts_at', { ascending: true })

  if (options?.limit) {
    query = query.limit(options.limit)
  } else {
    query = query.limit(100)
  }

  const { data, error } = await query

  if (error) {
    console.error('[event-enrichment] Failed to get events needing venue:', error)
    return []
  }

  return (data || []) as EventEnrichmentInput[]
}

/**
 * Enrich multiple events with venue only.
 */
export function enrichEventsVenueOnly(
  client: SupabaseClient,
  events: EventEnrichmentInput[],
  options?: BatchEnrichmentOptions
): Promise<EnrichmentStats> {
  return processBatch(client, events, enrichEventVenueOnly, 'venue-only enrichment', options)
}
