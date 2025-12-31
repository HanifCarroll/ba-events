import { createServerFn } from '@tanstack/react-start'
import {
  type BATourismEvent,
  type WeekContext,
  scrapeBATourismEventsWithBrowser,
  transformBATourismEvent,
  parseWeekContext,
} from '../../scrapers/ba-tourism'
import { extractBATourismVenuesBatch } from '../../scrapers/ba-tourism/enrichment'
import { categorizeEvent } from '../../scrapers/ai-categorizer'
import { matchVenue, type VenueMatchResult } from '../../scrapers/venue-matcher'
import { upsertEvents, supabase, updateEvent, createVenue, createVenues, findVenuesByExactNames } from '../../db/client'
import { generateEmbedding } from '../../ai/embeddings'
import { mapToNeighborhood, requireAdminAccess } from '../utils'
import type { EventInsert } from '../../types'

export interface BATourismPreviewEvent {
  baTourism: BATourismEvent
  transformed: EventInsert[]
  venueMatch: VenueMatchResult
  dateCount: number
}

export type { BATourismEvent, WeekContext }

// Import streaming types
export interface ImportProgress {
  type: 'progress'
  current: number
  total: number
  eventName: string
  phase: 'categorizing' | 'embedding' | 'importing'
}

export interface ImportComplete {
  type: 'complete'
  inserted: number
  updated: number
  venuesCreated: number
}

export type ImportUpdate = ImportProgress | ImportComplete

// Venue enrichment streaming types
export interface VenueEnrichProgress {
  type: 'progress'
  current: number
  total: number
  eventName: string
  action: 'matched' | 'created' | 'error'
  venueName?: string
}

export interface VenueEnrichComplete {
  type: 'complete'
  enriched: number
  venuesCreated: number
  total: number
  errors: Array<{ id: string; error: string }>
}

export type VenueEnrichUpdate = VenueEnrichProgress | VenueEnrichComplete

export const fetchBATourismEventsAction = createServerFn({ method: 'POST' })
  .inputValidator((data: { weekContextText?: string }) => data)
  .handler(async ({ data }): Promise<{ events: BATourismPreviewEvent[]; weekContext: WeekContext }> => {
    try {
      console.log('[Admin] Starting BA Tourism fetch...')
      const { events: rawEvents, weekContext: fetchedContext } = await scrapeBATourismEventsWithBrowser()
      console.log(`[Admin] Scraped ${rawEvents.length} raw events`)

      const weekContext = data.weekContextText
        ? parseWeekContext(data.weekContextText)
        : fetchedContext

      const previews: BATourismPreviewEvent[] = await Promise.all(
        rawEvents.map(async (event) => {
          const venueMatch = await matchVenue(event.venueName)
          const transformed = transformBATourismEvent(
            event,
            weekContext,
            venueMatch.venue?.id || null,
            new Date()
          )

          return {
            baTourism: event,
            transformed,
            venueMatch,
            dateCount: transformed.length,
          }
        })
      )

      console.log(`[Admin] Returning ${previews.length} preview events`)
      return { events: previews, weekContext }
    } catch (error) {
      console.error('[Admin] BA Tourism fetch error:', error)
      throw error
    }
  })

/**
 * Import a batch of events from BA Tourism data
 * Uses async generator to stream progress updates to the client
 */
export const importBATourismEventsBatchAction = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: {
      events: Array<{
        baTourismEvent: BATourismEvent
        venueId: string | null
        weekContext: WeekContext
      }>
    }) => data
  )
  .handler(async function* ({ data }): AsyncGenerator<ImportUpdate> {
    const client = await requireAdminAccess()

    // Step 1: Collect unique venue names that need to be created
    const venueDataMap = new Map<
      string,
      { name: string; neighborhood: string | null; address: string | null }
    >()

    for (const { baTourismEvent, venueId } of data.events) {
      if (!venueId && baTourismEvent.venueName && baTourismEvent.venueName !== 'Ubicación no especificada') {
        // Use venue name as key, store the richest data (first occurrence wins)
        if (!venueDataMap.has(baTourismEvent.venueName)) {
          venueDataMap.set(baTourismEvent.venueName, {
            name: baTourismEvent.venueName,
            neighborhood: baTourismEvent.neighborhood || null,
            address: baTourismEvent.address || null,
          })
        }
      }
    }

    // Step 2: Check which venues already exist in database
    const venueNames = Array.from(venueDataMap.keys())
    const existingVenues = venueNames.length > 0 ? await findVenuesByExactNames(venueNames) : []
    const existingVenueNames = new Set(existingVenues.map((v) => v.name))

    // Step 3: Create missing venues
    const venuesToCreate = venueNames
      .filter((name) => !existingVenueNames.has(name))
      .map((name) => {
        const venueData = venueDataMap.get(name)!
        return {
          name: venueData.name,
          neighborhood: mapToNeighborhood(venueData.neighborhood),
          address: venueData.address,
          type: 'other' as const,
        }
      })

    let venuesCreated = 0
    let newVenues: Array<{ id: string; name: string }> = []

    if (venuesToCreate.length > 0) {
      try {
        newVenues = await createVenues(venuesToCreate, client)
        venuesCreated = newVenues.length
        console.log(`[Admin] Auto-created ${venuesCreated} venues for BA Tourism import`)
      } catch (error) {
        console.error('[Admin] Failed to create venues:', error)
        // Continue without the new venues
      }
    }

    // Step 4: Build venue name -> ID lookup
    const venueNameToId = new Map<string, string>()
    for (const venue of existingVenues) {
      venueNameToId.set(venue.name, venue.id)
    }
    for (const venue of newVenues) {
      venueNameToId.set(venue.name, venue.id)
    }

    // Step 5: Process events - categorize and embed ONCE per source event, then expand to dates
    const eventsWithEmbeddings: EventInsert[] = []
    const total = data.events.length

    for (let i = 0; i < data.events.length; i++) {
      const { baTourismEvent, venueId, weekContext } = data.events[i]

      // Yield categorizing progress
      yield {
        type: 'progress',
        current: i + 1,
        total,
        eventName: baTourismEvent.name,
        phase: 'categorizing',
      } as ImportProgress

      // Categorize and generate embedding in PARALLEL, once per source event
      const textForEmbedding = [
        baTourismEvent.name,
        baTourismEvent.description,
      ]
        .filter(Boolean)
        .join(' ')

      const [category, embedding] = await Promise.all([
        categorizeEvent(baTourismEvent.name, baTourismEvent.description),
        generateEmbedding(textForEmbedding),
      ])

      // Yield embedding progress (after parallel completion)
      yield {
        type: 'progress',
        current: i + 1,
        total,
        eventName: baTourismEvent.name,
        phase: 'embedding',
      } as ImportProgress

      // Look up venue ID from our map if not already set
      let finalVenueId = venueId
      if (!finalVenueId && baTourismEvent.venueName) {
        finalVenueId = venueNameToId.get(baTourismEvent.venueName) || null
      }

      // Expand into date events and apply the same category/embedding to all
      const transformed = transformBATourismEvent(baTourismEvent, weekContext, finalVenueId, new Date())
      for (const event of transformed) {
        eventsWithEmbeddings.push({ ...event, categories: [category], embedding })
      }
    }

    if (eventsWithEmbeddings.length === 0) {
      yield { type: 'complete', inserted: 0, updated: 0, venuesCreated } as ImportComplete
      return
    }

    // Yield importing progress
    yield {
      type: 'progress',
      current: total,
      total,
      eventName: 'Saving to database...',
      phase: 'importing',
    } as ImportProgress

    const result = await upsertEvents(eventsWithEmbeddings, client)

    // Yield final completion result
    yield {
      type: 'complete',
      ...result,
      venuesCreated,
    } as ImportComplete
  })

// ============================================================================
// BA TOURISM VENUE ENRICHMENT
// ============================================================================

export interface BATourismEnrichmentInput {
  id: string
  link: string
}

/**
 * Get BA Tourism events that need venue enrichment (no venue_id set)
 */
export const getBATourismEventsNeedingEnrichmentAction = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ events: Array<{ id: string; link: string }> }> => {
    const { data, error } = await supabase
      .from('events')
      .select('id, link')
      .eq('source', 'ba-tourism')
      .is('venue_id', null)
      .not('link', 'is', null)
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) {
      console.error('[Admin] Error fetching BA Tourism events needing enrichment:', error)
      return { events: [] }
    }

    return { events: data || [] }
  }
)

/**
 * Enrich BA Tourism events with venue information
 * Fetches venue names from detail pages and matches/creates venues
 * Uses async generator to stream progress updates to the client
 */
export const enrichBATourismVenuesAction = createServerFn({ method: 'POST' })
  .inputValidator((data: { events: BATourismEnrichmentInput[] }) => data)
  .handler(async function* ({ data }): AsyncGenerator<VenueEnrichUpdate> {
    const client = await requireAdminAccess()
    const { events } = data

    if (events.length === 0) {
      yield { type: 'complete', enriched: 0, venuesCreated: 0, total: 0, errors: [] } as VenueEnrichComplete
      return
    }

    console.log(`[Admin] Starting BA Tourism venue enrichment for ${events.length} events...`)

    // Extract venue names from detail pages
    const extractionResults = await extractBATourismVenuesBatch(events, 500)

    let enriched = 0
    let venuesCreated = 0
    const errors: Array<{ id: string; error: string }> = []

    // Process each result
    for (let i = 0; i < extractionResults.length; i++) {
      const result = extractionResults[i]

      if (result.error) {
        errors.push({ id: result.id, error: result.error })
        yield {
          type: 'progress',
          current: i + 1,
          total: events.length,
          eventName: result.id,
          action: 'error',
        } as VenueEnrichProgress
        continue
      }

      if (!result.venueName) {
        errors.push({ id: result.id, error: 'Could not extract venue name from page' })
        yield {
          type: 'progress',
          current: i + 1,
          total: events.length,
          eventName: result.id,
          action: 'error',
        } as VenueEnrichProgress
        continue
      }

      try {
        // Try to match to existing venue
        const venueMatch = await matchVenue(result.venueName)

        let venueId: string
        let action: 'matched' | 'created' = 'matched'

        if (venueMatch.venue) {
          // Use existing venue
          venueId = venueMatch.venue.id
        } else {
          // Create new venue (with just the name since detail page doesn't have full address)
          const newVenue = await createVenue({
            name: result.venueName,
            neighborhood: null,
            address: null,
          }, client)
          venueId = newVenue.id
          venuesCreated++
          action = 'created'
          console.log(`[Admin] Created new venue: ${result.venueName}`)
        }

        // Update event with venue_id
        await updateEvent(result.id, { venue_id: venueId }, client)
        enriched++

        // Yield progress update
        yield {
          type: 'progress',
          current: i + 1,
          total: events.length,
          eventName: result.id,
          action,
          venueName: result.venueName,
        } as VenueEnrichProgress
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error'
        errors.push({ id: result.id, error: errorMsg })

        // Yield error progress
        yield {
          type: 'progress',
          current: i + 1,
          total: events.length,
          eventName: result.id,
          action: 'error',
          venueName: result.venueName,
        } as VenueEnrichProgress
      }
    }

    console.log(`[Admin] BA Tourism venue enrichment complete: ${enriched} enriched, ${venuesCreated} venues created, ${errors.length} errors`)

    // Yield final completion result
    yield {
      type: 'complete',
      enriched,
      venuesCreated,
      total: events.length,
      errors,
    } as VenueEnrichComplete
  })
