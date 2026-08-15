/**
 * Core Event Enrichment Logic
 *
 * Handles event description enrichment, venue extraction, and embedding generation
 * for automated scraping jobs. Uses existing AI functions from shared lib.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Neighborhood } from '#shared/lib/types.ts'
import {
  enrichEventFull,
  extractVenueFromUrl,
  detectLanguage,
  translateText,
} from '#shared/lib/ai/enrichment.ts'
import { HttpError } from '#shared/lib/errors.ts'
import { getEnrichmentAdapter } from '#features/import/adapters/enrichment/registry.ts'
import { hasServerEnrichment, EnrichmentSkippedError } from '#features/import/adapters/enrichment-types.ts'
import type { ImportSource } from '#features/import/adapters/types.ts'
import {
  embedEventWithDocument,
  CURRENT_EMBEDDING_VERSION,
} from '#shared/lib/ai/embeddings.ts'
import { extractEventFacets } from '#shared/lib/ai/extract-facets.ts'
import { isEmptyFacets, type EventFacets } from '#shared/lib/search-facets.ts'
import { buildDescriptionPresentationFields } from '#features/events/lib/description-presentation.server.ts'
import { settleVenue, type VenueSettlementResult } from './venue-settlement.ts'
import { delay } from './nominatim.ts'

// ============================================================================
// QUEUE SELECTION FILTERS
// ============================================================================

/**
 * Catch-up only selects events that have not started yet.
 * `now` is injectable so tests can pin the boundary.
 */
export function enrichmentStartsAtFloor(now: Date = new Date()): string {
  return now.toISOString()
}

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
  description_es?: string | null // Existing Spanish description (translate-only fast path)
  description_en?: string | null // Existing English description (skip if already present)
  enrichment_status?: 'pending' | 'completed' | 'failed' | 'skipped' | null // Used to route the facets-only path
  embedding?: number[] | null // Existing embedding (facets-only path rewrites it only when facets are non-empty)
  price?: number | null // Existing price — embedded into the search document
  is_free?: boolean // Existing free/paid flag — embedded into the search document
}

export interface EventEnrichmentResult {
  eventId: string
  success: boolean
  enriched: boolean
  canceled?: boolean // Event page returned 404 - event marked as canceled
  error?: string
  venueSettlement?: VenueSettlementResult // Info about venue extraction/settlement
}

export interface EnrichmentStats {
  total: number
  enriched: number
  skipped: number
  failed: number
  canceled: number // Events whose pages returned 404 - marked as canceled
  errors: Array<{ eventId: string; eventName: string; error: string }>
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Resolve an existing venue's name + neighborhood by id, so an already-settled
 * venue feeds the canonical search document even when no new settlement happens
 * during this enrichment pass (e.g. sources that ship a venue_id at import).
 */
async function getVenueNameAndNeighborhood(
  client: SupabaseClient,
  venueId: string
): Promise<{ name: string | null; neighborhood: Neighborhood | null }> {
  const { data, error } = await client
    .from('venues')
    .select('name, neighborhood')
    .eq('id', venueId)
    .maybeSingle()

  if (error) {
    console.error(`[event-enrichment] Failed to fetch venue ${venueId}:`, error)
    return { name: null, neighborhood: null }
  }

  return {
    name: data?.name ?? null,
    neighborhood: (data?.neighborhood as Neighborhood | null) ?? null,
  }
}

/**
 * Update event with enrichment data.
 */
async function updateEventEnrichment(
  client: SupabaseClient,
  eventId: string,
  data: {
    description_es?: string | null
    description_en?: string | null
    description_display_es?: string | null
    description_display_en?: string | null
    description_summary_es?: string | null
    description_summary_en?: string | null
    embedding?: number[] | null
    search_document?: string | null
    embedding_version?: number
    venue_id?: string | null
    facets?: EventFacets
    enrichment_status?: 'pending' | 'completed' | 'failed' | 'skipped'
    enrichment_error?: string | null
    enriched_at?: string | null
    status?: 'scheduled' | 'canceled' | 'postponed' | 'past' | 'pending_review'
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
// SINGLE EVENT ENRICHMENT
// ============================================================================

/**
 * Injectable dependency for structured-facet extraction, so tests can
 * supply a fake without mocking the whole extract-facets module (whose mock
 * registry leaks across files in a shared vitest process). Defaults to the
 * real implementation.
 */
export type ExtractFacetsFn = (
  input: {
    name: string
    description_es: string | null
    description_en?: string | null
    categories?: string[] | null
  }
) => Promise<import('#shared/lib/search-facets.ts').EventFacets>

export interface EnrichSingleEventOptions {
  extractFacets?: ExtractFacetsFn
}

/**
 * Enrich a single event with description, venue, and embedding.
 */
export async function enrichSingleEvent(
  client: SupabaseClient,
  input: EventEnrichmentInput,
  options: EnrichSingleEventOptions = {}
): Promise<EventEnrichmentResult> {
  const { id, name, link, source, categories, venue_id, price, is_free } = input
  const extractFacets = options.extractFacets ?? extractEventFacets

  // Skip events without links
  if (!link) {
    return {
      eventId: id,
      success: true,
      enriched: false,
      error: 'No link available',
    }
  }

  // FACETS-ONLY PATH (Phase 5): a previously-completed event that only needs
  // its empty `facets = {}` backfilled already has enriching descriptions. We
  // extract facets and update `facets` without rewriting descriptions. Empty
  // facets stay a facets-only write; non-empty facets re-embed the canonical
  // search document so the newly-extracted vibe tags are searchable.
  const alreadyEnriched =
    input.enrichment_status === 'completed' ||
    // Row was enriched but the status is missing/ambiguous; a present embedding
    // is the ground-truth sign that it already went through full enrichment.
    (Array.isArray(input.embedding) && input.embedding.length > 0)
  if (input.description_es && alreadyEnriched) {
    console.log(`[event-enrichment] Backfilling facets only for: ${name}`)
    const facets = await extractFacets({
      name,
      description_es: input.description_es,
      description_en: input.description_en,
      categories,
    })

    if (isEmptyFacets(facets)) {
      // No signal to embed: keep the facets-only write (no re-embed).
      await updateEventEnrichment(client, id, {
        facets,
      })
    } else {
      // Non-empty facets carry searchable vibe tags. Rebuild the search
      // document + embedding with the same canonical builder as the full path
      // so those tags become visible to semantic/lexical search.
      let venueName: string | null = null
      let venueNeighborhood: Neighborhood | null = null
      if (venue_id) {
        const existingVenue = await getVenueNameAndNeighborhood(client, venue_id)
        venueName = existingVenue.name
        venueNeighborhood = existingVenue.neighborhood
      }

      const { embedding, searchDocument } = await embedEventWithDocument({
        name,
        description_es: input.description_es,
        description_en: input.description_en,
        categories: categories || null,
        facets,
        price: price ?? null,
        is_free,
        venue_name: venueName ?? null,
        venue_neighborhood: venueNeighborhood ?? null,
      })

      await updateEventEnrichment(client, id, {
        facets,
        embedding,
        search_document: searchDocument,
        embedding_version: CURRENT_EMBEDDING_VERSION,
      })
    }

    return {
      eventId: id,
      success: true,
      enriched: true,
    }
  }

  console.log(`[event-enrichment] Enriching: ${name}`)

  try {
    // Step 1: Get enrichment adapter for this source
    const adapter = getEnrichmentAdapter(source as ImportSource)
    const needsVenue = !venue_id

    // Sources that require client-side enrichment and have no server-side
    // fallback are permanently ineligible for this server job. Mark them
    // `skipped` (terminal) instead of `failed` so catch-up stops reselecting
    // them. If the adapter implements `serverEnrich`, fall through and use it.
    if (adapter?.config.requiresClientSide && !adapter.serverEnrich) {
      await updateEventEnrichment(client, id, {
        enrichment_status: 'skipped',
        enrichment_error: `${source} requires client-side extraction`,
      })

      return {
        eventId: id,
        success: true,
        enriched: false,
      }
    }

    // Step 2: Fetch and extract bilingual descriptions + venue name
    // Use adapter's serverEnrich if available, otherwise fall back to generic enrichment
    let enrichmentResult: {
      description_es: string | null
      description_en: string | null
      venue_name: string | null
    } | null = null

    // Fast path: the event already has a Spanish description (sources that ship
    // descriptions natively — BA Tourism, Eventbrite, Venti — plus any
    // previously-enriched row being re-queued to backfill empty facets). Reuse
    // the stored description instead of re-scraping the source page, translating
    // es -> en only if the English side is missing. Avoids redundant Jina
    // fetches and works for SPA pages (e.g. Venti) that Jina cannot parse.
    // Skips venue extraction (venues are settled at import for these sources).
    if (input.description_es) {
      console.log(`[event-enrichment] Reusing stored Spanish description for ${name}`)
      enrichmentResult = {
        description_es: input.description_es,
        description_en: input.description_en
          ? input.description_en
          : await translateText(input.description_es, 'es-to-en'),
        venue_name: null,
      }
    } else if (adapter && hasServerEnrichment(adapter)) {
      console.log(`[event-enrichment] Using adapter for ${source}`)
      enrichmentResult = await adapter.serverEnrich(link, { extractVenue: needsVenue })

      // Handle adapters that return description_en when language is unknown
      // Detect language and remap if Spanish
      if (enrichmentResult?.description_en && !enrichmentResult.description_es) {
        const detectedLang = await detectLanguage(enrichmentResult.description_en)
        console.log(`[event-enrichment] Detected language: ${detectedLang}`)

        if (detectedLang === 'spanish') {
          enrichmentResult.description_es = enrichmentResult.description_en
          enrichmentResult.description_en = await translateText(
            enrichmentResult.description_es,
            'es-to-en'
          )
        } else {
          // It's English - translate to Spanish
          enrichmentResult.description_es = await translateText(
            enrichmentResult.description_en,
            'en-to-es'
          )
        }
      }
    } else {
      // Fallback to generic enrichment (for sources without adapters or missing serverEnrich)
      console.log(`[event-enrichment] Using generic enrichment for ${source}`)
      const knownLanguage = adapter?.config.knownLanguage === 'es' ? 'spanish' : undefined
      enrichmentResult = await enrichEventFull(link, {
        knownLanguage,
        extractVenue: needsVenue,
      })
    }

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

    // Step 3: Settle venue if needed and we extracted a venue name
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

    // Step 5: Extract structured facets from the now-available descriptions.
    // Only assigns keys the text supports; on failure extractEventFacets
    // returns {} and logs, so a single event never fails enrichment. Note the
    // order: facets are extracted BEFORE the embedding so the richer document
    // (which includes facets as readable phrases) is embedded once.
    const facets = await extractFacets({
      name,
      description_es: enrichmentResult.description_es,
      description_en: enrichmentResult.description_en,
      categories,
    })

    // Step 4: Generate embedding using the richer search document — Spanish +
    // English descriptions, facets, price/free status, and venue
    // name/neighborhood when known. The venue data comes from the settlement
    // when a venue was resolved here; else from the existing venue (resolved by
    // id from the venues table); else from the freshly-extracted venue name. The
    // exact text embedded is stored as `search_document` so the vector and
    // document can never drift apart.
    let venueName: string | null = null
    let venueNeighborhood: Neighborhood | null = null

    if (settledVenueId) {
      venueName = venueSettlement!.venueName
    } else if (venue_id) {
      const existingVenue = await getVenueNameAndNeighborhood(client, venue_id)
      venueName = existingVenue.name
      venueNeighborhood = existingVenue.neighborhood
    } else {
      venueName = enrichmentResult.venue_name ?? null
    }
    if (settledVenueId) {
      venueNeighborhood = venueSettlement!.neighborhood ?? null
    }

    const { embedding, searchDocument } = await embedEventWithDocument({
      name,
      description_es: enrichmentResult.description_es,
      description_en: enrichmentResult.description_en,
      categories: categories || null,
      facets,
      price: price ?? null,
      is_free,
      venue_name: venueName ?? null,
      venue_neighborhood: venueNeighborhood ?? null,
    })
    const presentationFields = await buildDescriptionPresentationFields({
      description_es: enrichmentResult.description_es,
      description_en: enrichmentResult.description_en,
    })

    // Step 6: Update event with all enrichment data
    const updateData: Parameters<typeof updateEventEnrichment>[2] = {
      description_es: enrichmentResult.description_es,
      description_en: enrichmentResult.description_en,
      ...presentationFields,
      embedding,
      search_document: searchDocument,
      embedding_version: CURRENT_EMBEDDING_VERSION,
      facets,
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
    // Permanently ineligible for the server job (client-side-only source,
    // Browserbase unavailable, Cloudflare challenge): terminal `skipped`.
    if (error instanceof EnrichmentSkippedError) {
      const errorMsg = error.message
      console.log(`[event-enrichment] Marking as skipped: ${name} (${errorMsg})`)

      await updateEventEnrichment(client, id, {
        enrichment_status: 'skipped',
        enrichment_error: errorMsg,
      })

      return {
        eventId: id,
        success: true,
        enriched: false,
        error: errorMsg,
      }
    }

    // Handle 404/410 errors by marking event as canceled (page no longer exists)
    if (error instanceof HttpError && error.isNotFound) {
      const errorMsg = `HTTP ${error.status} - Event page not found`
      console.log(`[event-enrichment] Event page gone (${error.status}), marking as canceled: ${name}`)

      await updateEventEnrichment(client, id, {
        status: 'canceled',
        enrichment_status: 'skipped',
        enrichment_error: errorMsg,
      })

      return {
        eventId: id,
        success: false,
        enriched: false,
        canceled: true,
        error: errorMsg,
      }
    }

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
  extractFacets?: ExtractFacetsFn
}

type EnrichmentHandler = (
  client: SupabaseClient,
  input: EventEnrichmentInput,
  options?: EnrichSingleEventOptions
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
  const enrichOptions = options?.extractFacets
    ? { extractFacets: options.extractFacets }
    : undefined

  const stats: EnrichmentStats = {
    total: events.length,
    enriched: 0,
    skipped: 0,
    failed: 0,
    canceled: 0,
    errors: [],
  }

  console.log(`[event-enrichment] Starting ${logPrefix} for ${events.length} events`)

  for (let i = 0; i < events.length; i++) {
    const event = events[i]
    const result = await handler(client, event, enrichOptions)

    // Update stats
    if (result.canceled) {
      stats.canceled++
    } else if (result.enriched) {
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
    `[event-enrichment] ${logPrefix} completed: ${stats.enriched} enriched, ${stats.skipped} skipped, ${stats.failed} failed, ${stats.canceled} canceled`
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
 * Get events that need enrichment: `pending` or `failed` rows with a link,
 * not canceled, and not already started (`starts_at >= now`).
 * `failed` stays retryable; `skipped`/`completed` are terminal for this job.
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
    .select(
      'id, name, link, source, categories, venue_id, description_es, description_en, facets, enrichment_status, embedding, price, is_free'
    )
    .in('enrichment_status', ['pending', 'failed'])
    .neq('status', 'canceled')
    .neq('status', 'past')
    .gte('starts_at', enrichmentStartsAtFloor())
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
  input: EventEnrichmentInput,
  _options?: EnrichSingleEventOptions
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
    // Handle 404/410 errors by marking event as canceled (page no longer exists)
    if (error instanceof HttpError && error.isNotFound) {
      const errorMsg = `HTTP ${error.status} - Event page not found`
      console.log(`[event-enrichment] Event page gone (${error.status}), marking as canceled: ${name}`)

      const { error: updateError } = await client
        .from('events')
        .update({
          status: 'canceled',
          enrichment_error: errorMsg,
        })
        .eq('id', id)

      if (updateError) {
        console.error(`[event-enrichment] Failed to mark event as canceled:`, updateError)
      }

      return {
        eventId: id,
        success: false,
        enriched: false,
        canceled: true,
        error: errorMsg,
      }
    }

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
