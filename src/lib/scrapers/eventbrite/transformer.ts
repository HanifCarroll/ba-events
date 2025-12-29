/**
 * Data Transformer for Eventbrite Events
 *
 * Transforms Eventbrite JSON-LD events into our EventInsert format.
 */

import type { EventInsert } from '@/lib/types'
import type { EventbriteEvent } from './api'

/**
 * Convert Eventbrite date (YYYY-MM-DD) to ISO datetime string
 * Assumes midnight start in Argentina timezone
 */
function dateToIsoDatetime(dateStr: string): string {
  // Eventbrite JSON-LD provides dates as YYYY-MM-DD
  // Assume midnight in Argentina timezone (UTC-3)
  return `${dateStr}T00:00:00.000Z`
}

/**
 * Extract venue name from Eventbrite location
 */
function extractVenueName(event: EventbriteEvent): string | null {
  return event.location?.name || null
}

/**
 * Extract full address string from Eventbrite location
 */
function extractVenueAddress(event: EventbriteEvent): string | null {
  const address = event.location?.address
  if (!address) return null

  const parts = [
    address.streetAddress,
    address.addressLocality,
    address.addressRegion,
    address.postalCode,
  ].filter(Boolean)

  return parts.length > 0 ? parts.join(', ') : null
}

/**
 * Extract event ID from Eventbrite URL
 * URL format: https://www.eventbrite.com.ar/e/event-name-tickets-1234567890
 */
function extractExternalId(url: string): string | null {
  const match = url.match(/tickets-(\d+)/)
  return match ? match[1] : null
}

/**
 * Check if event spans multiple days
 */
function isMultiDayEvent(startDate: string, endDate: string): boolean {
  return startDate !== endDate
}

/**
 * Transform an Eventbrite event into our EventInsert format
 *
 * Note: Categories, vibes, and price are NOT available from JSON-LD
 * and will be filled during the enrichment phase.
 */
export function transformEventbriteEvent(
  event: EventbriteEvent,
  venueId: string | null
): EventInsert {
  const startsAt = dateToIsoDatetime(event.startDate)
  const endsAt = event.endDate ? dateToIsoDatetime(event.endDate) : null

  return {
    name: event.name,
    description_es: event.description || null, // Already available in JSON-LD!
    description_en: null,
    starts_at: startsAt,
    ends_at: endsAt,
    is_all_day: isMultiDayEvent(event.startDate, event.endDate),
    venue_id: venueId,
    categories: [], // Enriched later via AI
    vibes: [], // Enriched later via AI
    price: null, // Enriched later via page fetch
    is_free: true, // Default to free, updated during enrichment
    min_age: null, // Not available from Eventbrite
    image_url: event.image || null,
    link: event.url,
    ticket_url: event.url, // Same as event URL for Eventbrite
    source: 'eventbrite',
    external_id: extractExternalId(event.url),
    status: 'scheduled',
  }
}

/**
 * Data needed for venue matching from Eventbrite event
 */
export interface EventbriteVenueInfo {
  name: string
  address: string | null
  latitude: string | null
  longitude: string | null
}

/**
 * Extract venue info for matching
 */
export function extractVenueInfo(event: EventbriteEvent): EventbriteVenueInfo | null {
  const name = extractVenueName(event)
  if (!name) return null

  return {
    name,
    address: extractVenueAddress(event),
    latitude: event.location?.geo?.latitude || null,
    longitude: event.location?.geo?.longitude || null,
  }
}

/**
 * Create a unique key for venue matching
 * Uses venue name as key (same as Passline pattern)
 */
export function getVenueKey(event: EventbriteEvent): string | null {
  return extractVenueName(event)
}

/**
 * Batch transform multiple events
 *
 * @param events - Array of Eventbrite events from JSON-LD
 * @param venueIdMap - Map of venue name → venue ID (from matchVenue)
 */
export function transformEventbriteEvents(
  events: EventbriteEvent[],
  venueIdMap: Map<string, string | null>
): EventInsert[] {
  return events.map((event) => {
    const venueName = getVenueKey(event)
    const venueId = venueName ? venueIdMap.get(venueName) || null : null
    return transformEventbriteEvent(event, venueId)
  })
}

/**
 * Get all unique venue names from events for batch matching
 */
export function getUniqueVenueNames(events: EventbriteEvent[]): string[] {
  const venueNames = new Set<string>()

  for (const event of events) {
    const name = extractVenueName(event)
    if (name) {
      venueNames.add(name)
    }
  }

  return Array.from(venueNames)
}

/**
 * Get venue info for all events (for creating new venues)
 */
export function getAllVenueInfo(events: EventbriteEvent[]): Map<string, EventbriteVenueInfo> {
  const venueMap = new Map<string, EventbriteVenueInfo>()

  for (const event of events) {
    const info = extractVenueInfo(event)
    if (info) {
      // Only keep first occurrence (venues may have slightly different addresses)
      if (!venueMap.has(info.name)) {
        venueMap.set(info.name, info)
      }
    }
  }

  return venueMap
}
