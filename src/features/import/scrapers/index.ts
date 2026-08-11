/**
 * Scrapers Module
 *
 * Central export for all event scrapers.
 * Each scraper is namespaced to avoid conflicts.
 */

// Passline scraper - namespaced export
import * as passline from './passline'
export { passline }

// Eventbrite scraper - namespaced export
import * as eventbrite from './eventbrite'
export { eventbrite }

// BA Tourism scraper - namespaced export
import * as baTourism from './ba-tourism'
export { baTourism }

// Meetup scraper - namespaced export
import * as meetup from './meetup'
export { meetup }

// Luma scraper - namespaced export
import * as luma from './luma'
export { luma }

// Venti scraper - namespaced export
import * as venti from './venti'
export { venti }

// Shared utilities
export { matchVenue, matchVenues, type VenueMatchResult } from './venue-matcher'
