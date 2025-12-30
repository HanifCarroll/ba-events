import { createServerFn } from '@tanstack/react-start'
import { getEventsWithVenues, getEventById, updateEvent } from '../supabase'
import { generateEmbedding } from '../embeddings'
import { enrichEventDescriptionBilingual } from '../enrichment'
import type { EventWithVenue } from '../types'

/**
 * Enrich event descriptions using Jina Reader + Haiku 4.5
 * Extracts semantic description in Spanish, translates to English
 * Uses Spanish description for embedding (cross-lingual model handles it)
 */
export const enrichEventDescriptionsAction = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: { events: Array<{ id: string; link: string }> }) => data
  )
  .handler(async ({ data: { events } }) => {
    console.log(`[server] enrichEventDescriptionsAction called with ${events.length} events`)
    let enriched = 0
    const errors: Array<{ id: string; error: string }> = []

    for (const { id, link } of events) {
      console.log(`[server] Processing event ${id}: ${link}`)
      try {
        // Fetch and extract bilingual descriptions using Jina + Haiku
        const bilingual = await enrichEventDescriptionBilingual(link)
        console.log(`[server] Got descriptions for ${id}: ES=${bilingual?.description_es ? 'yes' : 'no'}, EN=${bilingual?.description_en ? 'yes' : 'no'}`)

        if (!bilingual?.description_es) {
          errors.push({ id, error: 'Failed to extract description' })
          continue
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
        })

        enriched++
      } catch (error) {
        console.error(`Failed to enrich event ${id}:`, error)
        errors.push({
          id,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }

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
 * Update event descriptions in batch (bilingual)
 * Regenerates embeddings for each updated event using Spanish description
 */
export const updateEventDescriptionsAction = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: { updates: Array<{ id: string; description_es: string; description_en: string }> }) => data
  )
  .handler(async ({ data: { updates } }) => {
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
        })

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
