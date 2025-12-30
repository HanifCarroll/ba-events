import { createServerFn } from '@tanstack/react-start'
import {
  type BATourismEvent,
  type WeekContext,
  scrapeBATourismEventsWithBrowser,
  transformBATourismEvent,
  parseWeekContext,
} from '../../scrapers/ba-tourism'
import { extractBATourismVenuesBatch } from '../../scrapers/ba-tourism/enrichment'
import { matchVenue, type VenueMatchResult } from '../../scrapers/venue-matcher'
import { upsertEvents, supabase, updateEvent, createVenue } from '../../supabase'
import { generateEmbedding } from '../../embeddings'
import { mapToNeighborhood } from '../utils'
import type { EventInsert } from '../../types'

export interface BATourismPreviewEvent {
  baTourism: BATourismEvent
  transformed: EventInsert[]
  venueMatch: VenueMatchResult
  dateCount: number
}

export type { BATourismEvent, WeekContext }

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
  .handler(async ({ data }) => {
    let venuesCreated = 0

    // Process events and auto-create venues when needed
    const eventsToImport: EventInsert[] = []

    for (const { baTourismEvent, venueId, weekContext } of data.events) {
      let finalVenueId = venueId

      // Auto-create venue if no match found and venue data exists
      if (!venueId && baTourismEvent.venueName) {
        try {
          const newVenue = await createVenue({
            name: baTourismEvent.venueName,
            neighborhood: mapToNeighborhood(baTourismEvent.neighborhood),
            address: baTourismEvent.address || null,
          })
          finalVenueId = newVenue.id
          venuesCreated++
          console.log(`[Admin] Auto-created venue: ${baTourismEvent.venueName}`)
        } catch (error) {
          console.error(`[Admin] Failed to create venue ${baTourismEvent.venueName}:`, error)
          // Continue with null venue_id if creation fails
        }
      }

      const transformed = transformBATourismEvent(baTourismEvent, weekContext, finalVenueId, new Date())
      eventsToImport.push(...transformed)
    }

    if (eventsToImport.length === 0) {
      return { success: true, inserted: 0, updated: 0, venuesCreated }
    }

    const eventsWithEmbeddings: EventInsert[] = []
    for (const event of eventsToImport) {
      const textForEmbedding = [
        event.name,
        event.description_es,
        ...(event.categories || []),
        ...(event.vibes || []),
      ]
        .filter(Boolean)
        .join(' ')

      const embedding = await generateEmbedding(textForEmbedding)
      eventsWithEmbeddings.push({ ...event, embedding })
    }

    const result = await upsertEvents(eventsWithEmbeddings)

    return {
      success: true,
      ...result,
      venuesCreated,
    }
  })

// ============================================================================
// BA TOURISM VENUE ENRICHMENT
// ============================================================================

export interface BATourismEnrichmentInput {
  id: string
  link: string
}

export interface BATourismEnrichmentOutput {
  success: boolean
  enriched: number
  venuesCreated: number
  total: number
  errors: Array<{ id: string; error: string }>
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
 */
export const enrichBATourismVenuesAction = createServerFn({ method: 'POST' })
  .inputValidator((data: { events: BATourismEnrichmentInput[] }) => data)
  .handler(async ({ data }): Promise<BATourismEnrichmentOutput> => {
    const { events } = data

    if (events.length === 0) {
      return { success: true, enriched: 0, venuesCreated: 0, total: 0, errors: [] }
    }

    console.log(`[Admin] Starting BA Tourism venue enrichment for ${events.length} events...`)

    // Extract venue names from detail pages
    const extractionResults = await extractBATourismVenuesBatch(events, 500)

    let enriched = 0
    let venuesCreated = 0
    const errors: Array<{ id: string; error: string }> = []

    // Process each result
    for (const result of extractionResults) {
      if (result.error) {
        errors.push({ id: result.id, error: result.error })
        continue
      }

      if (!result.venueName) {
        errors.push({ id: result.id, error: 'Could not extract venue name from page' })
        continue
      }

      try {
        // Try to match to existing venue
        const venueMatch = await matchVenue(result.venueName)

        let venueId: string

        if (venueMatch.venue) {
          // Use existing venue
          venueId = venueMatch.venue.id
        } else {
          // Create new venue (with just the name since detail page doesn't have full address)
          const newVenue = await createVenue({
            name: result.venueName,
            neighborhood: null,
            address: null,
          })
          venueId = newVenue.id
          venuesCreated++
          console.log(`[Admin] Created new venue: ${result.venueName}`)
        }

        // Update event with venue_id
        await updateEvent(result.id, { venue_id: venueId })
        enriched++
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error'
        errors.push({ id: result.id, error: errorMsg })
      }
    }

    console.log(`[Admin] BA Tourism venue enrichment complete: ${enriched} enriched, ${venuesCreated} venues created, ${errors.length} errors`)

    return {
      success: true,
      enriched,
      venuesCreated,
      total: events.length,
      errors,
    }
  })
