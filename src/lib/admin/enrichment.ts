import { createServerFn } from '@tanstack/react-start'
import { getEventsWithVenues, getEventById, updateEvent } from '../db/client'
import { generateEmbedding } from '../ai/embeddings'
import { enrichEventDescriptionBilingual } from '../ai/enrichment'
import { requireAdminAccess } from './utils'
import type { EventWithVenue } from '../types'

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
      return { id, success: false, error: 'Failed to extract description' }
    }

    // Get existing event to merge with new description
    const existingEvent = await getEventById(id)

    // Generate new embedding with Spanish description (cross-lingual model)
    const textForEmbedding = [
      existingEvent.name,
      bilingual.description_es,
      ...(existingEvent.categories || []),
    ]
      .filter(Boolean)
      .join(' ')

    const embedding = await generateEmbedding(textForEmbedding)

    // Update event with both descriptions and new embedding
    await updateEvent(id, {
      description_es: bilingual.description_es,
      description_en: bilingual.description_en,
      embedding,
    }, client)

    return { id, success: true }
  } catch (error) {
    console.error(`Failed to enrich event ${id}:`, error)
    return {
      id,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Enrich event descriptions using Jina Reader + Haiku 4.5
 * Processes events in parallel within each batch for faster throughput
 * Detects source language and translates appropriately
 */
export const enrichEventDescriptionsAction = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: { events: Array<{ id: string; link: string; source: string }> }) => data
  )
  .handler(async ({ data: { events } }) => {
    const client = await requireAdminAccess()
    console.log(`[server] enrichEventDescriptionsAction called with ${events.length} events (parallel processing)`)

    // Process all events in the batch in parallel
    const results = await Promise.all(
      events.map(({ id, link, source }) => enrichSingleEvent(id, link, source, client))
    )

    const enriched = results.filter(r => r.success).length
    const errors = results
      .filter(r => !r.success)
      .map(r => ({ id: r.id, error: r.error || 'Unknown error' }))

    return {
      success: true,
      enriched,
      total: events.length,
      errors: errors.length > 0 ? errors : undefined,
    }
  })

/**
 * Get events that are missing descriptions (no Spanish description)
 */
export const getEventsWithoutDescriptions = createServerFn({ method: 'GET' }).handler(
  async (): Promise<EventWithVenue[]> => {
    const events = await getEventsWithVenues(1000)
    return events.filter((e) => !e.description_es)
  }
)

/**
 * Regenerate embeddings for events using their current name/description
 * Use this when event names or descriptions have been manually corrected
 * and embeddings need to be updated to match
 */
export const regenerateEmbeddingsAction = createServerFn({ method: 'POST' })
  .inputValidator((data: { eventIds: string[] }) => data)
  .handler(async ({ data: { eventIds } }) => {
    const client = await requireAdminAccess()
    console.log(`[server] regenerateEmbeddingsAction called for ${eventIds.length} events`)

    let regenerated = 0
    const errors: Array<{ id: string; error: string }> = []

    for (const id of eventIds) {
      try {
        const event = await getEventById(id)

        // Build text for embedding from current event data
        const textForEmbedding = [
          event.name,
          event.description_es,
          ...(event.categories || []),
        ]
          .filter(Boolean)
          .join(' ')

        const embedding = await generateEmbedding(textForEmbedding)

        await updateEvent(id, { embedding }, client)
        regenerated++
        console.log(`[server] Regenerated embedding for: ${event.name.substring(0, 50)}...`)
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error'
        console.error(`[server] Failed to regenerate embedding for ${id}:`, errorMsg)
        errors.push({ id, error: errorMsg })
      }
    }

    return {
      success: true,
      regenerated,
      total: eventIds.length,
      errors: errors.length > 0 ? errors : undefined,
    }
  })

/**
 * Update event descriptions in batch (bilingual)
 * Regenerates embeddings for each updated event using Spanish description
 */
export const updateEventDescriptionsAction = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: { updates: Array<{ id: string; description_es: string; description_en: string }> }) => data
  )
  .handler(async ({ data: { updates } }) => {
    const client = await requireAdminAccess()
    let updated = 0

    for (const { id, description_es, description_en } of updates) {
      try {
        // Get existing event to merge with new description
        const existingEvent = await getEventById(id)

        // Generate new embedding with Spanish description (cross-lingual model)
        const textForEmbedding = [
          existingEvent.name,
          description_es,
          ...(existingEvent.categories || []),
        ]
          .filter(Boolean)
          .join(' ')

        const embedding = await generateEmbedding(textForEmbedding)

        // Update event with both descriptions and new embedding
        await updateEvent(id, {
          description_es,
          description_en,
          embedding,
        }, client)

        updated++
      } catch (error) {
        console.error(`Failed to update description for event ${id}:`, error)
      }
    }

    return {
      success: true,
      updated,
      total: updates.length,
    }
  })
