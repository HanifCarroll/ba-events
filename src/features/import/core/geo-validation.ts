/**
 * Geographic Validation for Buenos Aires Events
 *
 * Provides bounding box validation to ensure events are actually
 * located within Buenos Aires / CABA boundaries.
 */

import type { MeetupEvent } from '../scrapers/meetup/types.ts'
import { logger } from '#shared/lib/logger.ts'

// ============================================================================
// BUENOS AIRES BOUNDING BOX
// ============================================================================

/**
 * CABA (Ciudad Autónoma de Buenos Aires) geographic boundaries.
 * These coordinates define a bounding box that encompasses the city.
 *
 * Note: This is a rectangular approximation. For more precise validation,
 * consider using a GeoJSON polygon of CABA boundaries.
 */
export const CABA_BOUNDS = {
  minLat: -34.705, // South boundary
  maxLat: -34.527, // North boundary
  minLng: -58.531, // West boundary
  maxLng: -58.335, // East boundary
} as const

/**
 * Greater Buenos Aires bounds (includes suburbs).
 * Use this for a more lenient check that includes nearby areas.
 */
export const GREATER_BA_BOUNDS = {
  minLat: -34.85,  // South (includes Lomas de Zamora, Lanús)
  maxLat: -34.35,  // North (includes Tigre, San Isidro)
  minLng: -58.70,  // West (includes Morón, Merlo)
  maxLng: -58.20,  // East (Río de la Plata)
} as const

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

/**
 * Check if coordinates are within Buenos Aires bounds.
 *
 * @param lat - Latitude coordinate
 * @param lng - Longitude coordinate
 * @param useGreaterBA - If true, uses Greater Buenos Aires bounds (more lenient)
 * @returns true if coordinates are within bounds, false otherwise
 */
export function isInBuenosAires(
  lat: number | null | undefined,
  lng: number | null | undefined,
  useGreaterBA = true
): boolean {
  if (lat == null || lng == null) {
    // No coordinates to validate - can't determine location
    return true // Allow events without coordinates (will be validated by other means)
  }

  const bounds = useGreaterBA ? GREATER_BA_BOUNDS : CABA_BOUNDS

  return (
    lat >= bounds.minLat &&
    lat <= bounds.maxLat &&
    lng >= bounds.minLng &&
    lng <= bounds.maxLng
  )
}

/**
 * Known non-Buenos Aires locations that might slip through.
 * Add patterns here as you discover them.
 */
const NON_BA_LOCATION_PATTERNS = [
  // US locations that appeared in the database
  /virginia/i,
  /herndon/i,
  /fairfax/i,
  /washington\s*d\.?c\.?/i,
  /maryland/i,
  // Other common false positives
  /new\s*york/i,
  /california/i,
  /texas/i,
  /florida/i,
  /chicago/i,
  /boston/i,
  /seattle/i,
  /san\s*francisco/i,
  /los\s*angeles/i,
  // European cities
  /london/i,
  /paris/i,
  /berlin/i,
  /madrid/i,
  // Brazilian cities (might appear due to similar timezone)
  /são\s*paulo/i,
  /rio\s*de\s*janeiro/i,
]

/**
 * Check if venue/address text contains known non-BA location indicators.
 */
export function containsNonBALocation(text: string | null | undefined): boolean {
  if (!text) return false
  return NON_BA_LOCATION_PATTERNS.some(pattern => pattern.test(text))
}

/**
 * Validate that an event is located in Buenos Aires.
 * Uses multiple signals: coordinates, city name, venue name, address.
 *
 * @returns true if the event appears to be in Buenos Aires, false otherwise
 */
export function isEventInBuenosAires(event: {
  venue?: {
    name?: string | null
    address?: string | null
    city?: string | null
    lat?: number | null
    lng?: number | null
  } | null
}): boolean {
  const venue = event.venue

  // No venue info at all - allow (might be online or TBA)
  if (!venue) return true

  // Check coordinates if available
  if (venue.lat != null && venue.lng != null) {
    if (!isInBuenosAires(venue.lat, venue.lng)) {
      return false
    }
  }

  // Check city name for known non-BA locations
  if (venue.city && containsNonBALocation(venue.city)) {
    return false
  }

  // Check venue name for known non-BA locations
  if (venue.name && containsNonBALocation(venue.name)) {
    return false
  }

  // Check address for known non-BA locations
  if (venue.address && containsNonBALocation(venue.address)) {
    return false
  }

  return true
}

// ============================================================================
// FILTER FUNCTIONS
// ============================================================================

/**
 * Filter Meetup events to only include those in Buenos Aires.
 * Logs rejected events for debugging.
 */
export function filterEventsByLocation(events: MeetupEvent[]): MeetupEvent[] {
  const validEvents: MeetupEvent[] = []
  const rejectedEvents: Array<{ name: string; venue: string | null; reason: string }> = []

  for (const event of events) {
    if (isEventInBuenosAires(event)) {
      validEvents.push(event)
    } else {
      rejectedEvents.push({
        name: event.name,
        venue: event.venue?.name || null,
        reason: getRejectReason(event),
      })
    }
  }

  if (rejectedEvents.length > 0) {
    logger.info('[geo-validation] Rejected events outside Buenos Aires', {
      rejectedCount: rejectedEvents.length,
      rejectedEvents: rejectedEvents.slice(0, 10), // Log first 10
    })
  }

  return validEvents
}

/**
 * Get human-readable reason why an event was rejected.
 */
function getRejectReason(event: { venue?: { lat?: number | null; lng?: number | null; city?: string | null; name?: string | null; address?: string | null } | null }): string {
  const venue = event.venue
  if (!venue) return 'No venue'

  if (venue.lat != null && venue.lng != null && !isInBuenosAires(venue.lat, venue.lng)) {
    return `Coordinates outside BA: ${venue.lat}, ${venue.lng}`
  }

  if (venue.city && containsNonBALocation(venue.city)) {
    return `Non-BA city: ${venue.city}`
  }

  if (venue.name && containsNonBALocation(venue.name)) {
    return `Non-BA venue name: ${venue.name}`
  }

  if (venue.address && containsNonBALocation(venue.address)) {
    return `Non-BA address: ${venue.address}`
  }

  return 'Unknown'
}
