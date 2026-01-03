/**
 * Data Transformer for Luma Events
 *
 * Transforms Luma events into our EventInsert format.
 */

import type { EventInsert } from '@/shared/lib/types'
import type { LumaEvent, LumaVenueInfo } from './types'
import {
  normalizeTitle,
  normalizeDescription,
  normalizeUrl,
  normalizeImageUrl,
} from '../shared/normalization'

/**
 * Extract venue name from Luma event
 */
function extractVenueName(event: LumaEvent): string | null {
  return event.venue?.name || null
}

/**
 * Extract full address string from Luma event
 */
function extractVenueAddress(event: LumaEvent): string | null {
  if (!event.venue) return null

  // Prefer full_address if available
  if (event.venue.full_address) {
    return event.venue.full_address
  }

  // Otherwise combine parts
  const parts = [event.venue.address, event.venue.city].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : null
}

/**
 * Transform a Luma event into our EventInsert format
 *
 * Note: Categories are NOT available from Luma
 * and will be filled during the enrichment phase.
 */
export function transformLumaEvent(
  event: LumaEvent,
  venueId: string | null
): EventInsert {
  // Luma provides ISO 8601 dates, use directly
  const startsAt = event.start_at
  const endsAt = event.end_at || null

  // Check if it's an all-day event (no time component or spans multiple days)
  let isAllDay = false
  if (endsAt) {
    const startDate = new Date(startsAt).toDateString()
    const endDate = new Date(endsAt).toDateString()
    isAllDay = startDate !== endDate
  }

  // Price handling - Luma stores price in cents if available
  const price = event.price !== null ? event.price / 100 : null

  return {
    name: normalizeTitle(event.name),
    description_es: normalizeDescription(event.description),
    description_en: null,
    starts_at: startsAt,
    ends_at: endsAt,
    is_all_day: isAllDay,
    venue_id: venueId,
    categories: [], // Enriched later via AI
    price: event.is_free ? null : price,
    is_free: event.is_free,
    min_age: null, // Not available from Luma
    image_url: normalizeImageUrl(event.cover_url),
    link: normalizeUrl(event.url),
    ticket_url: normalizeUrl(event.url), // Same as event URL for Luma
    source: 'luma',
    external_id: event.api_id,
    status: 'scheduled',
  }
}

/**
 * Data needed for venue matching from Luma event
 */
export function extractVenueInfo(event: LumaEvent): LumaVenueInfo | null {
  const name = extractVenueName(event)
  if (!name) return null

  return {
    name,
    address: extractVenueAddress(event),
    latitude: event.venue?.latitude || null,
    longitude: event.venue?.longitude || null,
  }
}

/**
 * Create a unique key for venue matching
 * Uses venue name as key (same as other scrapers)
 */
export function getVenueKey(event: LumaEvent): string | null {
  return extractVenueName(event)
}

/**
 * Batch transform multiple events
 *
 * @param events - Array of Luma events
 * @param venueIdMap - Map of venue name → venue ID (from matchVenue)
 */
export function transformLumaEvents(
  events: LumaEvent[],
  venueIdMap: Map<string, string | null>
): EventInsert[] {
  return events.map((event) => {
    const venueName = getVenueKey(event)
    const venueId = venueName ? venueIdMap.get(venueName) || null : null
    return transformLumaEvent(event, venueId)
  })
}

/**
 * Get all unique venue names from events for batch matching
 */
export function getUniqueVenueNames(events: LumaEvent[]): string[] {
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
export function getAllVenueInfo(events: LumaEvent[]): Map<string, LumaVenueInfo> {
  const venueMap = new Map<string, LumaVenueInfo>()

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
