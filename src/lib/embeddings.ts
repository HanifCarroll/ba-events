import OpenAI from 'openai'
import { createServerFn } from '@tanstack/react-start'
import { supabase } from './supabase'
import type { Event, EventWithVenue } from './types'

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

// Build embedding text from event data
export function buildEmbeddingText(event: Event | EventWithVenue): string {
  const parts: string[] = []

  // Event name and description (core content)
  parts.push(event.name)
  if (event.description) {
    parts.push(event.description)
  }

  // Categories as natural language
  if (event.categories && event.categories.length > 0) {
    parts.push(`Categories: ${event.categories.join(', ')}`)
  }

  // Vibes as natural language
  if (event.vibes && event.vibes.length > 0) {
    parts.push(`Vibes: ${event.vibes.join(', ')}`)
  }

  // Venue context (from EventWithVenue)
  if ('venue_name' in event && event.venue_name) {
    const venueParts = [event.venue_name]
    if (event.venue_neighborhood) {
      venueParts.push(`in ${event.venue_neighborhood}`)
    }
    parts.push(`Venue: ${venueParts.join(' ')}`)

    if (event.venue_type && event.venue_type !== 'other') {
      parts.push(`Venue type: ${event.venue_type}`)
    }
  }

  // Price context
  if (event.is_free) {
    parts.push('This is a free event')
  } else if (event.price) {
    parts.push(`Price: ${event.price} ARS`)
  }

  return parts.join('. ')
}

// Generate embedding using OpenAI
export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await getOpenAI().embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
    dimensions: 1536,
  })
  return response.data[0].embedding
}

// Generate embedding for an event
export async function generateEventEmbedding(
  event: Event | EventWithVenue
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
