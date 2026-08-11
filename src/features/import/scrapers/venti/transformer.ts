/**
 * Data Transformer for Venti Events
 *
 * Transforms Venti events into our EventInsert format.
 * Venti provides Spanish descriptions natively, so description_es is filled
 * at import time (no enrichment phase needed for the core data).
 */

import { toZonedTime } from 'date-fns-tz'
import type { EventInsert, Category } from '@/shared/lib/types'
import { BA_TIMEZONE } from '@/shared/lib/constants'
import {
  normalizeTitle,
  normalizeDescription,
  normalizeUrl,
  normalizeImageUrl,
} from '../shared/normalization'
import type { VentiEvent, VentiTicketAvailability, VentiVenueInfo } from './types'

/**
 * Map Venti's native categories to our 6 intent-based categories.
 * party -> social (nightlife), concert -> music, etc.
 */
const VENTI_CATEGORY_MAP: Record<string, Category> = {
  party: 'social',
  concert: 'music',
  festival: 'festival',
  gastronomy: 'food',
}

/**
 * Map a Venti category to our category system.
 * Returns null for unknown/absent categories (AI fallback applies).
 */
export function mapVentiCategory(category: string | null): Category | null {
  if (!category) return null
  return VENTI_CATEGORY_MAP[category] ?? null
}

/**
 * Transform a Venti event into our EventInsert format.
 *
 * Prices: minTicketPrice in ARS from the availability endpoint.
 * Dates: Venti emits UTC ISO strings; stored as-is (timestamptz).
 */
export function transformVentiEvent(
  event: VentiEvent,
  venueId: string | null,
  availability: VentiTicketAvailability | null
): EventInsert {
  const startsAt = event.startDate
  const endsAt = event.endDate || null

  // Check if it's an all-day event: genuinely spans multiple full days
  // (>= 24h across two BA calendar days). Same logic as the Luma transformer.
  let isAllDay = false
  if (endsAt && startsAt) {
    const start = toZonedTime(new Date(startsAt), BA_TIMEZONE)
    const end = toZonedTime(new Date(endsAt), BA_TIMEZONE)
    const spansDays = start.toDateString() !== end.toDateString()
    const durationHours = (end.getTime() - start.getTime()) / 3600000
    isAllDay = spansDays && durationHours >= 24
  }

  const category = mapVentiCategory(event.category)
  const isFree = availability?.allAvailableTicketsAreFree ?? false
  // Venti's minTicketPrice is in cents (hundredths of ARS), like Luma.
  // e.g. 1500000 = $15.000 ARS.
  const price = availability?.minTicketPrice != null ? availability.minTicketPrice / 100 : null
  const link = event.urlName ? `https://venti.live/evento/${event.urlName}` : null

  return {
    name: normalizeTitle(event.name),
    description_es: normalizeDescription(event.description),
    description_en: null,
    starts_at: startsAt ?? '',
    ends_at: endsAt,
    is_all_day: isAllDay,
    venue_id: venueId,
    categories: category ? [category] : [], // AI fallback fills unknown categories
    price: isFree ? null : price,
    is_free: isFree,
    image_url: normalizeImageUrl(event.bannerImg),
    link: normalizeUrl(link),
    ticket_url: normalizeUrl(link), // Same as event URL for Venti
    source: 'venti',
    external_id: String(event.id),
    status: 'scheduled',
  }
}

/**
 * Get all unique venue info from events for venue settlement.
 * Keyed by venue name (same pattern as other scrapers).
 */
export function getAllVenueInfo(events: VentiEvent[]): Map<string, VentiVenueInfo> {
  const venueInfoMap = new Map<string, VentiVenueInfo>()

  for (const event of events) {
    if (!event.venue?.placeName) continue
    const name = event.venue.placeName
    if (venueInfoMap.has(name)) continue

    venueInfoMap.set(name, {
      name,
      address: event.venue.readableAddress,
      latitude: event.venue.latitude,
      longitude: event.venue.longitude,
    })
  }

  return venueInfoMap
}

/**
 * Get the venue name for an event (for matching venue results back).
 */
export function getVenueName(event: VentiEvent): string | null {
  return event.venue?.placeName || event.placeName || null
}
