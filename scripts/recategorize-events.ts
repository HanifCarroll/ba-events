/**
 * Recategorize Existing Events
 *
 * This script recategorizes all existing events using the AI categorizer
 * and regenerates their embeddings without vibes.
 *
 * Run with: bun scripts/recategorize-events.ts
 */

import { createClient } from '@supabase/supabase-js'
import { generateObject, embed } from 'ai'
import { z } from 'zod'
import { NO_THINKING, textModel, embeddingModel } from '../src/shared/lib/ai/providers'

// Initialize clients
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
)

// The 6 simplified categories
const CATEGORY_SCHEMA = z.object({
  category: z.enum(['music', 'arts', 'food', 'social', 'sports', 'festival']),
})

const CATEGORIZATION_PROMPT = `Categorize this event into ONE of these categories:
- music: concerts, DJ sets, live performances, music festivals
- arts: theater, comedy, film, exhibitions, galleries, workshops, cultural events
- food: food markets, wine tastings, culinary events, restaurant events
- social: networking, meetups, parties, social gatherings, expat events
- sports: fitness, yoga, running, sports competitions, outdoor activities
- festival: multi-day festivals, large celebrations, fairs, carnivals

Based on the event name and description, choose the SINGLE most appropriate category.
If unclear, use "social" as the default.

Respond with ONLY a JSON object with a single "category" field, e.g. {"category": "music"}. Nothing else.`

async function categorizeEvent(
  name: string,
  description: string | null
): Promise<z.infer<typeof CATEGORY_SCHEMA>['category']> {
  try {
    const eventContext = `Event: ${name}${description ? `\nDescription: ${description}` : ''}`

    const { object } = await generateObject({
      model: textModel,
      schema: CATEGORY_SCHEMA,
      prompt: `${CATEGORIZATION_PROMPT}\n\n${eventContext}`,
      ...NO_THINKING,
    })

    return object.category
  } catch (error) {
    console.error('Error categorizing event:', error)
    return 'social'
  }
}

async function generateEmbedding(text: string): Promise<number[]> {
  const { embedding } = await embed({
    model: embeddingModel,
    value: text,
  })
  return embedding
}

async function main() {
  console.log('='.repeat(60))
  console.log('RECATEGORIZE EXISTING EVENTS')
  console.log('='.repeat(60))
  console.log()

  // Fetch all events
  console.log('Fetching all events...')
  const { data: events, error } = await supabase
    .from('events')
    .select('id, name, description_es, categories')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Failed to fetch events:', error)
    process.exit(1)
  }

  console.log(`Found ${events.length} events to process\n`)

  let processed = 0
  let updated = 0
  let failed = 0
  const BATCH_SIZE = 10

  for (let i = 0; i < events.length; i++) {
    const event = events[i]
    processed++

    try {
      // Categorize event
      const category = await categorizeEvent(event.name, event.description_es)

      // Generate new embedding without vibes
      const textForEmbedding = [event.name, event.description_es, category]
        .filter(Boolean)
        .join(' ')

      const embedding = await generateEmbedding(textForEmbedding)

      // Update event
      const { error: updateError } = await supabase
        .from('events')
        .update({
          categories: [category],
          embedding,
        })
        .eq('id', event.id)

      if (updateError) {
        console.error(`Failed to update event ${event.id}:`, updateError)
        failed++
      } else {
        updated++
        console.log(`[${processed}/${events.length}] ${event.name.substring(0, 50)}... -> ${category}`)
      }
    } catch (err) {
      console.error(`Error processing event ${event.id}:`, err)
      failed++
    }

    // Rate limit protection - small delay between requests
    if (i > 0 && i % BATCH_SIZE === 0) {
      await new Promise((r) => setTimeout(r, 500))
    }
  }

  console.log()
  console.log('='.repeat(60))
  console.log('COMPLETE')
  console.log('='.repeat(60))
  console.log(`Processed: ${processed}`)
  console.log(`Updated:   ${updated}`)
  console.log(`Failed:    ${failed}`)
}

main().catch(console.error)
