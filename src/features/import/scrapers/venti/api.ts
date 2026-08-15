/**
 * Venti Events Scraper
 *
 * Fetches events from Venti's public API (api.venti.live).
 *
 * Verified (2026-08-10): the API works server-side with no auth headers and
 * no browser — `access-control-allow-origin: *`, plain GETs from datacenter
 * IPs return HTTP 200. The catalog endpoint returns full event objects
 * including Spanish descriptions, so no per-event detail fetches are needed
 * for the core import. Prices come from the per-event availability endpoint
 * and are only required for events we actually import.
 */

import { delay } from '../../core/nominatim.ts'
import type { VentiEvent, VentiTicketAvailability } from './types.ts'

const VENTI_API_BASE = 'https://api.venti.live'
const VENTI_PAGE_SIZE = 200 // Max page size (verified: limit=200 works)
const AVAILABILITY_DELAY_MS = 120

// Buenos Aires city ID in Venti's city table (cityId 1 = Buenos Aires, AR)
const CABA_CITY_ID = 1

interface VentiSearchResponse {
  status: string
  events: VentiEvent[]
  totalItems: number
  totalPages: number
  currentPage: number
}

/**
 * Fetch all upcoming events from Venti (all cities).
 *
 * Paginates through the full catalog (2 requests at limit=200 for ~314
 * events). No auth or special headers required.
 */
export async function fetchVentiEvents(): Promise<VentiEvent[]> {
  const events: VentiEvent[] = []
  let page = 1
  let totalPages = 1

  do {
    const res = await fetch(
      `${VENTI_API_BASE}/api/event/search?limit=${VENTI_PAGE_SIZE}&page=${page}`,
      { headers: { Accept: 'application/json' } }
    )

    if (!res.ok) {
      throw new Error(`Venti API error: ${res.status} ${res.statusText}`)
    }

    const data = (await res.json()) as VentiSearchResponse
    if (data.status !== 'ok') {
      throw new Error(`Venti API returned status: ${data.status}`)
    }

    events.push(...data.events)
    totalPages = data.totalPages
    page++
  } while (page <= totalPages)

  return events
}

/**
 * Filter events to Buenos Aires (CABA) only.
 *
 * Venti covers all of Argentina; we only import events whose venue is in
 * cityId 1 (Buenos Aires).
 */
export function filterCABAEvents(events: VentiEvent[]): VentiEvent[] {
  return events.filter((event) => event.venue?.cityId === CABA_CITY_ID)
}

/**
 * Fetch ticket availability (min price + free flag) for a single event.
 *
 * Returns null on any error — price is best-effort enrichment, not core data.
 */
export async function fetchVentiTicketAvailability(
  urlName: string
): Promise<VentiTicketAvailability | null> {
  try {
    const res = await fetch(
      `${VENTI_API_BASE}/api/event/urlName/${encodeURIComponent(urlName)}/ticketType/availability`,
      { headers: { Accept: 'application/json' } }
    )

    if (!res.ok) return null

    const data = (await res.json()) as {
      status: string
      minTicketPrice: number | null
      allAvailableTicketsAreFree: boolean
      hasTicketsAvailableForSale: boolean
    }

    if (data.status !== 'ok') return null

    return {
      minTicketPrice: data.minTicketPrice ?? null,
      allAvailableTicketsAreFree: data.allAvailableTicketsAreFree ?? false,
      hasTicketsAvailableForSale: data.hasTicketsAvailableForSale ?? false,
    }
  } catch (error) {
    console.error(`[venti] Failed to fetch availability for ${urlName}:`, error)
    return null
  }
}

/**
 * Fetch availability for a batch of events, sequentially with a small delay
 * to stay polite to the API.
 */
export async function fetchVentiAvailabilityBatch(
  events: VentiEvent[]
): Promise<Map<number, VentiTicketAvailability | null>> {
  const availability = new Map<number, VentiTicketAvailability | null>()

  for (const event of events) {
    if (!event.urlName) continue
    const result = await fetchVentiTicketAvailability(event.urlName)
    availability.set(event.id, result)
    await delay(AVAILABILITY_DELAY_MS)
  }

  return availability
}
