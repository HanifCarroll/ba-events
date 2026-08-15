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
import {
  lookupNeighborhoodTiered,
  delay,
  isAddressLikeVenueName,
  lookupBusinessAtAddress,
} from './nominatim'
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

/**
 * Patterns that indicate a placeholder address rather than a real venue.
 * These are shown by event platforms when the host hides the address until registration.
 */
const PLACEHOLDER_PATTERNS = [
  /register\s*(to\s*)?see\s*address/i,
  /address\s*(to\s*be\s*)?(confirmed|tba|tbd)/i,
  /location\s*(to\s*be\s*)?(confirmed|tba|tbd|announced)/i,
  /^tba$/i,
  /^tbd$/i,
  /^to\s*be\s*(announced|confirmed|determined)$/i,
]

/**
 * Patterns that indicate garbage/invalid venue names.
 * These catch AI-generated explanatory text that slipped through extraction.
 */
const GARBAGE_VENUE_PATTERNS = [
  /^null\b/i,                           // Starts with "null" (AI saying no venue)
  /no\s*(specific\s*)?(physical\s*)?venue/i,  // "no venue", "no specific venue", etc.
  /needs\s*a\s*location/i,              // "Needs a location"
  /location\s*(field|section)/i,        // "location field", "location section"
  /the\s*event\s*page/i,                // "The event page shows..."
  /not\s*been\s*(specified|designated|assigned)/i,  // "has not been specified"
  /n\/a/i,                              // "N/A"
  /^online\s*event$/i,                  // "Online event"
  /^virtual$/i,                         // "Virtual"
]

/**
 * Check if a venue name or address is a placeholder (not a real location).
 * Returns true for text like "Register to See Address", "TBA", etc.
 */
export function isPlaceholderVenue(text: string | null | undefined): boolean {
  if (!text) return false
  const trimmed = text.trim()
  if (!trimmed) return false
  return PLACEHOLDER_PATTERNS.some(pattern => pattern.test(trimmed))
}

/**
 * Check if a venue name is garbage/invalid (AI-generated explanation, not a real venue).
 * Returns true for text like "null The event page...", "No specific venue", etc.
 */
export function isGarbageVenueName(text: string | null | undefined): boolean {
  if (!text) return true // Empty is garbage
  const trimmed = text.trim()
  if (!trimmed) return true

  // Too short to be a real venue name
  if (trimmed.length < 3) return true

  // Too long - real venue names are rarely over 100 chars
  if (trimmed.length > 150) return true

  // Check garbage patterns
  return GARBAGE_VENUE_PATTERNS.some(pattern => pattern.test(trimmed))
}

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
  action: 'matched' | 'auto-created' | 'queued-review' | 'skipped' | 'placeholder'
  confidence: number
  method?: 'exact' | 'fuzzy' | 'coordinates' | 'address' | 'name-only' | 'direct'
  venueName: string
  neighborhood?: Neighborhood | null
  /** True if the venue name/address was detected as a placeholder (e.g., "Register to See Address") */
  isPlaceholder?: boolean
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
  placeholder: number
}

// ============================================================================
// VENUE CREATION
// ============================================================================

/**
 * Create a new venue with the given data.
 */
async function createVenue(
  client: SupabaseClient,
  venue: VenueInsert,
  addressCheckStatus: 'pending' | 'flagged' | 'not_flagged' = 'pending'
): Promise<Venue> {
  const { data, error } = await client
    .from('venues')
    .insert({
      name: venue.name,
      address: venue.address || null,
      neighborhood: venue.neighborhood || null,
      enrichment_status: 'pending',
      address_check_status: addressCheckStatus,
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

  // Check for placeholder addresses (e.g., "Register to See Address")
  // These should not create venues - the event should be marked with location_hidden instead
  if (isPlaceholderVenue(venueName) || isPlaceholderVenue(input.address)) {
    console.log(`[venue-settlement] Detected placeholder venue: "${venueName}"`)
    return {
      venueId: null,
      action: 'placeholder',
      confidence: 0,
      venueName,
      isPlaceholder: true,
    }
  }

  // Check for garbage/invalid venue names (AI-generated explanations, etc.)
  // These should not create venues
  if (isGarbageVenueName(venueName)) {
    console.log(`[venue-settlement] Detected garbage venue name: "${venueName}"`)
    return {
      venueId: null,
      action: 'skipped',
      confidence: 0,
      venueName,
    }
  }

  // Check if venue name looks like a street address
  const isAddressLike = isAddressLikeVenueName(venueName)
  let resolvedVenueName = venueName
  let addressLookupNeighborhood: Neighborhood | null = null

  if (isAddressLike) {
    console.log(`[venue-settlement] Detected address-like venue name: "${venueName}", looking up business...`)

    // Rate limit: wait before Nominatim call
    await delay(1000)

    // Try to find the real business name at this address via Nominatim
    const businessLookup = await lookupBusinessAtAddress(venueName)

    if (businessLookup.name) {
      console.log(`[venue-settlement] Found business "${businessLookup.name}" at address "${venueName}"`)
      resolvedVenueName = businessLookup.name
      addressLookupNeighborhood = businessLookup.neighborhood
    } else {
      console.log(`[venue-settlement] No business found at address "${venueName}", will use address as venue name`)
      addressLookupNeighborhood = businessLookup.neighborhood
    }
  }

  // Step 1: Try matching against existing venues (using resolved name if address was looked up)
  const match = await matchVenue(resolvedVenueName, REVIEW_QUEUE_THRESHOLD)

  // Exact match - use it immediately
  if (match.matchType === 'exact') {
    if (isAddressLike && resolvedVenueName !== venueName) {
      console.log(`[venue-settlement] Address "${venueName}" resolved to existing venue "${match.venue!.name}"`)
    }
    return {
      venueId: match.venue!.id,
      action: 'matched',
      confidence: 1,
      method: 'exact',
      venueName: match.venue!.name, // Use the matched venue's actual name
      neighborhood: match.venue!.neighborhood,
    }
  }

  // High-confidence fuzzy match - auto-use
  if (match.matchType === 'fuzzy' && match.confidence >= AUTO_USE_THRESHOLD) {
    if (isAddressLike) {
      console.log(`[venue-settlement] Address "${venueName}" fuzzy-matched to existing venue "${match.venue!.name}"`)
    }
    return {
      venueId: match.venue!.id,
      action: 'matched',
      confidence: match.confidence,
      method: 'fuzzy',
      venueName: match.venue!.name, // Use the matched venue's actual name
      neighborhood: match.venue!.neighborhood,
    }
  }

  // Low-confidence fuzzy match - queue for review
  if (match.matchType === 'fuzzy') {
    await queueVenueForReview(client, options.scrapeRunId || null, {
      source: options.source,
      source_venue_name: venueName, // Original name for review context
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
      venueName: match.venue!.name,
      neighborhood: match.venue!.neighborhood,
    }
  }

  // No match - auto-create with neighborhood lookup
  console.log(`[venue-settlement] No match for "${resolvedVenueName}", looking up neighborhood...`)

  // Use neighborhood from address lookup if available, otherwise do tiered lookup
  let neighborhood: Neighborhood | null = addressLookupNeighborhood
  let method: string = 'address-lookup'

  if (!neighborhood) {
    const lookup = await lookupNeighborhoodTiered({
      venueName: resolvedVenueName,
      neighborhood: input.neighborhood,
      coordinates: input.coordinates,
      address: input.address,
    })
    neighborhood = lookup.neighborhood
    method = lookup.method
  }

  // Determine the address to store
  // If we resolved an address-like name to a business, use the original address
  const addressToStore = isAddressLike ? venueName : (input.address || null)

  // Determine address_check_status based on what happened:
  // - Resolved address to business name → 'not_flagged' (proper name now)
  // - Address-like but no business found → 'flagged' (needs admin review)
  // - Not address-like → 'not_flagged' (already a proper name)
  const addressCheckStatus = isAddressLike
    ? (resolvedVenueName !== venueName ? 'not_flagged' : 'flagged')
    : 'not_flagged'

  // Create the venue with the resolved name
  const newVenue = await createVenue(client, {
    name: resolvedVenueName,
    address: addressToStore,
    neighborhood: neighborhood,
  }, addressCheckStatus)

  if (isAddressLike && resolvedVenueName !== venueName) {
    console.log(`[venue-settlement] Created venue "${resolvedVenueName}" (resolved from address "${venueName}") with neighborhood: ${neighborhood || 'unknown'}`)
  } else {
    console.log(`[venue-settlement] Created venue "${resolvedVenueName}" with neighborhood: ${neighborhood || 'unknown'}`)
  }

  return {
    venueId: newVenue.id,
    action: 'auto-created',
    confidence: neighborhood ? 0.8 : 0.5, // Higher confidence if we found neighborhood
    method: method as VenueSettlementResult['method'],
    venueName: resolvedVenueName,
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
    placeholder: 0,
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
      case 'placeholder':
        stats.placeholder++
        break
    }

    // Rate limiting for API calls (only needed if we hit Nominatim)
    if (result.action === 'auto-created' && i < uniqueVenues.size - 1) {
      await delay(1000) // 1 second between Nominatim calls
    }

    i++
  }

  console.log(
    `[venue-settlement] Completed: ${stats.matched} matched, ${stats.autoCreated} created, ${stats.queuedReview} queued, ${stats.skipped} skipped, ${stats.placeholder} placeholder`
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

/**
 * Get the settled venue neighborhood from settlement results by venue name.
 * Returns null when the venue was matched to an existing row (whose neighborhood
 * lives on the venues table) or auto-created without a resolved CABA
 * neighborhood. Callers that prefer the settled neighborhood over a source-side
 * city value (Meeting/Luma pass the city, not a CABA neighborhood) should use
 * this to feed the canonical search document.
 */
export function getVenueNeighborhoodFromResults(
  results: Map<string, VenueSettlementResult>,
  venueName: string | null | undefined
): Neighborhood | null {
  if (!venueName) return null
  const key = venueName.trim().toLowerCase()
  return results.get(key)?.neighborhood ?? null
}

/**
 * Check if a venue name was detected as a placeholder (e.g., "TBA", "Register to See Address")
 * during venue settlement. Use this to set location_tba or location_hidden on events.
 */
export function isPlaceholderResult(
  results: Map<string, VenueSettlementResult>,
  venueName: string | null | undefined
): boolean {
  if (!venueName) return false
  const key = venueName.trim().toLowerCase()
  const result = results.get(key)
  return result?.action === 'placeholder'
}
