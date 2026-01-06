/**
 * Selection Helper Functions
 *
 * Unified functions for event selection operations in the import wizard.
 * These replace the duplicated logic across different sources.
 */

import type { SourceAdapter, BasePreviewEvent } from '../../adapters/types'

/**
 * Get all event IDs from a list of preview events
 *
 * Replaces the 5 duplicate blocks in toggleSelectAll
 */
export function getAllEventIds<T extends BasePreviewEvent>(
  events: T[],
  adapter: SourceAdapter<T>
): Set<string> {
  return new Set(events.map((e) => adapter.getEventId(e)))
}

/**
 * Get event IDs for events that have a venue match
 *
 * Replaces the 5 duplicate blocks in skipVenues (getting matched events)
 */
export function getMatchedEventIds<T extends BasePreviewEvent>(
  events: T[],
  adapter: SourceAdapter<T>
): Set<string> {
  return new Set(
    events
      .filter((e) => e.venueMatch?.matchType !== 'none')
      .map((e) => adapter.getEventId(e))
  )
}

/**
 * Get event IDs for events with unmatched venues
 */
export function getUnmatchedEventIds<T extends BasePreviewEvent>(
  events: T[],
  adapter: SourceAdapter<T>
): Set<string> {
  return new Set(
    events
      .filter((e) => e.venueMatch?.matchType === 'none')
      .map((e) => adapter.getEventId(e))
  )
}

/**
 * Filter events by selection
 */
export function filterSelectedEvents<T extends BasePreviewEvent>(
  events: T[],
  selectedIds: Set<string>,
  adapter: SourceAdapter<T>
): T[] {
  return events.filter((e) => selectedIds.has(adapter.getEventId(e)))
}

/**
 * Count events by venue match status
 */
export function countEventsByMatchStatus<T extends BasePreviewEvent>(
  events: T[]
): { matched: number; unmatched: number } {
  let matched = 0
  let unmatched = 0

  for (const event of events) {
    if (event.venueMatch?.matchType === 'none') {
      unmatched++
    } else {
      matched++
    }
  }

  return { matched, unmatched }
}
