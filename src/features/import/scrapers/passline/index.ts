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

// Data transformer
export {
  transformPasslineEvent,
  transformPasslineEvents,
} from './transformer'

// Description enrichment moved to src/lib/enrichment.ts (uses Jina Reader + Haiku)
