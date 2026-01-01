/**
 * Data Transformer for BA Tourism Events
 *
 * Transforms scraped BA Tourism events into our EventInsert format.
 * Categories are assigned via AI during import.
 */

import type { EventInsert } from '@/shared/lib/types'
import type { BATourismEvent, WeekContext } from './types'
import { parseSpanishDate, toISODateTime, getEndTimeISO } from './date-parser'
import { format } from 'date-fns'

/**
 * Generate a unique external ID for deduplication
 * Format: ba-tourism-{normalized-name}-{date}
 */
function generateExternalId(name: string, date: Date): string {
  const normalizedName = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50)

  const dateStr = format(date, 'yyyy-MM-dd')

  return `ba-tourism-${normalizedName}-${dateStr}`
}

/**
 * Transform a single BA Tourism event into EventInsert entries
 * Returns multiple entries for multi-date events
 */
export function transformBATourismEvent(
  event: BATourismEvent,
  weekContext: WeekContext,
  venueId: string | null,
  referenceDate: Date = new Date()
): EventInsert[] {
  const results: EventInsert[] = []

  // Parse dates from Spanish text
  const parsedDates = parseSpanishDate(event.whenText, weekContext, referenceDate)

  // Create one EventInsert per date
  for (const parsed of parsedDates) {
    const startsAt = toISODateTime(parsed)
    const endsAt = getEndTimeISO(parsed)

    const eventInsert: EventInsert = {
      name: event.name,
      description_es: event.description || null,
      description_en: null, // Will be enriched later
      starts_at: startsAt,
      ends_at: endsAt,
      is_all_day: !parsed.startTime,
      venue_id: venueId,
      categories: [], // Assigned via AI during import
      price: null, // BA Tourism doesn't provide specific prices
      is_free: event.isFree,
      min_age: null,
      image_url: null, // Could be scraped from detail page later
      link: event.moreInfoUrl || null,
      ticket_url: event.moreInfoUrl || null,
      source: 'ba-tourism',
      external_id: generateExternalId(event.name, parsed.date),
      status: 'scheduled',
    }

    results.push(eventInsert)
  }

  return results
}

/**
 * Batch transform multiple BA Tourism events
 */
export function transformBATourismEvents(
  events: BATourismEvent[],
  weekContext: WeekContext,
  venueIdMap: Map<string, string | null>,
  referenceDate: Date = new Date()
): EventInsert[] {
  const results: EventInsert[] = []

  for (const event of events) {
    const venueId = venueIdMap.get(event.venueName) || null
    const transformed = transformBATourismEvent(event, weekContext, venueId, referenceDate)
    results.push(...transformed)
  }

  return results
}

/**
 * Get unique venue names from events for batch matching
 */
export function getUniqueVenueNames(events: BATourismEvent[]): string[] {
  const names = new Set<string>()
  for (const event of events) {
    if (event.venueName) {
      names.add(event.venueName)
    }
  }
  return Array.from(names)
}
