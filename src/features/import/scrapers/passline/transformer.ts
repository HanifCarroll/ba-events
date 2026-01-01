/**
 * Data Transformer for Passline Events
 *
 * Transforms Passline API responses into our EventInsert format.
 * Categories are assigned via AI during import.
 */

import type { EventInsert } from '@/shared/lib/types'
import type { PasslineEvent } from './api'
import {
  normalizeTitle,
  normalizePrice,
  normalizeUrl,
  normalizeImageUrl,
} from '../shared/normalization'

/**
 * Combine date and time strings into ISO datetime string
 * Passline provides dates in YYYY-MM-DD and times in HH:mm:ss
 * All times are in Argentina timezone (UTC-3)
 */
function combineDateTime(date: string, time: string): string {
  // Create datetime string in local format
  const datetime = `${date}T${time}`

  // Parse as local time (Argentina) and convert to UTC ISO string
  // Note: This assumes the server is in Argentina timezone or we handle TZ properly
  const localDate = new Date(datetime)

  // If invalid date, return as-is with midnight
  if (isNaN(localDate.getTime())) {
    return `${date}T00:00:00.000Z`
  }

  return localDate.toISOString()
}

/**
 * Transform a Passline event into our EventInsert format
 */
export function transformPasslineEvent(
  event: PasslineEvent,
  venueId: string | null
): EventInsert {
  const price = normalizePrice(event.precio_min)

  return {
    name: normalizeTitle(event.nombre),
    description_es: null, // Fetched separately via description enrichment flow
    description_en: null,
    starts_at: combineDateTime(event.fecha_inicio, event.hora_inicio),
    ends_at:
      event.fecha_termino && event.hora_termino
        ? combineDateTime(event.fecha_termino, event.hora_termino)
        : null,
    is_all_day: false,
    venue_id: venueId,
    categories: [], // Assigned via AI during import
    price: price,
    is_free: price === 0 || price === null,
    min_age: null, // Passline doesn't provide this
    image_url: normalizeImageUrl(event.recorte || event.miniatura || null),
    link: normalizeUrl(event.url),
    ticket_url: normalizeUrl(event.url),
    source: 'passline',
    external_id: event.id,
    status: 'scheduled',
  }
}

/**
 * Batch transform multiple events
 */
export function transformPasslineEvents(
  events: PasslineEvent[],
  venueIdMap: Map<string, string | null>
): EventInsert[] {
  return events.map((event) => {
    const venueId = venueIdMap.get(event.lugar) || null
    return transformPasslineEvent(event, venueId)
  })
}
