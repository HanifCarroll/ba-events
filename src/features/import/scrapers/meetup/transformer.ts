/**
 * Data Transformer for Meetup Events
 *
 * Transforms raw Meetup event data into EventInsert format.
 * Categories are assigned via AI during import.
 */

import type { EventInsert } from '@/shared/lib/types'
import type { MeetupEvent } from './types'
import { parseMeetupDate, expandRecurringEventWithIds } from './date-parser'
import {
  normalizeTitle,
  normalizeDescription,
  normalizeUrl,
  normalizePrice,
  normalizeImageUrl,
} from '../shared/normalization'

/**
 * Generate unique external ID for a Meetup event
 */
function generateMeetupExternalId(event: MeetupEvent, dateStr?: string): string {
  // Use Meetup's event ID if available
  if (event.id) {
    if (dateStr) {
      // For recurring events, append the date
      const dateOnly = dateStr.split('T')[0]
      return `meetup-${event.id}-${dateOnly}`
    }
    return `meetup-${event.id}`
  }

  // Fallback: hash of name + date
  const normalized = event.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .substring(0, 50)
  const dateOnly = (dateStr || event.dateTime).split('T')[0]

  return `meetup-${normalized}-${dateOnly}`
}

/**
 * Transform a single Meetup event to EventInsert format
 * For non-recurring events
 */
export function transformMeetupEvent(
  event: MeetupEvent,
  venueId: string | null
): EventInsert {
  const startsAt = parseMeetupDate(event.dateTime)
  const endsAt = event.endTime ? parseMeetupDate(event.endTime) : null
  const price = normalizePrice(event.price)

  return {
    name: normalizeTitle(event.name),
    description_es: normalizeDescription(event.description),
    description_en: normalizeDescription(event.description), // Meetup events are often in English
    starts_at: startsAt,
    ends_at: endsAt,
    is_all_day: false,
    venue_id: venueId,
    categories: [], // Assigned via AI during import
    price: price,
    is_free: price === null || price === 0,
    image_url: normalizeImageUrl(event.imageUrl),
    link: normalizeUrl(event.eventUrl),
    ticket_url: normalizeUrl(event.eventUrl),
    source: 'meetup',
    external_id: generateMeetupExternalId(event),
    status: 'scheduled',
  }
}

/**
 * Transform a Meetup event to EventInsert format(s)
 * Handles recurring events by expanding them into multiple events
 *
 * @param event - The raw Meetup event
 * @param venueId - The venue ID if matched
 * @param weeksAhead - Number of weeks to expand recurring events (default: 4)
 * @returns Array of EventInsert objects
 */
export function transformMeetupEventWithExpansion(
  event: MeetupEvent,
  venueId: string | null,
  weeksAhead: number = 4
): EventInsert[] {
  // If not recurring, return single event
  if (!event.isRecurring || !event.recurrencePattern) {
    return [transformMeetupEvent(event, venueId)]
  }

  // Expand recurring event
  const expanded = expandRecurringEventWithIds(
    event.id,
    event.dateTime,
    event.recurrencePattern,
    weeksAhead
  )

  const price = normalizePrice(event.price)

  return expanded.map(({ date, id: expandedId }) => {
    const startsAt = date
    // Calculate end time if available (same duration as original)
    let endsAt: string | null = null
    if (event.endTime) {
      const originalStart = new Date(event.dateTime)
      const originalEnd = new Date(event.endTime)
      const duration = originalEnd.getTime() - originalStart.getTime()
      endsAt = new Date(new Date(date).getTime() + duration).toISOString()
    }

    return {
      name: normalizeTitle(event.name),
      description_es: normalizeDescription(event.description),
      description_en: normalizeDescription(event.description),
      starts_at: startsAt,
      ends_at: endsAt,
      is_all_day: false,
      venue_id: venueId,
      categories: [], // Assigned via AI during import
      price: price,
      is_free: price === null || price === 0,
      image_url: normalizeImageUrl(event.imageUrl),
      link: normalizeUrl(event.eventUrl),
      ticket_url: normalizeUrl(event.eventUrl),
      source: 'meetup',
      external_id: `meetup-${expandedId}`,
      status: 'scheduled',
    }
  })
}

/**
 * Transform multiple Meetup events to EventInsert format
 * Handles venue ID mapping and recurring event expansion
 */
export function transformMeetupEvents(
  events: MeetupEvent[],
  venueIdMap: Map<string, string | null>,
  expandRecurring: boolean = true,
  weeksAhead: number = 4
): EventInsert[] {
  const results: EventInsert[] = []

  for (const event of events) {
    const venueName = event.venue?.name || ''
    const venueId = venueIdMap.get(venueName) || null

    if (expandRecurring && event.isRecurring) {
      const expanded = transformMeetupEventWithExpansion(event, venueId, weeksAhead)
      results.push(...expanded)
    } else {
      results.push(transformMeetupEvent(event, venueId))
    }
  }

  return results
}

/**
 * Get unique venue names from Meetup events
 * Used for venue matching
 */
export function getUniqueVenueNames(events: MeetupEvent[]): string[] {
  const names = new Set<string>()
  for (const event of events) {
    if (event.venue?.name) {
      names.add(event.venue.name)
    }
  }
  return Array.from(names)
}

/**
 * Get unique group names from Meetup events
 */
export function getUniqueGroupNames(events: MeetupEvent[]): string[] {
  const names = new Set<string>()
  for (const event of events) {
    if (event.group?.name) {
      names.add(event.group.name)
    }
  }
  return Array.from(names)
}
