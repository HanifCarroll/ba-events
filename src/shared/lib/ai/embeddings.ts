import OpenAI from 'openai'
import { createServerFn } from '@tanstack/react-start'
import { supabase } from '../db/client'
import type { Event, EventWithVenue } from '../types'
import { EMBEDDING_MODEL, EMBEDDING_DIMENSIONS } from './constants'

// Lazy-initialize OpenAI client (only when needed, server-side only)
let openai: OpenAI | null = null

function getOpenAI(): OpenAI {
  if (!openai) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY environment variable is required')
    }
    openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    })
  }
  return openai
}

// Minimal data needed for embedding text generation (for import scenarios)
export interface EmbeddingEventData {
  name: string
  description_es?: string | null
  categories?: string[] | null
}

// Build embedding text from event data
// Uses Spanish description for cross-lingual semantic search
// Accepts full Event/EventWithVenue or minimal {name, description_es, categories}
export function buildEmbeddingText(
  event: Event | EventWithVenue | EmbeddingEventData
): string {
  const parts: string[] = []

  // Event name and Spanish description (core content for embedding)
  parts.push(event.name)
  if (event.description_es) {
    parts.push(event.description_es)
  }

  // Categories as natural language
  if (event.categories && event.categories.length > 0) {
    parts.push(`Categories: ${event.categories.join(', ')}`)
  }

  // Venue context (from EventWithVenue)
  if ('venue_name' in event && event.venue_name) {
    const venueParts = [event.venue_name]
    if (event.venue_neighborhood) {
      venueParts.push(`in ${event.venue_neighborhood}`)
    }
    parts.push(`Venue: ${venueParts.join(' ')}`)
  }

  // Price context (only available on full Event types)
  if ('is_free' in event && event.is_free) {
    parts.push('This is a free event')
  } else if ('price' in event && event.price) {
    parts.push(`Price: ${event.price} ARS`)
  }

  return parts.join('. ')
}

// Generate embedding using OpenAI
export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await getOpenAI().embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
    dimensions: EMBEDDING_DIMENSIONS,
  })
  return response.data[0].embedding
}

// Generate embedding for an event (accepts full Event or minimal data)
export async function generateEventEmbedding(
  event: Event | EventWithVenue | EmbeddingEventData
): Promise<number[]> {
  const text = buildEmbeddingText(event)
  return generateEmbedding(text)
}

// Update embedding for a single event
export async function updateEventEmbedding(eventId: string): Promise<void> {
  const { data: event, error } = await supabase
    .from('events_with_venues')
    .select('*')
    .eq('id', eventId)
    .single()

  if (error) throw error

  const text = buildEmbeddingText(event as EventWithVenue)
  const embedding = await generateEmbedding(text)

  const { error: updateError } = await supabase
    .from('events')
    .update({ embedding })
    .eq('id', eventId)

  if (updateError) throw updateError
}

// Server function to populate embeddings for all events missing them
export const populateAllEmbeddings = createServerFn({ method: 'POST' }).handler(
  async () => {
    // Fetch all events without embeddings
    const { data: events, error } = await supabase
      .from('events_with_venues')
      .select('*')
      .is('embedding', null)

    if (error) throw error
    if (!events || events.length === 0) {
      return { success: 0, failed: 0, message: 'No events need embeddings' }
    }

    const results = { success: 0, failed: 0, errors: [] as string[] }
    const BATCH_SIZE = 10

    for (let i = 0; i < events.length; i += BATCH_SIZE) {
      const batch = events.slice(i, i + BATCH_SIZE)

      await Promise.all(
        batch.map(async event => {
          try {
            const text = buildEmbeddingText(event as EventWithVenue)
            const embedding = await generateEmbedding(text)

            const { error: updateError } = await supabase
              .from('events')
              .update({ embedding })
              .eq('id', event.id)

            if (updateError) throw updateError
            results.success++
          } catch (err) {
            results.failed++
            results.errors.push(`${event.id}: ${(err as Error).message}`)
          }
        })
      )

      // Rate limit protection - wait 1 second between batches
      if (i + BATCH_SIZE < events.length) {
        await new Promise(r => setTimeout(r, 1000))
      }
    }

    return results
  }
)
