import { createServerFn } from '@tanstack/react-start'
import {
  transformPasslineEvent,
  type PasslineEvent,
} from '../scrapers/passline'
import { categorizeEvent } from '../scrapers/ai-categorizer'
import { matchVenue, type VenueMatchResult } from '../scrapers/venue-matcher'
import { upsertEvents, updateEvent, createVenue } from '@/shared/lib/db/client'
import { generateEventEmbedding } from '@/shared/lib/ai/embeddings'
import { mapToNeighborhood, requireAdminAccess } from '@/shared/lib/admin-utils'
import type { EventInsert, Neighborhood } from '@/shared/lib/types'
import type {
  ImportProgress,
  ImportComplete,
  ImportUpdate,
  VenueEnrichProgress,
  VenueEnrichComplete,
  VenueEnrichUpdate,
} from '@/shared/lib/streaming-types'
import { checkDuplicateEventsWithData, buildDuplicateInfo, type DuplicateInfo } from './duplicate-detection'

export interface PasslinePreviewEvent {
  passline: PasslineEvent
  transformed: EventInsert
  venueMatch: VenueMatchResult
  alreadyImported: boolean
  duplicateInfo?: DuplicateInfo
}

// Re-export PasslineEvent type for client use
export type { PasslineEvent }

// Re-export streaming types for backwards compatibility
export type { ImportProgress, ImportComplete, ImportUpdate, VenueEnrichProgress, VenueEnrichComplete, VenueEnrichUpdate }

/**
 * Process raw Passline events (client-side fetched) and do venue matching
 * This is used when the browser fetches events directly to bypass Cloudflare
 */
export const processPasslineEventsAction = createServerFn({ method: 'POST' })
  .inputValidator((data: { events: PasslineEvent[] }) => data)
  .handler(async ({ data: { events } }): Promise<PasslinePreviewEvent[]> => {
    // Match venues and transform events
    const previewsWithoutImportCheck = await Promise.all(
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

    // Check for duplicates with full event data for diff comparison
    const externalIds = previewsWithoutImportCheck
      .map((p) => p.transformed.external_id)
      .filter((id): id is string => Boolean(id))

    const existingEventsMap = await checkDuplicateEventsWithData(externalIds, 'passline')

    // Add alreadyImported flag and duplicate info with diffs
    const previews: PasslinePreviewEvent[] = previewsWithoutImportCheck.map((p) => {
      const existingEvent = p.transformed.external_id
        ? existingEventsMap.get(p.transformed.external_id)
        : undefined

      const alreadyImported = Boolean(existingEvent)
      const duplicateInfo = existingEvent
        ? buildDuplicateInfo(p.transformed, existingEvent)
        : undefined

      return {
        ...p,
        alreadyImported,
        duplicateInfo,
      }
    })

    return previews
  })

/**
 * Import a batch of events from client-provided Passline data
 * Processes events in small batches to avoid timeouts
 * Auto-creates venues when no match found (Passline has venue name but no address)
 * Uses async generator to stream progress updates to the client
 */
export const importPasslineEventsBatchAction = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: { events: Array<{ passlineEvent: PasslineEvent; venueId: string | null }> }) => data
  )
  .handler(async function* ({ data }): AsyncGenerator<ImportUpdate> {
    const client = await requireAdminAccess()

    if (data.events.length === 0) {
      yield { type: 'complete', inserted: 0, updated: 0, venuesCreated: 0 } as ImportComplete
      return
    }

    const venuesCreated = 0
    const total = data.events.length

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
    for (let i = 0; i < eventsToImport.length; i++) {
      const event = eventsToImport[i]

      // Yield categorizing progress
      yield {
        type: 'progress',
        current: i + 1,
        total,
        eventName: event.name,
        phase: 'categorizing',
      } as ImportProgress

      // Categorize via AI
      const category = await categorizeEvent(event.name, event.description_es)

      // Yield embedding progress
      yield {
        type: 'progress',
        current: i + 1,
        total,
        eventName: event.name,
        phase: 'embedding',
      } as ImportProgress

      const embedding = await generateEventEmbedding({
        name: event.name,
        description_es: event.description_es,
        categories: [category],
      })
      eventsWithEmbeddings.push({ ...event, categories: [category], embedding })
    }

    // Yield importing progress
    yield {
      type: 'progress',
      current: total,
      total,
      eventName: 'Saving to database...',
      phase: 'importing',
    } as ImportProgress

    // Upsert events (insert new, update existing)
    const result = await upsertEvents(eventsWithEmbeddings, client)

    // Yield final completion result
    yield {
      type: 'complete',
      ...result,
      venuesCreated,
    } as ImportComplete
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

/**
 * Enrich Passline events with venue data
 * Receives pre-extracted venue data from client (Cloudflare blocks server-side fetch)
 * Uses async generator to stream progress updates to the client
 */
export const enrichPasslineVenuesAction = createServerFn({ method: 'POST' })
  .inputValidator((data: { events: PasslineVenueEnrichmentInput[] }) => data)
  .handler(async function* ({ data }): AsyncGenerator<VenueEnrichUpdate> {
    const client = await requireAdminAccess()
    const { events } = data

    if (events.length === 0) {
      yield { type: 'complete', enriched: 0, venuesCreated: 0, total: 0, errors: [] } as VenueEnrichComplete
      return
    }

    console.log(`[Admin] Starting Passline venue enrichment for ${events.length} events...`)

    let enriched = 0
    let venuesCreated = 0
    const errors: Array<{ id: string; error: string }> = []

    // Process each event with pre-extracted venue data
    for (let i = 0; i < events.length; i++) {
      const event = events[i]

      if (!event.venueName) {
        errors.push({ id: event.id, error: 'No venue name provided' })
        yield {
          type: 'progress',
          current: i + 1,
          total: events.length,
          eventName: event.id,
          action: 'error',
        } as VenueEnrichProgress
        continue
      }

      try {
        // Try to match to existing venue
        const venueMatch = await matchVenue(event.venueName)

        let venueId: string
        let action: 'matched' | 'created' = 'matched'

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
          }, client)
          venueId = newVenue.id
          venuesCreated++
          action = 'created'
          console.log(`[Admin] Created new venue: ${event.venueName} (${fullAddress || 'no address'})`)
        }

        // Update event with venue_id
        await updateEvent(event.id, { venue_id: venueId }, client)
        enriched++

        // Yield progress update
        yield {
          type: 'progress',
          current: i + 1,
          total: events.length,
          eventName: event.id,
          action,
          venueName: event.venueName,
        } as VenueEnrichProgress
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error'
        errors.push({ id: event.id, error: errorMsg })

        // Yield error progress
        yield {
          type: 'progress',
          current: i + 1,
          total: events.length,
          eventName: event.id,
          action: 'error',
          venueName: event.venueName,
        } as VenueEnrichProgress
      }
    }

    console.log(`[Admin] Passline venue enrichment complete: ${enriched} enriched, ${venuesCreated} venues created, ${errors.length} errors`)

    // Yield final completion result
    yield {
      type: 'complete',
      enriched,
      venuesCreated,
      total: events.length,
      errors,
    } as VenueEnrichComplete
  })
