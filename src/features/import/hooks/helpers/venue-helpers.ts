/**
 * Venue Helper Functions
 *
 * Unified functions for venue-related operations in the import wizard.
 * These replace the duplicated logic across different sources.
 */

import type { SourceAdapter, BasePreviewEvent, UnmatchedVenueGroup, VenueEdit } from '../../adapters/types'
import type { Venue } from '@/shared/lib/types'

/**
 * Get unmatched venues from a list of preview events
 * Groups events by venue name and returns counts
 *
 * Replaces the 5 duplicate blocks in unmatchedVenues useMemo
 */
export function getUnmatchedVenues<T extends BasePreviewEvent>(
  events: T[],
  adapter: SourceAdapter<T>
): UnmatchedVenueGroup[] {
  const venueMap = new Map<string, string[]>()

  for (const event of events) {
    // Skip events that already have a venue match
    if (event.venueMatch?.matchType !== 'none') continue

    const venueName = adapter.getVenueName(event)
    if (!venueName) continue

    const existing = venueMap.get(venueName) || []
    existing.push(adapter.getEventId(event))
    venueMap.set(venueName, existing)
  }

  return Array.from(venueMap.entries())
    .map(([name, eventIds]) => ({
      name,
      eventIds,
      count: eventIds.length,
    }))
    .sort((a, b) => b.count - a.count)
}

/**
 * Update events with venue matches based on venue edits
 * Finds matching venues for events that were unmatched
 *
 * Replaces the 5 duplicate blocks in createVenuesAndProceed
 */
export function updateEventsWithVenueMatches<T extends BasePreviewEvent>(
  events: T[],
  adapter: SourceAdapter<T>,
  venueEdits: Map<string, VenueEdit>,
  allVenues: Venue[]
): T[] {
  return events.map((event) => {
    // Skip events that already have a match
    if (event.venueMatch?.matchType !== 'none') return event

    const venueName = adapter.getVenueName(event)
    if (!venueName) return event

    const edit = venueEdits.get(venueName)

    // If venue was marked to skip, don't update
    if (edit?.skip) return event

    // Determine the target venue name (merge target or edited name or original)
    const targetName = edit?.mergeInto || edit?.name || venueName

    // Find the matching venue
    const matchedVenue = allVenues.find(
      (v) => v.name.toLowerCase() === targetName.toLowerCase()
    )

    if (matchedVenue) {
      return adapter.updateVenueMatch(event, matchedVenue, 'exact')
    }

    return event
  })
}

/**
 * Get unique venue names that need to be created
 * Excludes skipped venues and merges
 */
export function getVenuesToCreate<T extends BasePreviewEvent>(
  events: T[],
  adapter: SourceAdapter<T>,
  venueEdits: Map<string, VenueEdit>
): VenueEdit[] {
  const venuesToCreate: VenueEdit[] = []
  const seen = new Set<string>()

  for (const event of events) {
    if (event.venueMatch?.matchType !== 'none') continue

    const venueName = adapter.getVenueName(event)
    if (!venueName || seen.has(venueName)) continue
    seen.add(venueName)

    const edit = venueEdits.get(venueName)

    // Skip if marked to skip or merge into another
    if (edit?.skip || edit?.mergeInto) continue

    venuesToCreate.push({
      name: edit?.name || venueName,
      neighborhood: edit?.neighborhood || null,
      skip: false,
    })
  }

  return venuesToCreate
}
