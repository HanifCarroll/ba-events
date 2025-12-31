import { createServerFn } from '@tanstack/react-start'
import Anthropic from '@anthropic-ai/sdk'
import { requireAdminAccess } from './utils'

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

export interface AddressNameResult {
  venue_id: string
  is_address_like: boolean
  confidence: number
  suggested_name?: string
}

export interface MergeVenuesResult {
  success: boolean
  events_reassigned: number
  deleted_venue_id: string
  deleted_venue_name: string
  target_venue_id: string
  target_venue_name: string
}

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
export const detectAddressLikeNamesAction = createServerFn({ method: 'POST' })
  .inputValidator((venues: Array<{ id: string; name: string }>) => venues)
  .handler(async ({ data: venues }): Promise<AddressNameResult[]> => {
    await requireAdminAccess()

    if (venues.length === 0) return []

    const anthropic = new Anthropic()
    const results: AddressNameResult[] = []

    // Process in batches to manage token limits
    const BATCH_SIZE = 20

    for (let i = 0; i < venues.length; i += BATCH_SIZE) {
      const batch = venues.slice(i, i + BATCH_SIZE)
      const venueList = batch.map((v, idx) => `${idx + 1}. "${v.name}"`).join('\n')

      try {
        const message = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
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
                results.push({
                  venue_id: venue.id,
                  is_address_like: result.is_address,
                  confidence: result.confidence,
                  suggested_name: result.suggested_name,
                })
              }
            }
          } catch (parseError) {
            console.error('[venue-review] Failed to parse Haiku response:', parseError)
            console.error('[venue-review] Raw response:', textBlock.text.substring(0, 500))
            // Add all venues in batch as not address-like if parsing fails
            for (const venue of batch) {
              results.push({
                venue_id: venue.id,
                is_address_like: false,
                confidence: 0,
              })
            }
          }
        }
      } catch (apiError) {
        console.error('[venue-review] Haiku API error:', apiError)
        // Add all venues in batch as not address-like if API fails
        for (const venue of batch) {
          results.push({
            venue_id: venue.id,
            is_address_like: false,
            confidence: 0,
          })
        }
      }

      // Small delay between batches to avoid rate limiting
      if (i + BATCH_SIZE < venues.length) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }

    return results
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
}

// Get events for multiple venues (for merge preview)
export const getVenueEventsAction = createServerFn({ method: 'POST' })
  .inputValidator((venueIds: string[]) => venueIds)
  .handler(async ({ data: venueIds }): Promise<Record<string, VenueEventPreview[]>> => {
    const client = await requireAdminAccess()

    if (venueIds.length === 0) return {}

    const { data, error } = await client
      .from('events')
      .select('id, name, starts_at, status, link, venue_id')
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
        })
      }
    }

    return eventsByVenue
  })
