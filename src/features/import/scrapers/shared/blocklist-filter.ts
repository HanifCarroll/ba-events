/**
 * Blocklist Filter Utility
 *
 * Filters out "advertisement events" based on blocklist entries from the database.
 */

import type { ImportBlocklistEntry } from '#shared/lib/types.ts'

/**
 * Check if an event matches any blocklist entries
 *
 * @param eventName - The event name/title
 * @param venueName - The venue name
 * @param entries - Blocklist entries from the database
 * @returns true if the event should be blocked, false otherwise
 */
export function isBlockedByEntries(
  eventName: string,
  venueName: string,
  entries: ImportBlocklistEntry[]
): boolean {
  if (!entries || entries.length === 0) return false

  const lowerEventName = eventName.toLowerCase()
  const lowerVenueName = venueName.toLowerCase()

  return entries.some((entry) => {
    const pattern = entry.pattern.toLowerCase()
    if (entry.target_field === 'event_name') {
      return lowerEventName.includes(pattern)
    }
    if (entry.target_field === 'venue_name') {
      return lowerVenueName.includes(pattern)
    }
    return false
  })
}
