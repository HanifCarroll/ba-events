/**
 * Data Transformer for Passline Events
 *
 * Transforms Passline API responses into our EventInsert format.
 * Categories are assigned via AI during import.
 */

import { fromZonedTime } from 'date-fns-tz'
import type { EventInsert } from '#shared/lib/types.ts'
import type { PasslineEvent } from './api.ts'
import {
  normalizeTitle,
  normalizePrice,
  normalizeUrl,
  normalizeImageUrl,
} from '../shared/normalization.ts'
import { BA_TIMEZONE } from '#shared/lib/constants.ts'

/**
 * Combine date and time strings into ISO datetime string
 * Passline provides dates in YYYY-MM-DD and times in HH:mm:ss
 * All times are in Argentina timezone - we explicitly convert to UTC
 */
function combineDateTime(date: string, time: string): string {
  const datetime = `${date}T${time}`
  const localDate = new Date(datetime)

  // If invalid date, return midnight BA time converted to UTC
  if (isNaN(localDate.getTime())) {
    return fromZonedTime(new Date(`${date}T00:00:00`), BA_TIMEZONE).toISOString()
  }

  // Explicitly convert BA time to UTC
  return fromZonedTime(localDate, BA_TIMEZONE).toISOString()
}

/**
 * Transform a Passline event into our EventInsert format
 */
export function transformPasslineEvent(
  event: PasslineEvent,
  venueId: string | null
): EventInsert {
  const price = normalizePrice(event.precio_min)
  const timeTba = event.hora_inicio === '00:00:00' && event.hora_termino === '00:00:00'

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
    time_tba: timeTba,
    venue_id: venueId,
    categories: [], // Assigned via AI during import
    price: price,
    is_free: price === 0 || price === null,
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
