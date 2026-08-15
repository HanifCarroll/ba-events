import { embed } from 'ai'
import { createHash } from 'crypto'
import { getSupabase } from '#shared/lib/db/client.server.ts'
import type { Event, EventWithVenue, Neighborhood } from '../types.ts'
import { embeddingModel } from './providers.ts'
import type { EventFacets } from '#shared/lib/search-facets.ts'
import { EMPTY_FACETS } from '#shared/lib/search-facets.ts'

// Version of the search-document schema this code produces. Bump it whenever
// `buildSearchDocument` changes in a way that changes the embedding/text, then
// re-embed stale rows (scripts/reembed-stale.ts targets rows below this).
export const CURRENT_EMBEDDING_VERSION = 2

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

// Minimal data needed for embedding text generation (for import scenarios).
// Extends the core fields so callers can pass venue, price, facets and an
// English description when they have them.
export interface EmbeddingEventData {
  name: string
  description_es?: string | null
  description_en?: string | null
  categories?: string[] | null
  venue_name?: string | null
  venue_neighborhood?: Neighborhood | string | null
  price?: number | null
  is_free?: boolean
  facets?: EventFacets
}

const ARRAY_FACET_KEYS = [
  'eventType',
  'genres',
  'activities',
  'vibes',
  'audience',
  'setting',
] as const
const FACET_LABELS: Record<(typeof ARRAY_FACET_KEYS)[number], string> = {
  eventType: 'Event type',
  genres: 'Genres',
  activities: 'Activities',
  vibes: 'Vibes',
  audience: 'Audience',
  setting: 'Setting',
}

function facetValueList(facets: EventFacets): string[] {
  const sections: string[] = []
  for (const key of ARRAY_FACET_KEYS) {
    const values = facets[key] as unknown as string[]
    if (values && values.length > 0) {
      sections.push(`${FACET_LABELS[key]}: ${values.join(', ')}`)
    }
  }
  if (facets.energy) {
    sections.push(`Energy: ${facets.energy}`)
  }
  if (facets.socialInteraction) {
    sections.push(`Social interaction: ${facets.socialInteraction}`)
  }
  return sections
}

/**
 * Builds the canonical search document for an event.
 *
 * This is the single source of truth for both the embedding text and the
 * `search_document` column used by lexical FTS. Richer than the old builder:
 * it includes the English description (helps English queries), the structured
 * facets as readable phrases (genre/vibe/audience/setting), venue name +
 * neighborhood, and whether the event is free or paid.
 *
 * Import callers may pass only { name, description_es, categories } — facets
 * and venue/price fall back to empty/absent so the path still works before a
 * venue is settled.
 */
export function buildSearchDocument(event: Event | EventWithVenue | EmbeddingEventData): string {
  const parts: string[] = []

  // Title and both descriptions (Spanish primary, English for cross-lingual).
  parts.push(event.name)
  if (event.description_es) {
    parts.push(event.description_es)
  }
  if (event.description_en) {
    parts.push(event.description_en)
  }

  // Categories as natural language.
  if (event.categories && event.categories.length > 0) {
    parts.push(`Categories: ${event.categories.join(', ')}`)
  }

  // Structured facets as readable phrases (empty facets are safe — the corpus
  // before enrichment has `{}`, and that produces no sections).
  const facets =
    'facets' in event && event.facets ? event.facets : EMPTY_FACETS
  parts.push(...facetValueList(facets))

  // Venue context.
  const venueName =
    'venue_name' in event ? event.venue_name : undefined
  if (venueName) {
    const venueParts = [venueName]
    const neighborhood = 'venue_neighborhood' in event ? event.venue_neighborhood : undefined
    if (neighborhood) {
      venueParts.push(`in ${neighborhood}`)
    }
    parts.push(`Venue: ${venueParts.join(' ')}`)
  }

  // Cost — only when the free/paid field is actually present (unknown stays
  // silent rather than mislabeling a paid event).
  const isFree = 'is_free' in event ? event.is_free : undefined
  const price = 'price' in event ? event.price : undefined
  if (typeof isFree === 'boolean') {
    if (isFree) {
      parts.push('free event')
    } else if (price) {
      parts.push(`Price: ${price} ARS`)
    } else {
      parts.push('paid event')
    }
  }

  // Event type (from facets when present) — kept as a readable phrase above.
  return parts.filter(Boolean).join('. ')
}

// Build embedding text from event data. Thin wrapper over buildSearchDocument
// so import callers and legacy paths share the canonical builder (no fork).
export function buildEmbeddingText(
  event: Event | EventWithVenue | EmbeddingEventData
): string {
  return buildSearchDocument(event)
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

/**
 * Embed an event and return both the vector and the search document, so
 * callers can persist `embedding` + `search_document` + `embedding_version` in
 * one write. The document is the exact text that was embedded — they can never
 * drift out of sync.
 */
export async function embedEventWithDocument(
  event: Event | EventWithVenue | EmbeddingEventData
): Promise<{ embedding: number[]; searchDocument: string }> {
  const searchDocument = buildSearchDocument(event)
  const embedding = await generateEmbedding(searchDocument)
  return { embedding, searchDocument }
}

// Update embedding for a single event. Writes embedding + search_document +
// embedding_version in the same update so the document and version can never
// drift out of sync with the vector.
export async function updateEventEmbedding(eventId: string): Promise<void> {
  const { data: event, error } = await getSupabase()
    .from('events_with_venues')
    .select('*')
    .eq('id', eventId)
    .single()

  if (error) throw error

  const text = buildSearchDocument(event as EventWithVenue)
  const embedding = await generateEmbedding(text)

  const { error: updateError } = await getSupabase()
    .from('events')
    .update({
      embedding,
      search_document: text,
      embedding_version: CURRENT_EMBEDDING_VERSION,
    })
    .eq('id', eventId)

  if (updateError) throw updateError
}
