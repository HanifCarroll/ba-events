/**
 * Meetup Scraper Module
 *
 * Exports all functionality for scraping and transforming Meetup events
 */

// Browser scraper
export {
  scrapeMeetupEvents,
  filterInPersonEvents,
  filterByDateRange,
  getExtractionScript,
} from './browser-scraper'

export type { ScraperOptions } from './browser-scraper'

// Transformer
export {
  transformMeetupEvent,
  transformMeetupEventWithExpansion,
  transformMeetupEvents,
  getUniqueVenueNames,
  getUniqueGroupNames,
} from './transformer'

// Date parsing
export {
  parseMeetupDate,
  extractRecurrencePattern,
  isRecurringEvent,
  expandRecurringEvent,
  expandRecurringEventWithIds,
  parseMeetupDateTime,
  formatArgentinaDate,
} from './date-parser'

// Venue enrichment
export {
  fetchMeetupVenueFromDetailPage,
  enrichMeetupEventsWithVenues,
} from './venue-enrichment'

export type {
  MeetupVenueInfo,
  EnrichmentEvent,
  EnrichmentResult,
} from './venue-enrichment'

// Types
export type {
  MeetupEvent,
  MeetupGroup,
  MeetupVenue,
  MeetupCategory,
  MeetupGraphQLEvent,
  ParsedMeetupDateTime,
} from './types'

export { MEETUP_CATEGORIES } from './types'
