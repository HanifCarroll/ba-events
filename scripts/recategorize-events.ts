/**
 * Recategorize Existing Events
 *
 * This script recategorizes all existing events using the AI categorizer
 * and regenerates their embeddings without vibes.
 *
 * Run with: bun scripts/recategorize-events.ts
 */

import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { CLAUDE_MODEL } from '../src/shared/lib/ai/constants'

// Initialize clients
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
)

const anthropic = new Anthropic()
const openai = new OpenAI()

// The 6 simplified categories
type Category = 'music' | 'arts' | 'food' | 'social' | 'sports' | 'festival'
const VALID_CATEGORIES: Category[] = ['music', 'arts', 'food', 'social', 'sports', 'festival']

const CATEGORIZATION_PROMPT = `Categorize this event into ONE of these categories:
- music: concerts, DJ sets, live performances, music festivals
- arts: theater, comedy, film, exhibitions, galleries, workshops, cultural events
- food: food markets, wine tastings, culinary events, restaurant events
- social: networking, meetups, parties, social gatherings, expat events
- sports: fitness, yoga, running, sports competitions, outdoor activities
- festival: multi-day festivals, large celebrations, fairs, carnivals

Based on the event name and description, choose the SINGLE most appropriate category.
If unclear, use "social" as the default.

Respond with ONLY the category name (lowercase), nothing else.`

async function categorizeEvent(name: string, description: string | null): Promise<Category> {
  try {
    const eventContext = `Event: ${name}${description ? `\nDescription: ${description}` : ''}`

    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 20,
      messages: [
        {
          role: 'user',
          content: `${CATEGORIZATION_PROMPT}\n\n${eventContext}`,
        },
      ],
    })

    const textBlock = message.content.find((block) => block.type === 'text')
    if (!textBlock?.text) {
      return 'social'
    }

    const category = textBlock.text.trim().toLowerCase() as Category

    if (VALID_CATEGORIES.includes(category)) {
      return category
    }

    console.warn(`Invalid category returned: "${textBlock.text}", defaulting to social`)
    return 'social'
  } catch (error) {
    console.error('Error categorizing event:', error)
    return 'social'
  }
}

async function generateEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
    dimensions: 1536,
  })
  return response.data[0].embedding
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
