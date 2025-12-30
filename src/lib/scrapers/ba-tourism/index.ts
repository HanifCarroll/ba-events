/**
 * BA Tourism Scraper Module
 *
 * Scrapes events from turismo.buenosaires.gob.ar
 *
 * NOTE: This website loads content dynamically via JavaScript.
 * The server-side scraper (scraper.ts) only works for the initial HTML.
 * For full content, use the client-side scraper (client.ts) in a browser context.
 */

// Server-side scraper functions (limited - only gets initial HTML)
export {
  fetchBATourismPage,
  parseBATourismEvents,
  extractWeekContext,
  scrapeBATourismEvents,
} from './scraper'

// Browser-based scraper (uses Playwright - gets all events)
export { scrapeBATourismEventsWithBrowser } from './browser-scraper'

// Client-side scraper functions (for browser context - gets all events)
export {
  extractEventsFromDOM,
  extractWeekContextFromDOM,
  getExtractEventsScript,
} from './client'

// Transformer functions
export {
  transformBATourismEvent,
  transformBATourismEvents,
  getUniqueVenueNames,
} from './transformer'

// Date parser
export {
  parseSpanishDate,
  parseWeekContext,
  toISODateTime,
  getEndTimeISO,
} from './date-parser'

// Enrichment (for filling missing venue data)
export { extractBATourismVenueName, extractBATourismVenuesBatch } from './enrichment'

// Types
export type {
  BATourismEvent,
  Coordinates,
  ParsedDateTime,
  WeekContext,
  BATourismCategory,
} from './types'

export { BA_TOURISM_CATEGORIES } from './types'
