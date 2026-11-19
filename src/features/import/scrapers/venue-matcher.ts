/**
 * Venue Matcher Utility
 *
 * Matches venue names from external sources to existing venues in the database.
 * Uses a three-tier approach: exact match, fuzzy match, no match.
 * The catalog store compares `venueNameKey` and trigram similarity in TypeScript.
 */

import { Data, Effect } from 'effect'
import type { Venue } from '#shared/lib/types.ts'
import { importTry } from '../core/effect-utils.ts'
import type { CatalogStore } from '../core/catalog-store.ts'
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
 * Every venue whose `venueNameKey` equals this name's, with its event count. No `ilike`, so
 * `%` and `_` in a name are plain characters. A failed lookup is an error, never "no venue".
 */
export function findSameNameVenuesEffect(
  venueName: string,
  catalog: CatalogStore
): Effect.Effect<Array<Venue & { event_count: number }>, VenueMatchError> {
  if (!venueNameKey(venueName)) return Effect.succeed([])
  return importTry('venue-matcher.same-name', () => catalog.venuesNamed(venueName)).pipe(Effect.mapError(matchError))
}

/**
 * Find a venue by fuzzy match (pg_trgm `similarity`), then settle on that name's preferred copy (`pickVenue`).
 */
function findFuzzyMatchEffect(
  venueName: string,
  threshold: number,
  catalog: CatalogStore,
  address: string | null | undefined
): Effect.Effect<{ venue: Venue; similarity: number } | null, VenueMatchError> {
  return Effect.gen(function* () {
    const match = yield* importTry('venue-matcher.fuzzy-rpc', () => catalog.similarVenue(venueName, threshold)).pipe(Effect.mapError(matchError))
    if (!match) return null
    const venue = pickVenue(yield* findSameNameVenuesEffect(match.name, catalog), address)
    return venue ? { venue, similarity: match.similarity } : null
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
  fuzzyThreshold: number,
  catalog: CatalogStore,
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
    const exactMatch = pickVenue(yield* findSameNameVenuesEffect(searchName, catalog), address)
    if (exactMatch) {
      return {
        venue: exactMatch,
        matchType: 'exact' as const,
        confidence: 1,
        searchName,
      }
    }

    // Try fuzzy match
    const fuzzyMatch = yield* findFuzzyMatchEffect(searchName, fuzzyThreshold, catalog, address)
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
