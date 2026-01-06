/**
 * Blocklist Configuration for Import Sources
 *
 * Used to filter out "advertisement events" - fake events that are
 * really venue advertisements (e.g., karaoke bars posting recurring
 * events with "consult for pricing").
 */

export interface BlocklistConfig {
  /** Exact venue names to exclude (case-insensitive) */
  venueNames: string[]

  /** Patterns in event names that indicate ads (case-insensitive substring match) */
  eventNamePatterns: string[]

  /** Patterns in venue names that indicate ads (case-insensitive substring match) */
  venueNamePatterns: string[]
}

/**
 * Passline blocklist configuration
 *
 * Add known advertisement venues/patterns here.
 * These events will be filtered out during scraping.
 */
export const PASSLINE_BLOCKLIST: BlocklistConfig = {
  venueNames: [
    // Add exact venue names to block
    // e.g., 'Karaoke Example Bar'
  ],
  eventNamePatterns: [
    // Add patterns found in advertisement event names
    // e.g., 'consultar precio', 'consult for pricing'
  ],
  venueNamePatterns: [
    // Add patterns found in advertisement venue names
    // e.g., 'karaoke'
  ],
}

/**
 * Eventbrite blocklist configuration
 */
export const EVENTBRITE_BLOCKLIST: BlocklistConfig = {
  venueNames: [],
  eventNamePatterns: [],
  venueNamePatterns: [],
}

/**
 * BA Tourism blocklist configuration
 */
export const BA_TOURISM_BLOCKLIST: BlocklistConfig = {
  venueNames: [],
  eventNamePatterns: [],
  venueNamePatterns: [],
}

/**
 * Meetup blocklist configuration
 */
export const MEETUP_BLOCKLIST: BlocklistConfig = {
  venueNames: [],
  eventNamePatterns: [],
  venueNamePatterns: [],
}

/**
 * Luma blocklist configuration
 */
export const LUMA_BLOCKLIST: BlocklistConfig = {
  venueNames: [],
  eventNamePatterns: [],
  venueNamePatterns: [],
}
