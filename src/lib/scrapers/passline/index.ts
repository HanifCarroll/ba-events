/**
 * Passline Scraper Module
 *
 * Main entry point for the Passline event scraper.
 */

// API client (server-side - may be blocked by Cloudflare)
export {
  fetchPasslineEvents,
  filterCABAEvents,
  filterByDateRange,
  isSoldOut,
  type PasslineEvent,
  type DateRange,
} from './api'

// Client-side API (for browser use - bypasses Cloudflare)
export {
  fetchPasslineEventsClient,
  filterCABAEventsClient,
  filterByDateRangeClient,
} from './client'

// Category mapping
export { mapPasslineCategory, getKnownPasslineCategories } from './category-map'

// Vibe inference
export { inferVibes } from './vibe-inference'

// Data transformer
export {
  transformPasslineEvent,
  transformPasslineEvents,
} from './transformer'
