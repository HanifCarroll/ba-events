/**
 * Venue Matcher Utility
 *
 * Matches venue names from external sources to existing venues in the database.
 * Uses a three-tier approach: exact match, fuzzy match, no match.
 * Needs migration 20261116180000_venue_name_matching.sql (`venues_named`, and `find_similar_venue` fixed).
 */

import { Data, Effect } from 'effect'
import { getSupabase, type SupabaseClient } from '#shared/lib/db/client.server.ts'
import type { Venue } from '#shared/lib/types.ts'
import { importTry } from '../core/effect-utils.ts'
import { pickVenue, venueNameKey } from '../core/venue-identity.ts'

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

const matchError = (cause: { operation: string; message: string; cause?: unknown }) => new VenueMatchError({
  operation: cause.operation,
  message: cause.message,
  cause: cause.cause,
})

/**
 * Every venue whose `venueNameKey` equals this name's, with its event count (`venues_named`). No `ilike`, so `%` and `_`
 * in a name are plain characters. A failed lookup is an error, never "no venue".
 */
export function findSameNameVenuesEffect(
  venueName: string,
  client?: SupabaseClient
): Effect.Effect<Array<Venue & { event_count: number }>, VenueMatchError> {
  if (!venueNameKey(venueName)) return Effect.succeed([])
  return importTry('venue-matcher.same-name', () => (client ?? getSupabase()).rpc('venues_named', { p_name: venueName })).pipe(
    Effect.mapError(matchError),
    Effect.flatMap(({ data, error }) => error
      ? Effect.fail(new VenueMatchError({ operation: 'venue-matcher.same-name', message: error.message, cause: error }))
      : Effect.succeed(((data ?? []) as Array<{ venue: Venue; event_count: number | string }>)
        .map(row => ({ ...row.venue, event_count: Number(row.event_count) }))))
  )
}

/**
 * Find a venue by fuzzy match using pg_trgm, then settle on that name's preferred copy (`pickVenue`).
 */
function findFuzzyMatchEffect(
  venueName: string,
  threshold: number,
  client: SupabaseClient | undefined,
  address: string | null | undefined
): Effect.Effect<{ venue: Venue; similarity: number } | null, VenueMatchError> {
  return Effect.gen(function* () {
    const { data, error } = yield* importTry('venue-matcher.fuzzy-rpc', () => (client ?? getSupabase()).rpc('find_similar_venue', {
      search_name: venueName,
      similarity_threshold: threshold,
    })).pipe(Effect.mapError(matchError))
    if (error) return yield* new VenueMatchError({ operation: 'venue-matcher.fuzzy-rpc', message: error.message, cause: error })
    const match = (data as Array<{ id: string; name: string; similarity: number }> | null)?.[0]
    if (!match) return null
    const venue = pickVenue(yield* findSameNameVenuesEffect(match.name, client), address)
    return venue ? { venue, similarity: Number(match.similarity) } : null
  })
}

/**
 * Match a venue name to an existing venue in the database
 *
 * Strategy:
 * 1. Try exact match: the same `venueNameKey`. Several same-name venues resolve with `pickVenue`: those at the event's
 *    own street and number first, then the copy the duplicate merge keeps
 * 2. Try fuzzy match using pg_trgm with similarity threshold
 * 3. Return no match if nothing found
 *
 * A failed lookup fails the effect rather than looking like "no match".
 */
export function matchVenueEffect(
  venueName: string,
  fuzzyThreshold: number = 0.6,
  client?: SupabaseClient,
  address?: string | null
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
    const exactMatch = pickVenue(yield* findSameNameVenuesEffect(searchName, client), address)
    if (exactMatch) {
      return {
        venue: exactMatch,
        matchType: 'exact' as const,
        confidence: 1,
        searchName,
      }
    }

    // Try fuzzy match
    const fuzzyMatch = yield* findFuzzyMatchEffect(searchName, fuzzyThreshold, client, address)
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
