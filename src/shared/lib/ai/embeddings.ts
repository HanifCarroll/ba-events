import { embed } from 'ai'
import { createHash } from 'crypto'
import { supabase } from '../db/client'
import type { Event, EventWithVenue } from '../types'
import { embeddingModel } from './providers'

type CachedEmbedding = {
  embedding: number[]
  expiresAt: number
}

const embeddingCache = new Map<string, CachedEmbedding>()
const EMBEDDING_CACHE_TTL_MS = 60 * 60 * 1000
const MAX_EMBEDDING_CACHE_ENTRIES = 500

function pruneEmbeddingCache(now: number) {
  for (const [key, entry] of embeddingCache.entries()) {
    if (entry.expiresAt <= now) {
      embeddingCache.delete(key)
    }
  }

  while (embeddingCache.size >= MAX_EMBEDDING_CACHE_ENTRIES) {
    const oldestKey = embeddingCache.keys().next().value
    if (!oldestKey) break
    embeddingCache.delete(oldestKey)
  }
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

// Generate embedding using OpenAI with caching
export async function generateEmbedding(text: string): Promise<number[]> {
  // Create cache key from text hash
  const cacheKey = `embedding:${createHash('sha256').update(text).digest('hex')}`
  const now = Date.now()
  const cached = embeddingCache.get(cacheKey)

  if (cached && cached.expiresAt > now) {
    console.log('[Embeddings] Cache hit')
    return cached.embedding
  }

  if (cached && cached.expiresAt <= now) {
    embeddingCache.delete(cacheKey)
  }

  // Generate embedding
  const { embedding } = await embed({
    model: embeddingModel,
    value: text,
  })

  pruneEmbeddingCache(now)
  embeddingCache.set(cacheKey, {
    embedding,
    expiresAt: now + EMBEDDING_CACHE_TTL_MS,
  })
  console.log('[Embeddings] Cached new embedding')

  return embedding
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
