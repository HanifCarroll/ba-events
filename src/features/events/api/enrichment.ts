import { createServerFn } from '@tanstack/react-start'
import { getEventsWithVenues, getEventById, updateEvent } from '@/shared/lib/db/client'
import { generateEventEmbedding } from '@/shared/lib/ai/embeddings'
import { enrichEventDescriptionBilingual } from '@/shared/lib/ai/enrichment'
import { requireAdminAccess } from '@/shared/lib/admin-utils'
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
 * Map event sources to known languages
 * Returns undefined for sources that need detection
 */
function getKnownLanguageForSource(source: string): 'spanish' | 'english' | undefined {
  switch (source) {
    case 'passline':
    case 'ba-tourism':
      return 'spanish'
    // Meetup and Eventbrite vary - need detection
    default:
      return undefined
  }
}

/**
 * Process a single event enrichment
 * Returns result object with success/error info
 */
async function enrichSingleEvent(
  id: string,
  link: string,
  source: string,
  client: Awaited<ReturnType<typeof requireAdminAccess>>
): Promise<{ id: string; success: boolean; error?: string }> {
  console.log(`[server] Processing event ${id}: ${link} (source: ${source})`)
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
