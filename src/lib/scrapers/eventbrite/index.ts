/**
 * Eventbrite Scraper Module
 *
 * Main entry point for the Eventbrite event scraper.
 *
 * Two-phase import pattern:
 * 1. Fast import via JSON-LD (60 events per listing page)
 * 2. Enrichment for prices + category/vibe inference
 */

// API client (JSON-LD scraper)
export {
  fetchEventbriteEvents,
  filterInPersonEvents,
  filterByDateRange,
  isOnlineEvent,
  getVenueName,
  getVenueAddress,
  extractEventId,
  type EventbriteEvent,
  type EventbriteLocation,
  type EventbriteAddress,
  type EventbriteGeoCoordinates,
} from './api'

// Data transformer
export {
  transformEventbriteEvent,
  transformEventbriteEvents,
  extractVenueInfo,
  getVenueKey,
  getUniqueVenueNames,
  getAllVenueInfo,
  type EventbriteVenueInfo,
} from './transformer'

// NOTE: Enrichment functions (fetchEventbritePrice, inferCategoriesAndVibes, etc.)
// are NOT exported here because they use the Anthropic SDK which requires server-side execution.
// Import directly from './enrichment' in server-side code only:
//   import { enrichEventbriteEvent } from '@/lib/scrapers/eventbrite/enrichment'
