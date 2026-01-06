/**
 * Blocklist Filter Utility
 *
 * Filters out "advertisement events" based on blocklist configuration.
 */

import type { BlocklistConfig } from '../../config/blocklist'

/**
 * Check if an event matches any blocklist criteria
 *
 * @param eventName - The event name/title
 * @param venueName - The venue name
 * @param blocklist - The blocklist configuration to check against
 * @returns true if the event should be blocked, false otherwise
 */
export function isBlockedEvent(
  eventName: string,
  venueName: string,
  blocklist: BlocklistConfig
): boolean {
  const lowerEventName = eventName.toLowerCase()
  const lowerVenueName = venueName.toLowerCase()

  // Check exact venue name matches
  if (blocklist.venueNames.some((v) => lowerVenueName === v.toLowerCase())) {
    return true
  }

  // Check venue name patterns (substring match)
  if (blocklist.venueNamePatterns.some((p) => lowerVenueName.includes(p.toLowerCase()))) {
    return true
  }

  // Check event name patterns (substring match)
  if (blocklist.eventNamePatterns.some((p) => lowerEventName.includes(p.toLowerCase()))) {
    return true
  }

  return false
}
