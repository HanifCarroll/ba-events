import { createServerFn } from '@tanstack/react-start'
import {
  transformPasslineEvent,
  type PasslineEvent,
} from '../../scrapers/passline'
import { categorizeEvent } from '../../scrapers/ai-categorizer'
import { matchVenue, type VenueMatchResult } from '../../scrapers/venue-matcher'
import { upsertEvents, updateEvent, createVenue } from '../../supabase'
import { generateEmbedding } from '../../embeddings'
import { mapToNeighborhood } from '../utils'
import type { EventInsert, Neighborhood } from '../../types'

export interface PasslinePreviewEvent {
  passline: PasslineEvent
  transformed: EventInsert
  venueMatch: VenueMatchResult
}

// Re-export PasslineEvent type for client use
export type { PasslineEvent }

/**
 * Process raw Passline events (client-side fetched) and do venue matching
 * This is used when the browser fetches events directly to bypass Cloudflare
 */
export const processPasslineEventsAction = createServerFn({ method: 'POST' })
  .inputValidator((data: { events: PasslineEvent[] }) => data)
  .handler(async ({ data: { events } }): Promise<PasslinePreviewEvent[]> => {
    // Match venues and transform events
    const previews: PasslinePreviewEvent[] = await Promise.all(
      events.map(async (event) => {
        const venueMatch = await matchVenue(event.lugar)
        const transformed = transformPasslineEvent(
          event,
          venueMatch.venue?.id || null
        )

        return {
          passline: event,
          transformed,
          venueMatch,
        }
      })
    )

    return previews
  })

/**
 * Import a batch of events from client-provided Passline data
 * Processes events in small batches to avoid timeouts
 * Auto-creates venues when no match found (Passline has venue name but no address)
 */
export const importPasslineEventsBatchAction = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: { events: Array<{ passlineEvent: PasslineEvent; venueId: string | null }> }) => data
  )
  .handler(async ({ data }) => {
    if (data.events.length === 0) {
      return { success: true, inserted: 0, updated: 0, venuesCreated: 0 }
    }

    const venuesCreated = 0

    // Transform events, matching to existing venues only
    // Note: We don't auto-create venues from Passline's "lugar" field because it's unreliable
    // (can be venue name, address, or combination like "Chacabuco 947, San Telmo")
    // Events without venue matches should use "Fill Venues" to extract proper data from detail pages
    const eventsToImport: EventInsert[] = []
    for (const { passlineEvent, venueId } of data.events) {
      let finalVenueId = venueId

      // If no venue matched but we have a venue name, try to match existing venue only
      if (!finalVenueId && passlineEvent.lugar && passlineEvent.lugar !== 'VARIAS LOCACIONES') {
        const venueMatch = await matchVenue(passlineEvent.lugar)
        if (venueMatch.venue) {
          finalVenueId = venueMatch.venue.id
        }
        // Don't auto-create venues - leave venue_id null for client-side enrichment
      }

      eventsToImport.push(transformPasslineEvent(passlineEvent, finalVenueId))
    }

    // AI categorize and generate embeddings sequentially to avoid rate limits
    const eventsWithEmbeddings: EventInsert[] = []
    for (const event of eventsToImport) {
      // Categorize via AI
      const category = await categorizeEvent(event.name, event.description_es)

      const textForEmbedding = [
        event.name,
        event.description_es,
        category,
      ]
        .filter(Boolean)
        .join(' ')

      const embedding = await generateEmbedding(textForEmbedding)
      eventsWithEmbeddings.push({ ...event, categories: [category], embedding })
    }

    // Upsert events (insert new, update existing)
    const result = await upsertEvents(eventsWithEmbeddings)

    return {
      success: true,
      ...result,
      venuesCreated,
    }
  })

// ============================================================================
// PASSLINE VENUE ENRICHMENT (receives pre-extracted data from client)
// ============================================================================

interface PasslineVenueEnrichmentInput {
  id: string
  venueName: string
  address: string | null // Street address like "Blvd. Pellegrini y Av. López y Planes"
  location: string | null // City/region like "Santa Fe, SANTA FE"
}

interface PasslineVenueEnrichmentOutput {
  success: boolean
  enriched: number
  venuesCreated: number
  total: number
  errors: Array<{ id: string; error: string }>
}

/**
 * Enrich Passline events with venue data
 * Receives pre-extracted venue data from client (Cloudflare blocks server-side fetch)
 */
export const enrichPasslineVenuesAction = createServerFn({ method: 'POST' })
  .inputValidator((data: { events: PasslineVenueEnrichmentInput[] }) => data)
  .handler(async ({ data }): Promise<PasslineVenueEnrichmentOutput> => {
    const { events } = data

    if (events.length === 0) {
      return { success: true, enriched: 0, venuesCreated: 0, total: 0, errors: [] }
    }

    console.log(`[Admin] Starting Passline venue enrichment for ${events.length} events...`)

    let enriched = 0
    let venuesCreated = 0
    const errors: Array<{ id: string; error: string }> = []

    // Process each event with pre-extracted venue data
    for (const event of events) {
      if (!event.venueName) {
        errors.push({ id: event.id, error: 'No venue name provided' })
        continue
      }

      try {
        // Try to match to existing venue
        const venueMatch = await matchVenue(event.venueName)

        let venueId: string

        if (venueMatch.venue) {
          // Use existing venue
          venueId = venueMatch.venue.id
        } else {
          // Build full address from street address and location
          // e.g., "Blvd. Pellegrini y Av. López y Planes, Santa Fe, SANTA FE"
          let fullAddress: string | null = null
          if (event.address && event.location) {
            fullAddress = `${event.address}, ${event.location}`
          } else if (event.address) {
            fullAddress = event.address
          } else if (event.location) {
            fullAddress = event.location
          }

          // Try to extract neighborhood from location if it's Buenos Aires
          let neighborhood: Neighborhood | null = null
          if (event.location) {
            // Location format: "City, NEIGHBORHOOD" or "Buenos Aires, PALERMO"
            const parts = event.location.split(',')
            if (parts.length >= 2) {
              const possibleNeighborhood = parts[1].trim()
              neighborhood = mapToNeighborhood(possibleNeighborhood)
            }
          }

          // Create new venue with extracted info
          const newVenue = await createVenue({
            name: event.venueName,
            address: fullAddress,
            neighborhood,
          })
          venueId = newVenue.id
          venuesCreated++
          console.log(`[Admin] Created new venue: ${event.venueName} (${fullAddress || 'no address'})`)
        }

        // Update event with venue_id
        await updateEvent(event.id, { venue_id: venueId })
        enriched++
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error'
        errors.push({ id: event.id, error: errorMsg })
      }
    }

    console.log(`[Admin] Passline venue enrichment complete: ${enriched} enriched, ${venuesCreated} venues created, ${errors.length} errors`)

    return {
      success: true,
      enriched,
      venuesCreated,
      total: events.length,
      errors,
    }
  })
