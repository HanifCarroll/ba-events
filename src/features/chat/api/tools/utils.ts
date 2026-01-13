/**
 * Shared utilities for tool implementations.
 *
 * Contains formatting functions, date/time helpers, and other
 * utilities used across multiple tools.
 */

import { toZonedTime, fromZonedTime } from 'date-fns-tz'
import { format } from 'date-fns'
import { BA_TIMEZONE } from '@/shared/lib/constants'
import type { EventWithVenue, Venue } from '@/shared/lib/types'

// ============================================================================
// DATE/TIME UTILITIES
// ============================================================================

/**
 * Get the current time in Buenos Aires timezone.
 */
export function getNowInBA(): Date {
  return toZonedTime(new Date(), BA_TIMEZONE)
}

/**
 * Convert a Buenos Aires local time to UTC ISO string.
 */
export function baToUTC(baDate: Date): string {
  return fromZonedTime(baDate, BA_TIMEZONE).toISOString()
}

/**
 * Format a UTC date string as Buenos Aires local time.
 * Example output: "Sunday, Dec 28 at 4:00 PM"
 */
export function formatInBA(utcDateStr: string): string {
  const utcDate = new Date(utcDateStr)
  const baDate = toZonedTime(utcDate, BA_TIMEZONE)
  return format(baDate, "EEEE, MMM d 'at' h:mm a")
}

// ============================================================================
// EVENT FORMATTING
// ============================================================================

/**
 * Format a single event for Claude's tool result.
 * Used by get_event_details, list_saved_events, etc.
 */
export function formatEventForClaude(event: EventWithVenue) {
  return {
    id: event.id,
    name: event.name,
    description: event.description_en,
    hasDetails: !!(event.description_en || event.description_es),
    venue: event.venue_name,
    venueAddress: event.venue_address,
    neighborhood: event.venue_neighborhood,
    dateTime: formatInBA(event.starts_at),
    endsAt: event.ends_at ? formatInBA(event.ends_at) : null,
    price: event.is_free ? 'Free' : event.price ? `$${event.price} ARS` : 'TBA',
    categories: event.categories,
    ticketUrl: event.ticket_url,
  }
}

/**
 * Format multiple events for Claude's tool result.
 * Includes count and limits to 10 events.
 */
export function formatEventsToolResult(events: EventWithVenue[]): string {
  return JSON.stringify({
    count: events.length,
    events: events.slice(0, 10).map(formatEventForClaude),
  })
}

/**
 * Format a single event with full details for Claude.
 * Used by get_event_details tool.
 */
export function formatEventDetailsForClaude(event: EventWithVenue) {
  return {
    id: event.id,
    name: event.name,
    description: event.description_en || event.description_es,
    venue: event.venue_name,
    venueAddress: event.venue_address,
    neighborhood: event.venue_neighborhood,
    dateTime: formatInBA(event.starts_at),
    endsAt: event.ends_at ? formatInBA(event.ends_at) : null,
    price: event.is_free ? 'Free' : event.price ? `$${event.price} ARS` : 'TBA',
    categories: event.categories,
    ticketUrl: event.ticket_url,
    link: event.link,
    imageUrl: event.image_url,
  }
}

// ============================================================================
// VENUE FORMATTING
// ============================================================================

/**
 * Format a venue for Claude's tool result.
 */
export function formatVenueForClaude(venue: Venue | null): string {
  if (!venue) {
    return JSON.stringify({ found: false, message: 'Venue not found' })
  }

  return JSON.stringify({
    found: true,
    venue: {
      name: venue.name,
      neighborhood: venue.neighborhood,
      address: venue.address,
      website: venue.website,
      instagram: venue.instagram_handle,
    },
  })
}

// ============================================================================
// SAVED EVENTS FORMATTING
// ============================================================================

/**
 * Format events for the list_saved_events tool.
 * Includes isPast flag for past/upcoming distinction.
 */
export function formatSavedEventsForClaude(events: EventWithVenue[]) {
  const now = new Date()
  return events.map(e => ({
    id: e.id,
    name: e.name,
    description: e.description_en,
    venue: e.venue_name,
    neighborhood: e.venue_neighborhood,
    dateTime: formatInBA(e.starts_at),
    price: e.is_free ? 'Free' : e.price ? `$${e.price} ARS` : 'TBA',
    categories: e.categories,
    isPast: new Date(e.starts_at) < now,
  }))
}
