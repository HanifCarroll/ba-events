/**
 * Autonomous Venue Settlement
 *
 * Handles venue matching and auto-creation for automated scraping jobs.
 * Uses a confidence-based approach:
 * - >= 0.85: Auto-use matched venue
 * - 0.60-0.84: Auto-create, and queue the lookalike for admin review
 * - < 0.60 or no match: Auto-create with neighborhood lookup
 */
import { Data, Effect } from 'effect'
import { findSameNameVenuesEffect, matchVenueEffect, type VenueMatchResult } from '../scrapers/venue-matcher.ts'
import { addressKey, pickVenue, trimVenueName } from './venue-identity.ts'
import {
  lookupNeighborhoodTieredEffect,
  delayEffect,
  isAddressLikeVenueName,
  lookupBusinessAtAddressEffect,
} from './nominatim.ts'
import { NEIGHBORHOODS, type Venue, type Neighborhood, type VenueInsert } from '#shared/lib/types.ts'
import { importTry } from './effect-utils.ts'
import type { CatalogStore } from './catalog-store.ts'

export { addressKey }

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

const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
// Barrios named after a real park: "Parque Chacabuco" is also a place you can hold an event in.
const PLACE_BARRIOS = new Set(['parque avellaneda', 'parque chacabuco', 'parque patricios'])
const BARRIO_WORDS = [...NEIGHBORHOODS.map(fold).filter(name => !PLACE_BARRIOS.has(name)), 'microcentro']
const CITY_WORDS = [
  'ciudad autonoma de buenos aires', 'cdad autonoma de buenos aires', 'provincia de buenos aires',
  'capital federal', 'buenos aires', 'caba', 'argentina', 'comuna \\d+',
]
const words = (list: string[]) => new RegExp(`\\b(?:${[...list].sort((a, b) => b.length - a.length).join('|')})\\b`, 'g')
const BARRIO_PATTERN = words(BARRIO_WORDS)
const CITY_PATTERN = new RegExp(`${words(CITY_WORDS).source}|\\b[a-z]\\d{4}[a-z]{0,3}\\b`, 'g')

/**
 * What a "venue" name is when it names only an area: `'city'` for a city, region,
 * or postal code ("Buenos Aires, Argentina", "C1437EFA C1437EFA, Argentina", "CABA"),
 * `'barrio'` when a barrio is in it ("Caballito", "Palermo, Buenos Aires"), and null
 * for anything else. Sources fill these in when the real address is hidden or unknown.
 */
export function areaOnlyVenueName(text: string | null | undefined): 'city' | 'barrio' | null {
  if (!text) return null
  const folded = fold(text).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  if (!folded) return null
  const withoutCity = folded.replace(CITY_PATTERN, ' ').trim()
  if (!withoutCity) return 'city'
  return withoutCity.replace(BARRIO_PATTERN, ' ').trim() ? null : 'barrio'
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

export class VenueSettlementError extends Data.TaggedError('VenueSettlementError')<{
  readonly operation: string
  readonly message: string
  readonly cause?: unknown
}> {}

const settlementError = (operation: string, message: string, cause?: unknown) =>
  new VenueSettlementError({ operation, message, cause })

const settlementDelay = (ms: number) => delayEffect(ms).pipe(
  Effect.mapError((error) => settlementError('venue-settlement.delay', error.message, error))
)

const noVenueMatch = (searchName: string): VenueMatchResult => ({
  venue: null,
  matchType: 'none',
  confidence: 0,
  searchName,
})

// ============================================================================
// VENUE CREATION
// ============================================================================

/**
 * Create a new venue with the given data.
 */
function createVenueEffect(
  catalog: CatalogStore,
  venue: VenueInsert,
  addressCheckStatus: 'pending' | 'flagged' | 'not_flagged' = 'pending'
): Effect.Effect<Venue, VenueSettlementError> {
  return importTry('venue-settlement.create', () => catalog.createVenue({
    name: venue.name,
    address: venue.address || null,
    neighborhood: venue.neighborhood || null,
    enrichment_status: 'pending',
    address_check_status: addressCheckStatus,
  })).pipe(Effect.mapError((error) => settlementError(error.operation, error.message, error.cause)))
}

/**
 * Queue a venue for admin review.
 */
function queueVenueForReviewEffect(
  catalog: CatalogStore,
  scrapeRunId: string | null,
  entry: VenueReviewQueueEntry
): Effect.Effect<void> {
  const queued = importTry('venue-settlement.queue-review', () => catalog.queueVenueReview({
    scrape_run_id: scrapeRunId,
    source: entry.source,
    source_venue_name: entry.source_venue_name,
    source_address: entry.source_address,
    source_coordinates: entry.source_coordinates,
    best_match_venue_id: entry.best_match_venue_id,
    match_confidence: entry.match_confidence,
    source_event_ids: entry.source_event_ids || [],
    status: 'pending',
  }))
  return Effect.catchEager(queued, (error) => {
    console.error('[venue-settlement] Failed to queue venue for review:', error)
    return Effect.undefined
  })
}

// ============================================================================
// MAIN SETTLEMENT FUNCTION
// ============================================================================

/**
 * Settle a venue: match to existing, auto-create, or queue for review.
 *
 * Decision logic:
 * 1. Try exact match (confidence = 1.0) → use it; several same-name venues → `pickVenue`
 * 2. Try fuzzy match:
 *    - confidence >= 0.85 → auto-use
 *    - confidence 0.6-0.84 → auto-create, and queue the lookalike for review (never attach it)
 *    - a fuzzy match at another street and number than the event's → no match
 *    - confidence < 0.6 or no match → auto-create
 * 3. For auto-create: lookup neighborhood using tiered approach
 */
export function settleVenueEffect(
  catalog: CatalogStore,
  input: VenueSettlementInput,
  options: {
    source: string
    scrapeRunId?: string | null
    eventIds?: string[]
  }
): Effect.Effect<VenueSettlementResult, VenueSettlementError> {
  return Effect.gen(function* () {
    const venueName = trimVenueName(input.name ?? '')
    if (!venueName) {
      return {
      venueId: null,
      action: 'skipped',
      confidence: 0,
      venueName: input.name || '',
      } satisfies VenueSettlementResult
    }

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
      } satisfies VenueSettlementResult
    }

  // Check for garbage/invalid venue names (AI-generated explanations, etc.)
  // and names that are only a city, region, or postal code. These should not create or match venues.
    const area = areaOnlyVenueName(venueName)
    if (isGarbageVenueName(venueName) || area === 'city') {
      console.log(`[venue-settlement] Detected garbage venue name: "${venueName}"`)
      return {
      venueId: null,
      action: 'skipped',
      confidence: 0,
      venueName,
      } satisfies VenueSettlementResult
    }

  // A barrio-named venue ("San Telmo") is identified by its street address, never by its name:
  // the event must carry its own numbered address, and only a same-name venue at that street and
  // number is reused. Name-only matching once pooled unrelated events under one barrio venue.
    const barrioAddress = area === 'barrio' ? addressKey(input.address) : null
    if (area === 'barrio' && !barrioAddress) {
      console.log(`[venue-settlement] Barrio name without its own street address: "${venueName}"`)
      return {
      venueId: null,
      action: 'skipped',
      confidence: 0,
      venueName,
      } satisfies VenueSettlementResult
    }

  // Check if venue name looks like a street address
    const isAddressLike = isAddressLikeVenueName(venueName)
    let resolvedVenueName = venueName
    let addressLookupNeighborhood: Neighborhood | null = null

    if (isAddressLike) {
      console.log(`[venue-settlement] Detected address-like venue name: "${venueName}", looking up business...`)

    // Rate limit: wait before Nominatim call
      yield* settlementDelay(1000)

    // Try to find the real business name at this address via Nominatim
      const businessLookup = yield* lookupBusinessAtAddressEffect(venueName).pipe(
        Effect.mapError((error) => settlementError('venue-settlement.business-lookup', error.message, error))
      )

      const businessName = trimVenueName(businessLookup.name ?? '')
      if (businessName) {
        console.log(`[venue-settlement] Found business "${businessName}" at address "${venueName}"`)
        resolvedVenueName = businessName
        addressLookupNeighborhood = businessLookup.neighborhood
      } else {
        console.log(`[venue-settlement] No business found at address "${venueName}", will use address as venue name`)
        addressLookupNeighborhood = businessLookup.neighborhood
      }
    }

    // Step 1: Try matching against existing venues (using resolved name if address was looked up)
    // A failed lookup can't tell whether the venue exists; leave the event unlinked rather than create a duplicate.
    const lookupFailed = { venueId: null, action: 'skipped', confidence: 0, venueName } satisfies VenueSettlementResult
    let match: VenueMatchResult
    if (barrioAddress) {
      const sameName = yield* Effect.result(findSameNameVenuesEffect(venueName, catalog))
      if (sameName._tag === 'Failure') return lookupFailed
      const atAddress = sameName.success.filter(venue => addressKey(venue.address) === barrioAddress)
      match = atAddress.length
        ? { venue: pickVenue(atAddress)!, matchType: 'exact', confidence: 1, searchName: venueName }
        : noVenueMatch(venueName)
    } else {
      const found = yield* Effect.result(matchVenueEffect(resolvedVenueName, REVIEW_QUEUE_THRESHOLD, catalog, input.address))
      if (found._tag === 'Failure') {
        console.error(`[venue-settlement] Venue lookup failed for "${resolvedVenueName}":`, found.failure.message)
        return lookupFailed
      }
      match = found.success
      // An existing venue named only after an area counts only at this event's own street and number.
      const inputAddress = addressKey(input.address)
      if (match.venue && areaOnlyVenueName(match.venue.name) && (!inputAddress || addressKey(match.venue.address) !== inputAddress)) {
        match = noVenueMatch(resolvedVenueName)
      }
      // A similar name at another street and number is another place.
      const matchAddress = addressKey(match.venue?.address)
      if (match.matchType === 'fuzzy' && inputAddress && matchAddress && matchAddress !== inputAddress) {
        match = noVenueMatch(resolvedVenueName)
      }
    }

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
      } satisfies VenueSettlementResult
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
      } satisfies VenueSettlementResult
    }

  // Low-confidence fuzzy match: a different name that may or may not be the same place ("Centro Cultural Raíces" and
  // "Centro Cultural" score 0.68). Never attach it; create this venue as with no match and queue the lookalike for review.
  // The next import finds the new venue by its exact name, so each name is queued once.
    const lookalike = match.matchType === 'fuzzy' ? match : null

  // No match - auto-create with neighborhood lookup
  console.log(`[venue-settlement] No match for "${resolvedVenueName}", looking up neighborhood...`)

  // Use neighborhood from address lookup if available, otherwise do tiered lookup
    let neighborhood: Neighborhood | null = addressLookupNeighborhood
    let method: string = 'address-lookup'

    if (!neighborhood) {
      const lookup = yield* lookupNeighborhoodTieredEffect({
      venueName: resolvedVenueName,
      neighborhood: input.neighborhood,
      coordinates: input.coordinates,
      address: input.address,
      }).pipe(
        Effect.mapError((error) => settlementError('venue-settlement.neighborhood-lookup', error.message, error))
      )
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
    const newVenue = yield* createVenueEffect(catalog, {
    name: resolvedVenueName,
    address: addressToStore,
    neighborhood: neighborhood,
    }, addressCheckStatus)

  if (isAddressLike && resolvedVenueName !== venueName) {
    console.log(`[venue-settlement] Created venue "${resolvedVenueName}" (resolved from address "${venueName}") with neighborhood: ${neighborhood || 'unknown'}`)
  } else {
    console.log(`[venue-settlement] Created venue "${resolvedVenueName}" with neighborhood: ${neighborhood || 'unknown'}`)
  }

    if (lookalike) {
      yield* queueVenueForReviewEffect(catalog, options.scrapeRunId || null, {
      source: options.source,
      source_venue_name: venueName, // Original name for review context
      source_address: input.address,
      source_coordinates: input.coordinates,
      best_match_venue_id: lookalike.venue?.id,
      match_confidence: lookalike.confidence,
      source_event_ids: options.eventIds,
      })
    }

    return {
    venueId: newVenue.id,
    action: lookalike ? 'queued-review' : 'auto-created',
    confidence: neighborhood ? 0.8 : 0.5, // Higher confidence if we found neighborhood
    method: method as VenueSettlementResult['method'],
    venueName: resolvedVenueName,
    neighborhood,
    } satisfies VenueSettlementResult
  })
}

/** Promise compatibility adapter for Trigger tests and legacy scripts. */
export async function settleVenue(
  catalog: CatalogStore,
  input: VenueSettlementInput,
  options: {
    source: string
    scrapeRunId?: string | null
    eventIds?: string[]
  }
): Promise<VenueSettlementResult> {
  try {
    return await Effect.runPromise(settleVenueEffect(catalog, input, options))
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error))
  }
}

/**
 * Key for batch settlement results: the name plus its normalized street and number, so two events in one import that
 * share a venue name but not an address are settled separately and never share a venue by name alone.
 * Importers pass one input per event and look each event up with its own name and address.
 */
export function venueSettlementKey(name: string, address: string | null | undefined): string {
  return `${trimVenueName(name).toLowerCase()}\u0000${addressKey(address) ?? ''}`
}

/**
 * Settle multiple venues with rate limiting.
 * Returns a map from `venueSettlementKey` to settlement result.
 */
export function settleVenuesEffect(
  catalog: CatalogStore,
  venues: VenueSettlementInput[],
  options: {
    source: string
    scrapeRunId?: string | null
  }
): Effect.Effect<{
  results: Map<string, VenueSettlementResult>
  stats: VenueSettlementStats
}, VenueSettlementError> {
  return Effect.gen(function* () {
    const results = new Map<string, VenueSettlementResult>()
    const stats: VenueSettlementStats = {
    matched: 0,
    autoCreated: 0,
    queuedReview: 0,
    skipped: 0,
    placeholder: 0,
    }

  // Dedupe venues by settlement key (name plus street and number)
    const uniqueVenues = new Map<string, VenueSettlementInput>()
    for (const venue of venues) {
      if (venue.name && venue.name.trim()) {
        const key = venueSettlementKey(venue.name, venue.address)
        if (!uniqueVenues.has(key)) {
          uniqueVenues.set(key, venue)
        }
      }
    }

  console.log(`[venue-settlement] Settling ${uniqueVenues.size} unique venues...`)

    let i = 0
    for (const [, venue] of uniqueVenues) {
      const result = yield* settleVenueEffect(catalog, venue, options)
      results.set(venueSettlementKey(venue.name, venue.address), result)

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
      if ((result.action === 'auto-created' || result.action === 'queued-review') && i < uniqueVenues.size - 1) {
        yield* settlementDelay(1000) // 1 second between Nominatim calls
      }

      i++
    }

    console.log(
      `[venue-settlement] Completed: ${stats.matched} matched, ${stats.autoCreated} created, ${stats.queuedReview} queued, ${stats.skipped} skipped, ${stats.placeholder} placeholder`
    )

    return { results, stats }
  })
}

export async function settleVenues(
  catalog: CatalogStore,
  venues: VenueSettlementInput[],
  options: {
    source: string
    scrapeRunId?: string | null
  }
): Promise<{
  results: Map<string, VenueSettlementResult>
  stats: VenueSettlementStats
}> {
  try {
    return await Effect.runPromise(settleVenuesEffect(catalog, venues, options))
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error))
  }
}

/**
 * Get venue ID from settlement results by venue name.
 * Returns null if not found.
 */
export function getVenueIdFromResults(
  results: Map<string, VenueSettlementResult>,
  venueName: string | null | undefined,
  address?: string | null
): string | null {
  if (!venueName) return null
  const key = venueSettlementKey(venueName, address)
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
  venueName: string | null | undefined,
  address?: string | null
): Neighborhood | null {
  if (!venueName) return null
  const key = venueSettlementKey(venueName, address)
  return results.get(key)?.neighborhood ?? null
}

/**
 * Check if a venue name was detected as a placeholder (e.g., "TBA", "Register to See Address")
 * during venue settlement. Use this to set location_tba or location_hidden on events.
 */
export function isPlaceholderResult(
  results: Map<string, VenueSettlementResult>,
  venueName: string | null | undefined,
  address?: string | null
): boolean {
  if (!venueName) return false
  const key = venueSettlementKey(venueName, address)
  const result = results.get(key)
  return result?.action === 'placeholder'
}
