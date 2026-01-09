/**
 * Luma Scraper Module
 *
 * Exports all Luma scraper functionality.
 */

// Types
export type { LumaEvent, LumaVenue, LumaHost, LumaVenueInfo } from './types'

// API functions
export { fetchLumaEvents, filterByDateRange, getVenueName, getVenueAddress } from './api'

// Transformer functions
export {
  transformLumaEvent,
  transformLumaEvents,
  extractVenueInfo,
  getVenueKey,
  getUniqueVenueNames,
  getAllVenueInfo,
} from './transformer'

// Description enrichment
export {
  enrichLumaEventsWithDescriptions,
  enrichLumaDescriptionsBatch,
  fetchLumaDescriptionFromDetailPage,
} from './description-enrichment'
export type { LumaDescriptionResult, EnrichmentEvent as LumaEnrichmentEvent } from './description-enrichment'

// Venue enrichment
export {
  enrichLumaEventsWithVenues,
  fetchLumaVenueFromUrl,
} from './venue-enrichment'
export type { LumaVenueResult, VenueEnrichmentEvent as LumaVenueEnrichmentEvent } from './venue-enrichment'
