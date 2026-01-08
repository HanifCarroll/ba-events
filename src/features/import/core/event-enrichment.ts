/**
 * Core Event Enrichment Logic
 *
 * Handles event description enrichment and embedding generation
 * for automated scraping jobs. Uses existing AI functions from shared lib.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { enrichEventDescriptionBilingual } from '@/shared/lib/ai/enrichment'
import { generateEventEmbedding } from '@/shared/lib/ai/embeddings'
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
}

export interface EventEnrichmentResult {
  eventId: string
  success: boolean
  enriched: boolean
  error?: string
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
 * Get known language for a source.
 * Sources from Argentina are typically Spanish, others need detection.
 */
function getKnownLanguage(source: string): 'spanish' | 'english' | undefined {
  switch (source) {
    case 'passline':
    case 'ba-tourism':
      return 'spanish'
    default:
      return undefined // Auto-detect
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
    embedding?: number[] | null
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
// SINGLE EVENT ENRICHMENT
// ============================================================================

/**
 * Enrich a single event with description and embedding.
 */
export async function enrichSingleEvent(
  client: SupabaseClient,
  input: EventEnrichmentInput
): Promise<EventEnrichmentResult> {
  const { id, name, link, source, categories } = input

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
    // Step 1: Fetch and extract bilingual descriptions
    const knownLanguage = getKnownLanguage(source)
    const descriptions = await enrichEventDescriptionBilingual(link, knownLanguage)

    if (!descriptions || !descriptions.description_es) {
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

    // Step 2: Generate embedding with new Spanish description
    const embedding = await generateEventEmbedding({
      name,
      description_es: descriptions.description_es,
      categories: categories || null,
    })

    // Step 3: Update event
    await updateEventEnrichment(client, id, {
      description_es: descriptions.description_es,
      description_en: descriptions.description_en,
      embedding,
      enrichment_status: 'completed',
      enrichment_error: null,
      enriched_at: new Date().toISOString(),
    })

    console.log(`[event-enrichment] Enriched: ${name}`)

    return {
      eventId: id,
      success: true,
      enriched: true,
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

/**
 * Enrich multiple events with rate limiting.
 * Processes sequentially with 1 second delay between requests.
 */
export async function enrichEvents(
  client: SupabaseClient,
  events: EventEnrichmentInput[],
  options?: {
    delayMs?: number
    onProgress?: (current: number, total: number, result: EventEnrichmentResult) => void
  }
): Promise<EnrichmentStats> {
  const delayMs = options?.delayMs ?? 1000

  const stats: EnrichmentStats = {
    total: events.length,
    enriched: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  }

  console.log(`[event-enrichment] Starting batch enrichment for ${events.length} events`)

  for (let i = 0; i < events.length; i++) {
    const event = events[i]
    const result = await enrichSingleEvent(client, event)

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

    // Callback for progress tracking
    if (options?.onProgress) {
      options.onProgress(i + 1, events.length, result)
    }

    // Rate limiting (except for last item)
    if (i < events.length - 1) {
      await delay(delayMs)
    }
  }

  console.log(
    `[event-enrichment] Completed: ${stats.enriched} enriched, ${stats.skipped} skipped, ${stats.failed} failed`
  )

  return stats
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
    .select('id, name, link, source, categories')
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
