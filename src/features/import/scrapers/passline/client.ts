/**
 * Client-side Passline API fetch
 *
 * This runs in the browser, which can handle Cloudflare challenges.
 * Server-side fetch is blocked by Cloudflare.
 */

import type { PasslineEvent, DateRange } from './api'
import { isBlockedEvent } from '../shared'
import { PASSLINE_BLOCKLIST } from '../../config/blocklist'

const PASSLINE_API_URL = 'https://api.passline.com/v1/event/GetCountryByBillboardHome'

/**
 * Fetch events from Passline API (client-side only)
 */
export async function fetchPasslineEventsClient(): Promise<PasslineEvent[]> {
  const response = await fetch(PASSLINE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({ country: 'argentina' }),
  })

  if (!response.ok) {
    throw new Error(`Passline API error: ${response.status} ${response.statusText}`)
  }

  const data = await response.json()
  return data.BillboardByCountry || []
}

/**
 * Filter events to only include CABA (Capital Federal) events
 * Also excludes "VARIAS LOCACIONES" which are venue rental ads, not real events
 * Also applies the blocklist to filter out advertisement events
 */
export function filterCABAEventsClient(events: PasslineEvent[]): PasslineEvent[] {
  return events
    .filter((e) => e.nombre_region === 'Capital Federal' && e.lugar !== 'VARIAS LOCACIONES')
    .filter((e) => !isBlockedEvent(e.nombre, e.lugar, PASSLINE_BLOCKLIST))
}

/**
 * Filter events by date range
 */
export function filterByDateRangeClient(
  events: PasslineEvent[],
  dateRange: DateRange
): PasslineEvent[] {
  return events.filter((event) => {
    const eventDate = event.fecha_inicio
    return eventDate >= dateRange.startDate && eventDate <= dateRange.endDate
  })
}
