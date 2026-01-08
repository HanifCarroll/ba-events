/**
 * Autonomous Venue Settlement
 *
 * Handles venue matching and auto-creation for automated scraping jobs.
 * Uses a confidence-based approach:
 * - >= 0.85: Auto-use matched venue
 * - 0.60-0.84: Queue for admin review
 * - < 0.60 or no match: Auto-create with neighborhood lookup
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { matchVenue } from '../scrapers/venue-matcher'
import { lookupNeighborhoodTiered, delay } from './nominatim'
import type { Venue, Neighborhood, VenueInsert } from '@/shared/lib/types'

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Minimum confidence threshold for auto-using a fuzzy match.
 * Matches at or above this threshold are automatically used.
 * Matches below this but above 0.6 are queued for admin review.
 */
export const AUTO_USE_THRESHOLD = 0.85

/**
 * Minimum confidence threshold for queuing for review.
 * Matches below this are treated as "no match" and trigger auto-creation.
 */
export const REVIEW_QUEUE_THRESHOLD = 0.6

// ============================================================================
// TYPES
// ============================================================================

export interface VenueSettlementInput {
  name: string
  address?: string | null
  neighborhood?: string | null  // Direct neighborhood (BA Tourism)
  coordinates?: { lat: number; lng: number } | null
}

export interface VenueSettlementResult {
  venueId: string | null
  action: 'matched' | 'auto-created' | 'queued-review' | 'skipped'
  confidence: number
  method?: 'exact' | 'fuzzy' | 'coordinates' | 'address' | 'name-only' | 'direct'
  venueName: string
  neighborhood?: Neighborhood | null
}

export interface VenueReviewQueueEntry {
  source: string
  source_venue_name: string
  source_address?: string | null
  source_coordinates?: { lat: number; lng: number } | null
  best_match_venue_id?: string | null
  match_confidence: number
  source_event_ids?: string[]
}

export interface VenueSettlementStats {
  matched: number
  autoCreated: number
  queuedReview: number
  skipped: number
}

// ============================================================================
// VENUE CREATION
// ============================================================================

/**
 * Create a new venue with the given data.
 */
async function createVenue(
  client: SupabaseClient,
  venue: VenueInsert
): Promise<Venue> {
  const { data, error } = await client
    .from('venues')
    .insert({
      name: venue.name,
      address: venue.address || null,
      neighborhood: venue.neighborhood || null,
      enrichment_status: 'pending',
    })
    .select()
    .single()

  if (error) {
    throw new Error(`Failed to create venue: ${error.message}`)
  }

  return data as Venue
}

/**
 * Queue a venue for admin review.
 */
async function queueVenueForReview(
  client: SupabaseClient,
  scrapeRunId: string | null,
  entry: VenueReviewQueueEntry
): Promise<void> {
  const { error } = await client
    .from('venue_review_queue')
    .insert({
      scrape_run_id: scrapeRunId,
      source: entry.source,
      source_venue_name: entry.source_venue_name,
      source_address: entry.source_address,
      source_coordinates: entry.source_coordinates,
      best_match_venue_id: entry.best_match_venue_id,
      match_confidence: entry.match_confidence,
      source_event_ids: entry.source_event_ids || [],
      status: 'pending',
    })

  if (error) {
    console.error('[venue-settlement] Failed to queue venue for review:', error)
  }
}

// ============================================================================
// MAIN SETTLEMENT FUNCTION
// ============================================================================

/**
 * Settle a venue: match to existing, auto-create, or queue for review.
 *
 * Decision logic:
 * 1. Try exact match (confidence = 1.0) → use it
 * 2. Try fuzzy match:
 *    - confidence >= 0.85 → auto-use
 *    - confidence 0.6-0.84 → queue for review
 *    - confidence < 0.6 or no match → auto-create
 * 3. For auto-create: lookup neighborhood using tiered approach
 */
export async function settleVenue(
  client: SupabaseClient,
  input: VenueSettlementInput,
  options: {
    source: string
    scrapeRunId?: string | null
    eventIds?: string[]
  }
): Promise<VenueSettlementResult> {
  // Handle empty/null names
  if (!input.name || input.name.trim() === '') {
    return {
      venueId: null,
      action: 'skipped',
      confidence: 0,
      venueName: input.name || '',
    }
  }

  const venueName = input.name.trim()

  // Step 1: Try matching against existing venues
  const match = await matchVenue(venueName, REVIEW_QUEUE_THRESHOLD)

  // Exact match - use it immediately
  if (match.matchType === 'exact') {
    return {
      venueId: match.venue!.id,
      action: 'matched',
      confidence: 1,
      method: 'exact',
      venueName,
    }
  }

  // High-confidence fuzzy match - auto-use
  if (match.matchType === 'fuzzy' && match.confidence >= AUTO_USE_THRESHOLD) {
    return {
      venueId: match.venue!.id,
      action: 'matched',
      confidence: match.confidence,
      method: 'fuzzy',
      venueName,
    }
  }

  // Low-confidence fuzzy match - queue for review
  if (match.matchType === 'fuzzy') {
    await queueVenueForReview(client, options.scrapeRunId || null, {
      source: options.source,
      source_venue_name: venueName,
      source_address: input.address,
      source_coordinates: input.coordinates,
      best_match_venue_id: match.venue?.id,
      match_confidence: match.confidence,
      source_event_ids: options.eventIds,
    })

    // Still use the fuzzy match for now, but flag for review
    return {
      venueId: match.venue!.id,
      action: 'queued-review',
      confidence: match.confidence,
      method: 'fuzzy',
      venueName,
    }
  }

  // No match - auto-create with neighborhood lookup
  console.log(`[venue-settlement] No match for "${venueName}", looking up neighborhood...`)

  const { neighborhood, method } = await lookupNeighborhoodTiered({
    venueName,
    neighborhood: input.neighborhood,
    coordinates: input.coordinates,
    address: input.address,
  })

  // Create the venue
  const newVenue = await createVenue(client, {
    name: venueName,
    address: input.address || null,
    neighborhood: neighborhood,
  })

  console.log(`[venue-settlement] Created venue "${venueName}" with neighborhood: ${neighborhood || 'unknown'}`)

  return {
    venueId: newVenue.id,
    action: 'auto-created',
    confidence: neighborhood ? 0.8 : 0.5, // Higher confidence if we found neighborhood
    method: method as VenueSettlementResult['method'],
    venueName,
    neighborhood,
  }
}

/**
 * Settle multiple venues with rate limiting.
 * Returns a map from venue name to settlement result.
 */
export async function settleVenues(
  client: SupabaseClient,
  venues: VenueSettlementInput[],
  options: {
    source: string
    scrapeRunId?: string | null
  }
): Promise<{
  results: Map<string, VenueSettlementResult>
  stats: VenueSettlementStats
}> {
  const results = new Map<string, VenueSettlementResult>()
  const stats: VenueSettlementStats = {
    matched: 0,
    autoCreated: 0,
    queuedReview: 0,
    skipped: 0,
  }

  // Dedupe venues by name
  const uniqueVenues = new Map<string, VenueSettlementInput>()
  for (const venue of venues) {
    if (venue.name && venue.name.trim()) {
      const key = venue.name.trim().toLowerCase()
      if (!uniqueVenues.has(key)) {
        uniqueVenues.set(key, venue)
      }
    }
  }

  console.log(`[venue-settlement] Settling ${uniqueVenues.size} unique venues...`)

  let i = 0
  for (const [, venue] of uniqueVenues) {
    const result = await settleVenue(client, venue, options)
    results.set(venue.name.trim().toLowerCase(), result)

    // Update stats
    switch (result.action) {
      case 'matched':
        stats.matched++
        break
      case 'auto-created':
        stats.autoCreated++
        break
      case 'queued-review':
        stats.queuedReview++
        break
      case 'skipped':
        stats.skipped++
        break
    }

    // Rate limiting for API calls (only needed if we hit Nominatim)
    if (result.action === 'auto-created' && i < uniqueVenues.size - 1) {
      await delay(1000) // 1 second between Nominatim calls
    }

    i++
  }

  console.log(
    `[venue-settlement] Completed: ${stats.matched} matched, ${stats.autoCreated} created, ${stats.queuedReview} queued, ${stats.skipped} skipped`
  )

  return { results, stats }
}

/**
 * Get venue ID from settlement results by venue name.
 * Returns null if not found.
 */
export function getVenueIdFromResults(
  results: Map<string, VenueSettlementResult>,
  venueName: string | null | undefined
): string | null {
  if (!venueName) return null
  const key = venueName.trim().toLowerCase()
  return results.get(key)?.venueId || null
}
