import { createServerFn } from '@tanstack/react-start'
import { getEventsWithVenues, getEventById, updateEvent, supabase } from '@/shared/lib/db/client'
import { generateEventEmbedding } from '@/shared/lib/ai/embeddings'
import {
  enrichEventDescriptionBilingual,
  getKnownLanguageForSource,
  translateText,
} from '@/shared/lib/ai/enrichment'
import { requireAdminAccess } from '@/shared/lib/admin-utils'
import { fetchPasslineDescription } from '@/features/import/scrapers/passline/description-enrichment'
import type { EventWithVenue } from '@/shared/lib/types'
import type {
  EmbeddingProgress,
  EmbeddingComplete,
  EmbeddingUpdate,
  DescriptionUpdateProgress,
  DescriptionUpdateComplete,
  DescriptionUpdateUpdate,
  DescriptionEnrichProgress,
  DescriptionEnrichComplete,
  DescriptionEnrichUpdate,
} from './streaming-types'

// Re-export streaming types for backwards compatibility
export type {
  EmbeddingProgress,
  EmbeddingComplete,
  EmbeddingUpdate,
  DescriptionUpdateProgress,
  DescriptionUpdateComplete,
  DescriptionUpdateUpdate,
  DescriptionEnrichProgress,
  DescriptionEnrichComplete,
  DescriptionEnrichUpdate,
}


/**
 * Process a single event enrichment
 * Returns result object with success/error info
 *
 * Note: Passline events are skipped - Cloudflare blocks server-side requests.
 * Use enrichPasslineDescriptionsAction for client-side extraction instead.
 */
async function enrichSingleEvent(
  id: string,
  link: string,
  source: string,
  client: Awaited<ReturnType<typeof requireAdminAccess>>
): Promise<{ id: string; success: boolean; error?: string; skipped?: boolean }> {
  console.log(`[server] Processing event ${id}: ${link} (source: ${source})`)

  // Skip Passline - Cloudflare blocks server-side requests (see decisions.md 2026-01-11)
  // Users should use the "Fetch Passline Descriptions" button which uses client-side extraction
  if (source === 'passline') {
    console.log(`[server] Skipping Passline event ${id} - use client-side extraction`)
    return { id, success: false, skipped: true, error: 'Passline requires client-side extraction' }
  }

  try {
    // Get known language for source, or undefined to trigger detection
    const knownLanguage = getKnownLanguageForSource(source)

    // Fetch and extract bilingual descriptions using Jina + Haiku
    const bilingual = await enrichEventDescriptionBilingual(link, knownLanguage)
    console.log(`[server] Got descriptions for ${id}: ES=${bilingual?.description_es ? 'yes' : 'no'}, EN=${bilingual?.description_en ? 'yes' : 'no'}`)

    if (!bilingual?.description_es) {
      await updateEvent(id, {
        enrichment_status: 'failed',
        enrichment_error: 'Failed to extract description',
      }, client)
      return { id, success: false, error: 'Failed to extract description' }
    }

    // Get existing event to merge with new description
    const existingEvent = await getEventById(id)

    // Generate new embedding with Spanish description
    const embedding = await generateEventEmbedding({
      name: existingEvent.name,
      description_es: bilingual.description_es,
      categories: existingEvent.categories,
    })

    // Update event with both descriptions, new embedding, and enrichment status
    await updateEvent(id, {
      description_es: bilingual.description_es,
      description_en: bilingual.description_en,
      embedding,
      enrichment_status: 'completed',
      enriched_at: new Date().toISOString(),
    }, client)

    return { id, success: true }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error'
    console.error(`Failed to enrich event ${id}:`, error)

    // Mark as failed with error message
    await updateEvent(id, {
      enrichment_status: 'failed',
      enrichment_error: errorMsg,
    }, client)

    return {
      id,
      success: false,
      error: errorMsg,
    }
  }
}

/**
 * Enrich event descriptions using Jina Reader + Haiku 4.5
 * Processes events sequentially to enable real-time progress streaming
 * Detects source language and translates appropriately
 * Uses async generator to stream progress updates to the client
 */
export const enrichEventDescriptionsAction = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: { events: Array<{ id: string; link: string; source: string; name?: string }> }) => data
  )
  .handler(async function* ({ data: { events } }): AsyncGenerator<DescriptionEnrichUpdate> {
    const client = await requireAdminAccess()
    console.log(`[server] enrichEventDescriptionsAction called with ${events.length} events (streaming)`)

    let enriched = 0
    const errors: Array<{ id: string; error: string }> = []

    for (let i = 0; i < events.length; i++) {
      const { id, link, source, name } = events[i]
      const eventName = name || 'Unknown'

      const result = await enrichSingleEvent(id, link, source, client)

      if (result.success) {
        enriched++
        yield {
          type: 'progress',
          current: i + 1,
          total: events.length,
          eventName,
          success: true,
        } as DescriptionEnrichProgress
      } else {
        errors.push({ id, error: result.error || 'Unknown error' })
        yield {
          type: 'progress',
          current: i + 1,
          total: events.length,
          eventName,
          success: false,
          error: result.error,
        } as DescriptionEnrichProgress
      }
    }

    // Yield final completion result
    yield {
      type: 'complete',
      enriched,
      total: events.length,
      errors: errors.length > 0 ? errors : undefined,
    } as DescriptionEnrichComplete
  })

/**
 * Get events that need enrichment (based on enrichment_status)
 */
export const getEventsWithoutDescriptions = createServerFn({ method: 'GET' }).handler(
  async (): Promise<EventWithVenue[]> => {
    const events = await getEventsWithVenues(1000)
    return events.filter((e) => e.enrichment_status === 'pending')
  }
)

/**
 * Regenerate embeddings for events using their current name/description
 * Use this when event names or descriptions have been manually corrected
 * and embeddings need to be updated to match
 * Uses async generator to stream progress updates to the client
 */
export const regenerateEmbeddingsAction = createServerFn({ method: 'POST' })
  .inputValidator((data: { eventIds: string[] }) => data)
  .handler(async function* ({ data: { eventIds } }): AsyncGenerator<EmbeddingUpdate> {
    const client = await requireAdminAccess()
    console.log(`[server] regenerateEmbeddingsAction called for ${eventIds.length} events`)

    let regenerated = 0
    const errors: Array<{ id: string; error: string }> = []

    for (let i = 0; i < eventIds.length; i++) {
      const id = eventIds[i]
      let eventName = 'Unknown'

      try {
        const event = await getEventById(id)
        eventName = event.name

        // Generate embedding from current event data
        const embedding = await generateEventEmbedding(event)

        await updateEvent(id, { embedding }, client)
        regenerated++
        console.log(`[server] Regenerated embedding for: ${event.name.substring(0, 50)}...`)

        // Yield progress update
        yield {
          type: 'progress',
          current: i + 1,
          total: eventIds.length,
          eventName,
          success: true,
        } as EmbeddingProgress
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error'
        console.error(`[server] Failed to regenerate embedding for ${id}:`, errorMsg)
        errors.push({ id, error: errorMsg })

        // Yield progress update for error
        yield {
          type: 'progress',
          current: i + 1,
          total: eventIds.length,
          eventName,
          success: false,
          error: errorMsg,
        } as EmbeddingProgress
      }
    }

    // Yield final completion result
    yield {
      type: 'complete',
      regenerated,
      total: eventIds.length,
      errors: errors.length > 0 ? errors : undefined,
    } as EmbeddingComplete
  })

/**
 * Update event descriptions in batch (bilingual)
 * Regenerates embeddings for each updated event using Spanish description
 * Uses async generator to stream progress updates to the client
 */
export const updateEventDescriptionsAction = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: { updates: Array<{ id: string; description_es: string; description_en: string }> }) => data
  )
  .handler(async function* ({ data: { updates } }): AsyncGenerator<DescriptionUpdateUpdate> {
    const client = await requireAdminAccess()
    let updated = 0

    for (let i = 0; i < updates.length; i++) {
      const { id, description_es, description_en } = updates[i]
      let eventName = 'Unknown'

      try {
        // Get existing event to merge with new description
        const existingEvent = await getEventById(id)
        eventName = existingEvent.name

        // Generate new embedding with Spanish description
        const embedding = await generateEventEmbedding({
          name: existingEvent.name,
          description_es,
          categories: existingEvent.categories,
        })

        // Update event with both descriptions and new embedding
        await updateEvent(id, {
          description_es,
          description_en,
          embedding,
        }, client)

        updated++

        // Yield progress update
        yield {
          type: 'progress',
          current: i + 1,
          total: updates.length,
          eventName,
          success: true,
        } as DescriptionUpdateProgress
      } catch (error) {
        console.error(`Failed to update description for event ${id}:`, error)

        // Yield progress update for error
        yield {
          type: 'progress',
          current: i + 1,
          total: updates.length,
          eventName,
          success: false,
        } as DescriptionUpdateProgress
      }
    }

    // Yield final completion result
    yield {
      type: 'complete',
      updated,
      total: updates.length,
    } as DescriptionUpdateComplete
  })

// ============================================================================
// PENDING QUERIES FOR AUTO-ENRICHMENT
// ============================================================================

/**
 * Get recently imported events that need enrichment.
 * Used to identify which events to auto-enrich after import completes.
 */
export const getRecentlyImportedPendingEventsAction = createServerFn({ method: 'POST' })
  .inputValidator((data: { source: string; importedAfter: string }) => data)
  .handler(async ({ data: { source, importedAfter } }) => {
    await requireAdminAccess()
    const { data: events, error } = await supabase
      .from('events')
      .select('id, name, link, source')
      .eq('source', source)
      .eq('enrichment_status', 'pending')
      .gte('created_at', importedAfter)
      .not('link', 'is', null)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('[enrichment] Failed to get recently imported pending events:', error)
      return []
    }

    return (events || []) as Array<{ id: string; name: string; link: string; source: string }>
  })

/**
 * Get counts of pending events and venues for backfill UI.
 */
export const getPendingEnrichmentCountsAction = createServerFn({ method: 'GET' }).handler(
  async () => {
    await requireAdminAccess()

    const [eventResult, venueResult] = await Promise.all([
      supabase
        .from('events')
        .select('*', { count: 'exact', head: true })
        .eq('enrichment_status', 'pending')
        .not('link', 'is', null),
      supabase
        .from('venues')
        .select('*', { count: 'exact', head: true })
        .eq('enrichment_status', 'pending'),
    ])

    return {
      pendingEvents: eventResult.count || 0,
      pendingVenues: venueResult.count || 0,
    }
  }
)

/**
 * Get all pending events for backfill enrichment.
 */
export const getAllPendingEventsAction = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAdminAccess()
  const { data: events, error } = await supabase
    .from('events')
    .select('id, name, link, source')
    .eq('enrichment_status', 'pending')
    .not('link', 'is', null)
    .order('starts_at', { ascending: true }) // Prioritize upcoming events
    .limit(500) // Reasonable batch size

  if (error) {
    console.error('[enrichment] Failed to get all pending events:', error)
    return []
  }

  return (events || []) as Array<{ id: string; name: string; link: string; source: string }>
})

// ============================================================================
// NEEDS ATTENTION BREAKDOWN
// ============================================================================

export interface NeedsAttentionBreakdown {
  readyForEnrichment: number
  missingVenueOnly: number
  enrichmentFailed: number
  noLink: number
}

/**
 * Get breakdown of events needing attention by category.
 */
export const getNeedsAttentionBreakdownAction = createServerFn({ method: 'GET' }).handler(
  async (): Promise<NeedsAttentionBreakdown> => {
    await requireAdminAccess()

    const { data, error } = await supabase.rpc('get_needs_attention_breakdown')

    if (error) {
      console.error('[enrichment] Failed to get needs attention breakdown:', error)
      return {
        readyForEnrichment: 0,
        missingVenueOnly: 0,
        enrichmentFailed: 0,
        noLink: 0,
      }
    }

    const row = data?.[0] || {}
    return {
      readyForEnrichment: Number(row.ready_for_enrichment) || 0,
      missingVenueOnly: Number(row.missing_venue_only) || 0,
      enrichmentFailed: Number(row.enrichment_failed) || 0,
      noLink: Number(row.no_link) || 0,
    }
  }
)

// ============================================================================
// RETRY FAILED ENRICHMENTS
// ============================================================================

/**
 * Reset failed enrichments to pending status so they can be retried.
 */
export const resetFailedEnrichmentsAction = createServerFn({ method: 'POST' }).handler(
  async (): Promise<{ count: number }> => {
    const client = await requireAdminAccess()

    const { data, error } = await client
      .from('events')
      .update({
        enrichment_status: 'pending',
        enrichment_error: null,
      })
      .eq('enrichment_status', 'failed')
      .not('link', 'is', null)
      .select('id')

    if (error) {
      console.error('[enrichment] Failed to reset failed enrichments:', error)
      throw new Error(`Failed to reset enrichments: ${error.message}`)
    }

    const count = data?.length || 0
    console.log(`[enrichment] Reset ${count} failed enrichments to pending`)

    return { count }
  }
)

// ============================================================================
// VENUE-ONLY ENRICHMENT
// ============================================================================

/**
 * Get events that have descriptions but are missing venues (for venue-only enrichment).
 */
export const getEventsNeedingVenueOnlyAction = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Array<{ id: string; name: string; link: string; source: string }>> => {
    await requireAdminAccess()

    const { data, error } = await supabase
      .from('events')
      .select('id, name, link, source')
      .eq('enrichment_status', 'completed')
      .is('venue_id', null)
      .not('link', 'is', null)
      .neq('status', 'past')
      .order('starts_at', { ascending: true })
      .limit(200)

    if (error) {
      console.error('[enrichment] Failed to get events needing venue:', error)
      return []
    }

    return (data || []) as Array<{ id: string; name: string; link: string; source: string }>
  }
)

// ============================================================================
// PASSLINE DESCRIPTION ENRICHMENT (CLIENT-SIDE EXTRACTION)
// ============================================================================

export interface PasslineDescriptionEnrichProgress {
  type: 'progress'
  current: number
  total: number
  eventName: string
  success: boolean
  error?: string
}

export interface PasslineDescriptionEnrichComplete {
  type: 'complete'
  enriched: number
  translated: number
  total: number
  errors?: Array<{ id: string; error: string }>
}

export type PasslineDescriptionEnrichUpdate =
  | PasslineDescriptionEnrichProgress
  | PasslineDescriptionEnrichComplete

/**
 * Enrich Passline event descriptions from client-extracted data.
 *
 * Since Cloudflare blocks server-side requests to Passline, descriptions must be
 * extracted client-side from JSON-LD. This action:
 * 1. Takes Spanish descriptions already extracted by the client
 * 2. Translates them to English
 * 3. Generates embeddings
 * 4. Saves both descriptions to the database
 *
 * Use with extractPasslineEventsBatchClient on the client side.
 */
export const enrichPasslineDescriptionsAction = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: { events: Array<{ id: string; name: string; description_es: string }> }) => data
  )
  .handler(async function* ({
    data: { events },
  }): AsyncGenerator<PasslineDescriptionEnrichUpdate> {
    const client = await requireAdminAccess()
    console.log(
      `[server] enrichPasslineDescriptionsAction called with ${events.length} events`
    )

    let enriched = 0
    let translated = 0
    const errors: Array<{ id: string; error: string }> = []

    for (let i = 0; i < events.length; i++) {
      const { id, name, description_es } = events[i]

      try {
        // Translate Spanish description to English
        let description_en: string | null = null
        try {
          description_en = await translateText(description_es, 'es-to-en')
          if (description_en) translated++
        } catch (translateError) {
          console.warn(`[server] Failed to translate description for ${id}:`, translateError)
          // Continue without English translation
        }

        // Get existing event data for embedding generation
        const existingEvent = await getEventById(id)

        // Generate embedding from Spanish description
        const embedding = await generateEventEmbedding({
          name: existingEvent.name,
          description_es,
          categories: existingEvent.categories,
        })

        // Update event with descriptions, embedding, and enrichment status
        await updateEvent(
          id,
          {
            description_es,
            description_en,
            embedding,
            enrichment_status: 'completed',
            enriched_at: new Date().toISOString(),
          },
          client
        )

        enriched++

        yield {
          type: 'progress',
          current: i + 1,
          total: events.length,
          eventName: name,
          success: true,
        } as PasslineDescriptionEnrichProgress
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error'
        console.error(`[server] Failed to enrich Passline event ${id}:`, errorMsg)
        errors.push({ id, error: errorMsg })

        // Mark as failed
        try {
          await updateEvent(
            id,
            {
              enrichment_status: 'failed',
              enrichment_error: errorMsg,
            },
            client
          )
        } catch {
          // Ignore update error
        }

        yield {
          type: 'progress',
          current: i + 1,
          total: events.length,
          eventName: name,
          success: false,
          error: errorMsg,
        } as PasslineDescriptionEnrichProgress
      }
    }

    yield {
      type: 'complete',
      enriched,
      translated,
      total: events.length,
      errors: errors.length > 0 ? errors : undefined,
    } as PasslineDescriptionEnrichComplete
  })

/**
 * Get Passline events that need description enrichment.
 * These are events with source='passline' and enrichment_status='pending'.
 */
export const getPasslineEventsNeedingDescriptionsAction = createServerFn({
  method: 'GET',
}).handler(
  async (): Promise<Array<{ id: string; name: string; link: string }>> => {
    await requireAdminAccess()

    const { data, error } = await supabase
      .from('events')
      .select('id, name, link')
      .eq('source', 'passline')
      .eq('enrichment_status', 'pending')
      .not('link', 'is', null)
      .neq('status', 'past')
      .order('starts_at', { ascending: true })
      .limit(200)

    if (error) {
      console.error('[enrichment] Failed to get Passline events needing descriptions:', error)
      return []
    }

    return (data || []) as Array<{ id: string; name: string; link: string }>
  }
)

/**
 * Enrich Passline event descriptions using Playwright/Browserless.
 *
 * This is the complete server-side flow that:
 * 1. Launches Playwright/Browserless to fetch each event page
 * 2. Extracts Spanish descriptions from JSON-LD
 * 3. Translates them to English
 * 4. Generates embeddings
 * 5. Saves to the database
 *
 * Uses Browserless.io in production (BROWSERLESS_TOKEN env var),
 * or local Playwright for development.
 */
export const enrichPasslineDescriptionsWithPlaywrightAction = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: { events: Array<{ id: string; name: string; link: string }> }) => data
  )
  .handler(async function* ({
    data: { events },
  }): AsyncGenerator<PasslineDescriptionEnrichUpdate> {
    const client = await requireAdminAccess()
    console.log(
      `[server] enrichPasslineDescriptionsWithPlaywrightAction called with ${events.length} events`
    )

    let enriched = 0
    let translated = 0
    const errors: Array<{ id: string; error: string }> = []

    for (let i = 0; i < events.length; i++) {
      const event = events[i]

      try {
        // Phase 1: Fetch description using Playwright/Browserless
        console.log(`[server] Fetching description for "${event.name}" from ${event.link}`)
        const result = await fetchPasslineDescription({
          id: event.id,
          name: event.name,
          link: event.link,
        })

        if (!result.description) {
          console.log(`[server] No description found for "${event.name}": ${result.error || 'unknown'}`)
          errors.push({ id: event.id, error: result.error || 'No description found' })

          // Mark as failed
          await updateEvent(
            event.id,
            {
              enrichment_status: 'failed',
              enrichment_error: result.error || 'No description found',
            },
            client
          )

          yield {
            type: 'progress',
            current: i + 1,
            total: events.length,
            eventName: event.name,
            success: false,
            error: result.error,
          } as PasslineDescriptionEnrichProgress

          continue
        }

        const description_es = result.description

        // Phase 2: Translate to English
        let description_en: string | null = null
        try {
          description_en = await translateText(description_es, 'es-to-en')
          if (description_en) translated++
        } catch (translateError) {
          console.warn(`[server] Failed to translate description for ${event.id}:`, translateError)
          // Continue without English translation
        }

        // Phase 3: Get existing event data for embedding generation
        const existingEvent = await getEventById(event.id)

        // Phase 4: Generate embedding from Spanish description
        const embedding = await generateEventEmbedding({
          name: existingEvent.name,
          description_es,
          categories: existingEvent.categories,
        })

        // Phase 5: Update event with descriptions, embedding, and enrichment status
        await updateEvent(
          event.id,
          {
            description_es,
            description_en,
            embedding,
            enrichment_status: 'completed',
            enriched_at: new Date().toISOString(),
          },
          client
        )

        enriched++
        console.log(`[server] Successfully enriched "${event.name}"`)

        yield {
          type: 'progress',
          current: i + 1,
          total: events.length,
          eventName: event.name,
          success: true,
        } as PasslineDescriptionEnrichProgress
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error'
        console.error(`[server] Failed to enrich Passline event ${event.id}:`, errorMsg)
        errors.push({ id: event.id, error: errorMsg })

        // Mark as failed
        try {
          await updateEvent(
            event.id,
            {
              enrichment_status: 'failed',
              enrichment_error: errorMsg,
            },
            client
          )
        } catch {
          // Ignore update error
        }

        yield {
          type: 'progress',
          current: i + 1,
          total: events.length,
          eventName: event.name,
          success: false,
          error: errorMsg,
        } as PasslineDescriptionEnrichProgress
      }

      // Small delay between events to avoid overwhelming the browser service
      if (i < events.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    }

    yield {
      type: 'complete',
      enriched,
      translated,
      total: events.length,
      errors: errors.length > 0 ? errors : undefined,
    } as PasslineDescriptionEnrichComplete
  })
