/**
 * Autonomous Venue Settlement
 *
 * Handles venue matching and auto-creation for automated scraping jobs.
 * Uses a confidence-based approach:
 * - >= 0.85: Auto-use matched venue
 * - 0.60-0.84: Queue for admin review
 * - < 0.60 or no match: Auto-create with neighborhood lookup
 */
import { Data, Effect } from 'effect'
import type { SupabaseClient } from '@supabase/supabase-js'
import { matchVenueEffect, type VenueMatchResult } from '../scrapers/venue-matcher.ts'
import {
  lookupNeighborhoodTieredEffect,
  delayEffect,
  isAddressLikeVenueName,
  lookupBusinessAtAddressEffect,
} from './nominatim.ts'
import { NEIGHBORHOODS, type Venue, type Neighborhood, type VenueInsert } from '#shared/lib/types.ts'
import { importTry } from './effect-utils.ts'

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
 * Street name plus house number, so the catalog's messy formats compare equal: "Av. Corrientes N° 1530 - C.A.B.A.",
 * "Avenida Corrientes 1530, C1043AAB" and "Corrientes 1530" all give "corrientes 1530". The house number must follow
 * the street name, so "3 de Febrero" or "Av. 9 de Julio" alone has no key while "3 de Febrero 1378" does.
 */
export function addressKey(address: string | null | undefined): string | null {
  if (!address) return null
  const normalize = (value: string) => fold(value) // "N°" folds to "n°", so markers are matched after folding
    .replace(/\b(cp\s*)?[a-z]\d{4}[a-z]{0,3}\b|\bcp\s*\d{4}\b/g, ' ') // postal codes: C1043AAB, C1043, CP 1043
    .replace(/\b(numero|nro|num|n)\s*[.°º]*\s*(?=\d)/g, ' ') // number markers: N° 1530, nro. 1530
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\b(ciudad autonoma de buenos aires|cdad autonoma de buenos aires|ciudad de buenos aires|capital federal|c a b a|caba|buenos aires|argentina)\b/g, ' ')
    .replace(/\s+/g, ' ').trim()
  const plain = normalize(address)
  const street = (value: string) => value.replace(/^(avenida|avda|av|calle|pasaje|pje)\s+/, '')
  const parts = street(plain).match(/^(.*?\p{L}.*?)\s(\d{1,5})\b/u)
  if (parts) return `${parts[1]} ${parts[2]}`
  // Number first, as some ticket sites write it: "1660 Avenida Corrientes". "25 de Mayo" is a street name, not this.
  const first = normalize(address.split(',')[0]).match(/^(\d{1,5})\s(?!de\b)(\p{L}[\p{L} ]*)$/u)
  return first ? `${street(first[2])} ${first[1]}` : null
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
  client: SupabaseClient,
  venue: VenueInsert,
  addressCheckStatus: 'pending' | 'flagged' | 'not_flagged' = 'pending'
): Effect.Effect<Venue, VenueSettlementError> {
  return importTry('venue-settlement.create', () => client
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
  ).pipe(
    Effect.flatMap(({ data, error }) => error
      ? Effect.fail(settlementError('venue-settlement.create', `Failed to create venue: ${error.message}`, error))
      : data
        ? Effect.succeed(data as Venue)
        : Effect.fail(settlementError('venue-settlement.create', 'Failed to create venue'))
    ),
    Effect.mapError((error) => error instanceof VenueSettlementError
      ? error
      : settlementError(error.operation, error.message, error.cause))
  )
}

/**
 * Queue a venue for admin review.
 */
function queueVenueForReviewEffect(
  client: SupabaseClient,
  scrapeRunId: string | null,
  entry: VenueReviewQueueEntry
): Effect.Effect<void> {
  const queued = importTry('venue-settlement.queue-review', () => client
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
  ).pipe(
    Effect.flatMap(({ error }) => error
      ? Effect.fail(settlementError('venue-settlement.queue-review', error.message, error))
      : Effect.succeed(undefined)
    ),
    Effect.mapError((error) => error instanceof VenueSettlementError
      ? error
      : settlementError(error.operation, error.message, error.cause))
  )
  return Effect.catchEager(queued, (error) => {
    console.error('[venue-settlement] Failed to queue venue for review:', error)
    return Effect.succeed(undefined)
  })
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
export function settleVenueEffect(
  client: SupabaseClient,
  input: VenueSettlementInput,
  options: {
    source: string
    scrapeRunId?: string | null
    eventIds?: string[]
  }
): Effect.Effect<VenueSettlementResult, VenueSettlementError> {
  return Effect.gen(function* () {
    // Handle empty/null names
    if (!input.name || input.name.trim() === '') {
      return {
      venueId: null,
      action: 'skipped',
      confidence: 0,
      venueName: input.name || '',
      } satisfies VenueSettlementResult
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

  // A lone barrio is a venue only with evidence of a specific place: a street address with a house
  // number, coordinates, or an existing venue of exactly that name that has such an address.
    if (area === 'barrio' && !addressKey(input.address) && !input.coordinates) {
      const existing = yield* Effect.catchEager(
        matchVenueEffect(venueName, REVIEW_QUEUE_THRESHOLD, client),
        () => Effect.succeed(noVenueMatch(venueName))
      )
      if (existing.matchType === 'exact' && addressKey(existing.venue!.address)) {
        return {
        venueId: existing.venue!.id,
        action: 'matched',
        confidence: 1,
        method: 'exact',
        venueName: existing.venue!.name,
        neighborhood: existing.venue!.neighborhood,
        } satisfies VenueSettlementResult
      }
      console.log(`[venue-settlement] Barrio name without a specific place: "${venueName}"`)
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
    const match = yield* Effect.catchEager(
      matchVenueEffect(resolvedVenueName, REVIEW_QUEUE_THRESHOLD, client),
      () => Effect.succeed(noVenueMatch(resolvedVenueName))
    )

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

  // Low-confidence fuzzy match - queue for review
    if (match.matchType === 'fuzzy') {
      yield* queueVenueForReviewEffect(client, options.scrapeRunId || null, {
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
      } satisfies VenueSettlementResult
    }

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
    const newVenue = yield* createVenueEffect(client, {
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
    } satisfies VenueSettlementResult
  })
}

/** Promise compatibility adapter for Trigger tests and legacy scripts. */
export async function settleVenue(
  client: SupabaseClient,
  input: VenueSettlementInput,
  options: {
    source: string
    scrapeRunId?: string | null
    eventIds?: string[]
  }
): Promise<VenueSettlementResult> {
  try {
    return await Effect.runPromise(settleVenueEffect(client, input, options))
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error))
  }
}

/**
 * Settle multiple venues with rate limiting.
 * Returns a map from venue name to settlement result.
 */
export function settleVenuesEffect(
  client: SupabaseClient,
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
      const result = yield* settleVenueEffect(client, venue, options)
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
  try {
    return await Effect.runPromise(settleVenuesEffect(client, venues, options))
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
