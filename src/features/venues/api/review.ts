import { createServerFn } from '@tanstack/react-start'
import Anthropic from '@anthropic-ai/sdk'
import { requireAdminAccess } from '@/shared/lib/admin-utils'
import { CLAUDE_MODEL } from '@/shared/lib/ai/constants'
import type {
  AddressNameResult,
  AddressDetectionProgress,
  AddressDetectionComplete,
  AddressDetectionUpdate,
} from '@/shared/lib/streaming-types'

// Types
export interface VenueDuplicatePair {
  venue_id: string
  venue_name: string
  venue_neighborhood: string | null
  similar_venue_id: string
  similar_venue_name: string
  similar_venue_neighborhood: string | null
  similarity_score: number
}

export interface MergeVenuesResult {
  success: boolean
  events_reassigned: number
  deleted_venue_id: string
  deleted_venue_name: string
  target_venue_id: string
  target_venue_name: string
}

// Re-export streaming types for backwards compatibility
export type { AddressNameResult, AddressDetectionProgress, AddressDetectionComplete, AddressDetectionUpdate }

// Get duplicate venue candidates using pg_trgm similarity
export const getDuplicateVenueCandidatesAction = createServerFn({ method: 'GET' })
  .inputValidator((threshold?: number) => threshold ?? 0.5)
  .handler(async ({ data: threshold }): Promise<VenueDuplicatePair[]> => {
    const client = await requireAdminAccess()

    const { data, error } = await client.rpc('get_duplicate_venue_candidates', {
      similarity_threshold: threshold,
    })

    if (error) throw error
    return data ?? []
  })

// Detect address-like venue names using Claude Haiku
// Uses async generator to stream progress updates to the client
export const detectAddressLikeNamesAction = createServerFn({ method: 'POST' })
  .inputValidator((venues: Array<{ id: string; name: string }>) => venues)
  .handler(async function* ({ data: venues }): AsyncGenerator<AddressDetectionUpdate> {
    await requireAdminAccess()

    if (venues.length === 0) {
      yield { type: 'complete', results: [], total: 0 } as AddressDetectionComplete
      return
    }

    const anthropic = new Anthropic()
    const results: AddressNameResult[] = []

    // Process in batches to manage token limits
    const BATCH_SIZE = 20
    const totalBatches = Math.ceil(venues.length / BATCH_SIZE)
    let venuesProcessed = 0

    for (let i = 0; i < venues.length; i += BATCH_SIZE) {
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1
      const batch = venues.slice(i, i + BATCH_SIZE)
      const venueList = batch.map((v, idx) => `${idx + 1}. "${v.name}"`).join('\n')
      const batchResults: AddressNameResult[] = []

      try {
        const message = await anthropic.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: 1000,
          messages: [
            {
              role: 'user',
              content: `Analyze these venue names from Buenos Aires and identify which ones look like street addresses rather than proper venue/business names.

Address-like patterns include:
- Street names with numbers (e.g., "Av. Corrientes 1234", "Thames 2100")
- Just a street name (e.g., "Calle Florida", "Avenida de Mayo")
- Intersection descriptions (e.g., "Corrientes y Callao")
- Building or floor descriptions (e.g., "Piso 5, Oficina 12")

Proper venue names include:
- Business names (e.g., "La Biblioteca Cafe", "Bebop Club", "Teatro Colon")
- Cultural venues (e.g., "Centro Cultural Recoleta", "Museo de Arte Moderno")
- Generic descriptive names are OK (e.g., "Multiespacio para Eventos")

For each venue, respond with a JSON array. Each item should have:
- "index": the number from the list (1-based)
- "is_address": true if it looks like an address, false if it's a proper venue name
- "confidence": 0.0 to 1.0 indicating how confident you are
- "suggested_name": (optional) if is_address=true and you can suggest a better name based on context

Venues to analyze:
${venueList}

Respond ONLY with the JSON array, no other text.`,
            },
          ],
        })

        const textBlock = message.content.find((block) => block.type === 'text')
        if (textBlock?.text) {
          try {
            // Strip markdown code fences if present
            let jsonText = textBlock.text.trim()
            if (jsonText.startsWith('```')) {
              jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
            }

            // Try to fix common JSON issues from LLM output
            // 1. Remove trailing commas before ] or }
            jsonText = jsonText.replace(/,(\s*[}\]])/g, '$1')
            // 2. Try to extract just the array if there's extra text
            const arrayMatch = jsonText.match(/\[[\s\S]*\]/)
            if (arrayMatch) {
              jsonText = arrayMatch[0]
            }

            const parsed = JSON.parse(jsonText) as Array<{
              index: number
              is_address: boolean
              confidence: number
              suggested_name?: string
            }>

            for (const result of parsed) {
              const venue = batch[result.index - 1]
              if (venue) {
                const addressResult: AddressNameResult = {
                  venue_id: venue.id,
                  is_address_like: result.is_address,
                  confidence: result.confidence,
                  suggested_name: result.suggested_name,
                }
                batchResults.push(addressResult)
                results.push(addressResult)
              }
            }
          } catch (parseError) {
            console.error('[venue-review] Failed to parse Haiku response:', parseError)
            console.error('[venue-review] Raw response:', textBlock.text.substring(0, 500))
            // Add all venues in batch as not address-like if parsing fails
            for (const venue of batch) {
              const addressResult: AddressNameResult = {
                venue_id: venue.id,
                is_address_like: false,
                confidence: 0,
              }
              batchResults.push(addressResult)
              results.push(addressResult)
            }
          }
        }
      } catch (apiError) {
        console.error('[venue-review] Haiku API error:', apiError)
        // Add all venues in batch as not address-like if API fails
        for (const venue of batch) {
          const addressResult: AddressNameResult = {
            venue_id: venue.id,
            is_address_like: false,
            confidence: 0,
          }
          batchResults.push(addressResult)
          results.push(addressResult)
        }
      }

      venuesProcessed += batch.length

      // Yield progress update after each batch
      yield {
        type: 'progress',
        current: venuesProcessed,
        total: venues.length,
        batchNumber,
        totalBatches,
        batchResults,
      } as AddressDetectionProgress

      // Small delay between batches to avoid rate limiting
      if (i + BATCH_SIZE < venues.length) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }

    // Yield final completion result
    yield {
      type: 'complete',
      results,
      total: venues.length,
    } as AddressDetectionComplete
  })

// Merge two venues (reassign events from source to target, delete source)
export const mergeVenuesAction = createServerFn({ method: 'POST' })
  .inputValidator((input: { sourceVenueId: string; targetVenueId: string }) => input)
  .handler(async ({ data }): Promise<MergeVenuesResult> => {
    const client = await requireAdminAccess()

    const { data: result, error } = await client.rpc('merge_venues', {
      source_venue_id: data.sourceVenueId,
      target_venue_id: data.targetVenueId,
    })

    if (error) throw error
    return result as MergeVenuesResult
  })

// Get event counts for multiple venues
export const getVenueEventCountsAction = createServerFn({ method: 'POST' })
  .inputValidator((venueIds: string[]) => venueIds)
  .handler(async ({ data: venueIds }): Promise<Record<string, number>> => {
    const client = await requireAdminAccess()

    if (venueIds.length === 0) return {}

    const { data, error } = await client
      .from('events')
      .select('venue_id')
      .in('venue_id', venueIds)

    if (error) throw error

    // Count events per venue
    const counts: Record<string, number> = {}
    for (const id of venueIds) {
      counts[id] = 0
    }
    for (const event of data ?? []) {
      if (event.venue_id) {
        counts[event.venue_id] = (counts[event.venue_id] ?? 0) + 1
      }
    }

    return counts
  })

// Simple event info for venue preview
export interface VenueEventPreview {
  id: string
  name: string
  starts_at: string
  status: string
  link: string | null
  source: string
}

// Get events for multiple venues (for merge preview)
export const getVenueEventsAction = createServerFn({ method: 'POST' })
  .inputValidator((venueIds: string[]) => venueIds)
  .handler(async ({ data: venueIds }): Promise<Record<string, VenueEventPreview[]>> => {
    const client = await requireAdminAccess()

    if (venueIds.length === 0) return {}

    const { data, error } = await client
      .from('events')
      .select('id, name, starts_at, status, link, source, venue_id')
      .in('venue_id', venueIds)
      .order('starts_at', { ascending: false })

    if (error) throw error

    // Group events by venue
    const eventsByVenue: Record<string, VenueEventPreview[]> = Object.fromEntries(
      venueIds.map((id) => [id, []])
    )

    for (const event of data ?? []) {
      if (event.venue_id && eventsByVenue[event.venue_id]) {
        eventsByVenue[event.venue_id].push({
          id: event.id,
          name: event.name,
          starts_at: event.starts_at,
          status: event.status,
          link: event.link,
          source: event.source,
        })
      }
    }

    return eventsByVenue
  })

// Types for dismissed duplicates
export interface DismissedDuplicate {
  id: string
  venue_id_1: string
  venue_id_2: string
  venue_1_name: string
  venue_2_name: string
  dismissed_at: string
}

// Dismiss a duplicate pair (mark as "not a duplicate")
export const dismissDuplicatePairAction = createServerFn({ method: 'POST' })
  .inputValidator((input: { venueId1: string; venueId2: string }) => input)
  .handler(async ({ data }): Promise<{ success: boolean }> => {
    const client = await requireAdminAccess()

    // Get current user ID for audit
    const {
      data: { user },
    } = await client.auth.getUser()

    // Normalize the order (smaller UUID first to match CHECK constraint)
    const [id1, id2] =
      data.venueId1 < data.venueId2 ? [data.venueId1, data.venueId2] : [data.venueId2, data.venueId1]

    const { error } = await client.from('dismissed_venue_duplicates').insert({
      venue_id_1: id1,
      venue_id_2: id2,
      dismissed_by: user?.id,
    })

    if (error) {
      // Handle unique constraint violation (already dismissed)
      if (error.code === '23505') {
        return { success: true } // Already dismissed, treat as success
      }
      throw error
    }

    return { success: true }
  })

// Get list of dismissed duplicates (for viewing/undoing)
export const getDismissedDuplicatesAction = createServerFn({ method: 'GET' }).handler(
  async (): Promise<DismissedDuplicate[]> => {
    const client = await requireAdminAccess()

    // Query dismissed pairs with venue names
    const { data, error } = await client
      .from('dismissed_venue_duplicates')
      .select(
        `
        id,
        venue_id_1,
        venue_id_2,
        dismissed_at,
        venue_1:venues!dismissed_venue_duplicates_venue_id_1_fkey(name),
        venue_2:venues!dismissed_venue_duplicates_venue_id_2_fkey(name)
      `
      )
      .order('dismissed_at', { ascending: false })

    if (error) throw error

    // Transform to flat structure
    return (data ?? []).map((row) => {
      // Supabase returns single objects for foreign key references
      const venue1 = row.venue_1 as unknown as { name: string } | null
      const venue2 = row.venue_2 as unknown as { name: string } | null
      return {
        id: row.id,
        venue_id_1: row.venue_id_1,
        venue_id_2: row.venue_id_2,
        venue_1_name: venue1?.name ?? 'Unknown',
        venue_2_name: venue2?.name ?? 'Unknown',
        dismissed_at: row.dismissed_at,
      }
    })
  }
)

// Restore a dismissed pair (undo dismissal)
export const restoreDismissedPairAction = createServerFn({ method: 'POST' })
  .inputValidator((id: string) => id)
  .handler(async ({ data: id }): Promise<{ success: boolean }> => {
    const client = await requireAdminAccess()

    const { error } = await client.from('dismissed_venue_duplicates').delete().eq('id', id)

    if (error) throw error
    return { success: true }
  })
