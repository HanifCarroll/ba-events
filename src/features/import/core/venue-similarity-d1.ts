/**
 * The pg_trgm venue lookups for D1, which has no pg_trgm: `find_similar_venue` for the importers' fuzzy match and
 * `intake_similar_venues` for the Instagram intake's `venue` operation. Both score venue names (about 2,600) with
 * `trigramSimilarity`, the TypeScript port of Postgres' `similarity()`. The rules take a venue list, so a caller that
 * already holds the venues (an import step's cache) doesn't read them again.
 */
import type { D1Database } from '@cloudflare/workers-types'
import { trigramSimilarity } from '#shared/lib/search/trigram.ts'

// Production Postgres sorts names with a locale collation (case and accents count only to break ties), not by bytes.
const byName = new Intl.Collator('en-US')

export type SimilarVenue = { id: string; name: string; similarity: number }
export type IntakeSimilarVenue = SimilarVenue & { address: string | null; neighborhood: string | null }

/**
 * `find_similar_venue`: the venue most similar to `name` at or above `threshold`, ties to the oldest venue, then the
 * lowest id. Null when none reaches it.
 */
export function mostSimilarVenue(venues: ReadonlyArray<{ id: string; name: string; created_at: string }>, name: string,
  threshold = 0.6): SimilarVenue | null {
  let best: (SimilarVenue & { created_at: string }) | null = null
  for (const venue of venues) {
    const similarity = trigramSimilarity(venue.name, name)
    if (similarity < threshold) continue
    if (!best || similarity > best.similarity || (similarity === best.similarity
      && (venue.created_at < best.created_at || (venue.created_at === best.created_at && venue.id < best.id)))) {
      best = { id: venue.id, name: venue.name, similarity, created_at: venue.created_at }
    }
  }
  return best && { id: best.id, name: best.name, similarity: best.similarity }
}

/**
 * `intake_similar_venues`: every venue whose name equals `name` ignoring case (similarity 1) or reaches `threshold`,
 * most similar first, then by name (a stable sort, so equal names keep the venues' order). No limit, so the operator
 * sees every lookalike.
 */
export function similarIntakeVenues<V extends { id: string; name: string }>(venues: readonly V[], name: string,
  threshold = 0.6): Array<V & { similarity: number }> {
  const lower = name.toLowerCase()
  return venues
    .map(venue => ({ ...venue, similarity: venue.name.toLowerCase() === lower ? 1 : trigramSimilarity(venue.name, name) }))
    .filter(venue => venue.similarity >= threshold || venue.similarity === 1)
    .sort((a, b) => b.similarity - a.similarity || byName.compare(a.name, b.name))
}

/** `intake_similar_venues` read from D1. */
export async function intakeSimilarVenuesD1(db: D1Database, name: string, threshold = 0.6): Promise<IntakeSimilarVenue[]> {
  // Postgres leaves the order of equal names undefined; oldest first keeps it stable (and matched production's).
  const { results } = await db.prepare('SELECT id, name, address, neighborhood FROM venues ORDER BY created_at, id')
    .all<Omit<IntakeSimilarVenue, 'similarity'>>()
  return similarIntakeVenues(results, name, threshold)
}

/** `find_similar_venue` read from D1. */
export async function findSimilarVenueD1(db: D1Database, name: string, threshold = 0.6): Promise<SimilarVenue | null> {
  const { results } = await db.prepare('SELECT id, name, created_at FROM venues').all<{ id: string; name: string; created_at: string }>()
  return mostSimilarVenue(results, name, threshold)
}
