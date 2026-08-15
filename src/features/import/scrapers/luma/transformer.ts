/**
 * Data Transformer for Luma Events
 *
 * Transforms Luma events into our EventInsert format.
 */

import { toZonedTime } from 'date-fns-tz'
import type { EventInsert } from '#shared/lib/types.ts'
import type { LumaEvent, LumaVenueInfo } from './types.ts'
import { BA_TIMEZONE } from '#shared/lib/constants.ts'
import {
  normalizeTitle,
  normalizeDescription,
  normalizeUrl,
  normalizeImageUrl,
} from '../shared/normalization.ts'

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

  // Check if it's an all-day event: genuinely spans multiple full days
  // (>= 24h across two BA calendar days). Compare in Buenos Aires time, NOT
  // UTC, and do NOT treat a single overnight/evening show as all-day — e.g.
  // 22:30 -> 01:00 UTC (7:30 PM -> 10:00 PM BA) and 21:00 -> 07:00 BA (an
  // overnight party) are both NOT all-day, while a 2-day conference IS.
  // Luma provides real start/end times, so a midnight start is an actual
  // midnight start (not a date-only placeholder), but a real all-day event
  // still spans >= 24h.
  let isAllDay = false
  if (endsAt) {
    const start = toZonedTime(new Date(startsAt), BA_TIMEZONE)
    const end = toZonedTime(new Date(endsAt), BA_TIMEZONE)
    const spansDays = start.toDateString() !== end.toDateString()
    const durationHours = (end.getTime() - start.getTime()) / 3600000
    isAllDay = spansDays && durationHours >= 24
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
