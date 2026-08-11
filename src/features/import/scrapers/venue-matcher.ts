/**
 * Venue Matcher Utility
 *
 * Matches venue names from external sources to existing venues in the database.
 * Uses a three-tier approach: exact match, fuzzy match, no match.
 */

import { getSupabase } from '@/shared/lib/db/client'

const supabase = getSupabase()
import type { Venue } from '@/shared/lib/types'

export interface VenueMatchResult {
  venue: Venue | null
  matchType: 'exact' | 'fuzzy' | 'none'
  confidence: number // 0-1, 1 being perfect match
  searchName: string // Original search name
}

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
async function findExactMatch(venueName: string): Promise<Venue | null> {
  const normalized = normalizeVenueName(venueName)

  const { data, error } = await supabase
    .from('venues')
    .select('*')
    .ilike('name', normalized)
    .limit(1)
    .single()

  if (error || !data) return null
  return data as Venue
}

/**
 * Find a venue by fuzzy match using pg_trgm
 */
async function findFuzzyMatch(
  venueName: string,
  threshold: number = 0.6
): Promise<{ venue: Venue; similarity: number } | null> {
  const { data, error } = await supabase.rpc('find_similar_venue', {
    search_name: venueName,
    similarity_threshold: threshold,
  })

  if (error || !data || data.length === 0) return null

  const match = data[0]

  // Fetch full venue record
  const { data: venue, error: venueError } = await supabase
    .from('venues')
    .select('*')
    .eq('id', match.id)
    .single()

  if (venueError || !venue) return null

  return {
    venue: venue as Venue,
    similarity: match.similarity,
  }
}

/**
 * Match a venue name to an existing venue in the database
 *
 * Strategy:
 * 1. Try exact match (normalized, case-insensitive)
 * 2. Try fuzzy match using pg_trgm with similarity threshold
 * 3. Return no match if nothing found
 */
export async function matchVenue(
  venueName: string,
  fuzzyThreshold: number = 0.6
): Promise<VenueMatchResult> {
  // Handle empty/null names
  if (!venueName || venueName.trim() === '') {
    return {
      venue: null,
      matchType: 'none',
      confidence: 0,
      searchName: venueName || '',
    }
  }

  const searchName = venueName.trim()

  // Try exact match first
  const exactMatch = await findExactMatch(searchName)
  if (exactMatch) {
    return {
      venue: exactMatch,
      matchType: 'exact',
      confidence: 1,
      searchName,
    }
  }

  // Try fuzzy match
  const fuzzyMatch = await findFuzzyMatch(searchName, fuzzyThreshold)
  if (fuzzyMatch) {
    return {
      venue: fuzzyMatch.venue,
      matchType: 'fuzzy',
      confidence: fuzzyMatch.similarity,
      searchName,
    }
  }

  // No match found
  return {
    venue: null,
    matchType: 'none',
    confidence: 0,
    searchName,
  }
}

/**
 * Batch match multiple venue names
 * Returns a map from venue name to match result
 */
export async function matchVenues(
  venueNames: string[],
  fuzzyThreshold: number = 0.6
): Promise<Map<string, VenueMatchResult>> {
  const results = new Map<string, VenueMatchResult>()

  // Dedupe venue names
  const uniqueNames = [...new Set(venueNames.filter(Boolean))]

  // Match each venue (could be parallelized, but keeping serial for now)
  for (const name of uniqueNames) {
    const result = await matchVenue(name, fuzzyThreshold)
    results.set(name, result)
  }

  return results
}
