/**
 * Venue Matcher Utility
 *
 * Matches venue names from external sources to existing venues in the database.
 * Uses a three-tier approach: exact match, fuzzy match, no match.
 */

import { Data, Effect } from 'effect'
import { getSupabase, type SupabaseClient } from '#shared/lib/db/client.server.ts'
import type { Venue } from '#shared/lib/types.ts'
import { importTry } from '../core/effect-utils.ts'

export interface VenueMatchResult {
  venue: Venue | null
  matchType: 'exact' | 'fuzzy' | 'none'
  confidence: number // 0-1, 1 being perfect match
  searchName: string // Original search name
}

export class VenueMatchError extends Data.TaggedError('VenueMatchError')<{
  readonly operation: string
  readonly message: string
  readonly cause?: unknown
}> {}

/**
 * Normalize a venue name for comparison
 * - Lowercase
 * - Remove extra whitespace
 * - Remove common suffixes
 */
function normalizeVenueName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\s*-\s*buenos aires$/i, '')
    .replace(/\s*-\s*caba$/i, '')
    .replace(/\s*-\s*argentina$/i, '')
}

/**
 * Find a venue by exact name match (case-insensitive)
 */
function findExactMatchEffect(venueName: string, client?: SupabaseClient) {
  const normalized = normalizeVenueName(venueName)

  return importTry('venue-matcher.exact', () => (client ?? getSupabase())
    .from('venues')
    .select('*')
    .ilike('name', normalized)
    .limit(1)
    .single()
  ).pipe(
    Effect.map(({ data, error }) => (error || !data ? null : data as Venue)),
    Effect.mapError((error) => new VenueMatchError({
      operation: error.operation,
      message: error.message,
      cause: error.cause,
    }))
  )
}

/**
 * Find a venue by fuzzy match using pg_trgm
 */
function findFuzzyMatchEffect(
  venueName: string,
  threshold: number = 0.6,
  client?: SupabaseClient
): Effect.Effect<{ venue: Venue; similarity: number } | null, VenueMatchError> {
  const db = client ?? getSupabase()
  return Effect.gen(function* () {
    const { data, error } = yield* importTry('venue-matcher.fuzzy-rpc', () => db.rpc('find_similar_venue', {
      search_name: venueName,
      similarity_threshold: threshold,
    })).pipe(Effect.mapError((cause) => new VenueMatchError({
      operation: cause.operation,
      message: cause.message,
      cause: cause.cause,
    })))

    if (error || !data || data.length === 0) return null

    const match = data[0]
    const { data: venue, error: venueError } = yield* importTry('venue-matcher.fuzzy-venue', () => db
      .from('venues')
      .select('*')
      .eq('id', match.id)
      .single()
    ).pipe(Effect.mapError((cause) => new VenueMatchError({
      operation: cause.operation,
      message: cause.message,
      cause: cause.cause,
    })))

    if (venueError || !venue) return null
    return { venue: venue as Venue, similarity: match.similarity }
  })
}

/**
 * Match a venue name to an existing venue in the database
 *
 * Strategy:
 * 1. Try exact match (normalized, case-insensitive)
 * 2. Try fuzzy match using pg_trgm with similarity threshold
 * 3. Return no match if nothing found
 */
export function matchVenueEffect(
  venueName: string,
  fuzzyThreshold: number = 0.6,
  client?: SupabaseClient
): Effect.Effect<VenueMatchResult, VenueMatchError> {
  // Handle empty/null names
  if (!venueName || venueName.trim() === '') {
    return Effect.succeed({
      venue: null,
      matchType: 'none',
      confidence: 0,
      searchName: venueName || '',
    })
  }

  const searchName = venueName.trim()

  return Effect.gen(function* () {
    // Try exact match first
    const exactMatch = yield* findExactMatchEffect(searchName, client)
    if (exactMatch) {
      return {
        venue: exactMatch,
        matchType: 'exact' as const,
        confidence: 1,
        searchName,
      }
    }

    // Try fuzzy match
    const fuzzyMatch = yield* findFuzzyMatchEffect(searchName, fuzzyThreshold, client)
    if (fuzzyMatch) {
      return {
        venue: fuzzyMatch.venue,
        matchType: 'fuzzy' as const,
        confidence: fuzzyMatch.similarity,
        searchName,
      }
    }

    return {
      venue: null,
      matchType: 'none' as const,
      confidence: 0,
      searchName,
    }
  })
}

/** Promise compatibility adapter; legacy matching treats lookup errors as no match. */
export async function matchVenue(
  venueName: string,
  fuzzyThreshold: number = 0.6,
  client?: SupabaseClient
): Promise<VenueMatchResult> {
  return Effect.runPromise(
    Effect.catchEager(matchVenueEffect(venueName, fuzzyThreshold, client), () => Effect.succeed({
      venue: null,
      matchType: 'none' as const,
      confidence: 0,
      searchName: venueName?.trim() ?? '',
    }))
  )
}

/**
 * Batch match multiple venue names
 * Returns a map from venue name to match result
 */
export function matchVenuesEffect(
  venueNames: string[],
  fuzzyThreshold: number = 0.6,
  client?: SupabaseClient
): Effect.Effect<Map<string, VenueMatchResult>, VenueMatchError> {
  return Effect.gen(function* () {
    const results = new Map<string, VenueMatchResult>()
    const uniqueNames = [...new Set(venueNames.filter(Boolean))]
    for (const name of uniqueNames) {
      const result = yield* matchVenueEffect(name, fuzzyThreshold, client)
      results.set(name, result)
    }
    return results
  })
}

export async function matchVenues(
  venueNames: string[],
  fuzzyThreshold: number = 0.6,
  client?: SupabaseClient
): Promise<Map<string, VenueMatchResult>> {
  return Effect.runPromise(
    Effect.catchEager(matchVenuesEffect(venueNames, fuzzyThreshold, client), () =>
      Effect.succeed(new Map<string, VenueMatchResult>())
    )
  )
}
