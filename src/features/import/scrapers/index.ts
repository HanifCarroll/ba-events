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

// Shared utilities
export { matchVenue, matchVenues, type VenueMatchResult } from './venue-matcher'
