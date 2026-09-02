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
import { Effect, Schema } from 'effect'

const VENTI_API_BASE = 'https://api.venti.live'
const VENTI_PAGE_SIZE = 200 // Max page size (verified: limit=200 works)
const AVAILABILITY_DELAY_MS = 120

// Buenos Aires city ID in Venti's city table (cityId 1 = Buenos Aires, AR)
const CABA_CITY_ID = 1

const ventiVenueSchema = Schema.Struct({
  id: Schema.Number,
  placeName: Schema.NullOr(Schema.String),
  readableAddress: Schema.NullOr(Schema.String),
  latitude: Schema.NullOr(Schema.Number),
  longitude: Schema.NullOr(Schema.Number),
  cityId: Schema.NullOr(Schema.Number),
  googleMapsPlaceId: Schema.NullOr(Schema.String),
  mapsUrl: Schema.NullOr(Schema.String),
})
const ventiEventSchema = Schema.Struct({
  id: Schema.Number,
  urlName: Schema.NullOr(Schema.String),
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  category: Schema.NullOr(Schema.String),
  status: Schema.NullOr(Schema.String),
  financialStatus: Schema.NullOr(Schema.String),
  startDate: Schema.NullOr(Schema.String),
  endDate: Schema.NullOr(Schema.String),
  venue: Schema.NullOr(ventiVenueSchema),
  placeName: Schema.NullOr(Schema.String),
  bannerImg: Schema.NullOr(Schema.String),
  promoImg: Schema.NullOr(Schema.String),
  currency: Schema.NullOr(Schema.String),
  producerId: Schema.NullOr(Schema.Number),
})
const ventiSearchResponseSchema = Schema.Struct({
  status: Schema.String,
  events: Schema.Array(ventiEventSchema),
  totalItems: Schema.Number,
  totalPages: Schema.Number,
  currentPage: Schema.Number,
})
const ventiAvailabilitySchema = Schema.Struct({
  status: Schema.String,
  minTicketPrice: Schema.NullOr(Schema.Number),
  allAvailableTicketsAreFree: Schema.Boolean,
  hasTicketsAvailableForSale: Schema.Boolean,
})

class VentiApiError extends Error {
  readonly _tag = 'VentiApiError'
}

/**
 * Fetch all upcoming events from Venti (all cities).
 *
 * Paginates through the full catalog (2 requests at limit=200 for ~314
 * events). No auth or special headers required.
 */
export async function fetchVentiEvents(): Promise<VentiEvent[]> {
  const program = Effect.gen(function* () {
    const events: VentiEvent[] = []
    let page = 1
    let totalPages = 1
    do {
      const response = yield* Effect.tryPromise({
        try: () => fetch(
          `${VENTI_API_BASE}/api/event/search?limit=${VENTI_PAGE_SIZE}&page=${page}`,
          { headers: { Accept: 'application/json' } }
        ),
        catch: (error) => new VentiApiError(error instanceof Error ? error.message : String(error)),
      })
      if (!response.ok) {
        return yield* Effect.fail(new VentiApiError(`Venti API error: ${response.status} ${response.statusText}`))
      }
      const raw = yield* Effect.tryPromise({
        try: () => response.json() as Promise<unknown>,
        catch: (error) => new VentiApiError(error instanceof Error ? error.message : String(error)),
      })
      const parsed = Schema.decodeUnknownResult(ventiSearchResponseSchema)(raw)
      if (parsed._tag !== 'Success') return yield* Effect.fail(new VentiApiError('Venti API returned malformed data'))
      if (parsed.success.status !== 'ok') {
        return yield* Effect.fail(new VentiApiError(`Venti API returned status: ${parsed.success.status}`))
      }
      events.push(...parsed.success.events.map((event) => event as unknown as VentiEvent))
      totalPages = parsed.success.totalPages
      page++
    } while (page <= totalPages)
    return events
  })
  return Effect.runPromise(program)
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
  const program = Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () => fetch(
        `${VENTI_API_BASE}/api/event/urlName/${encodeURIComponent(urlName)}/ticketType/availability`,
        { headers: { Accept: 'application/json' } }
      ),
      catch: (error) => new VentiApiError(error instanceof Error ? error.message : String(error)),
    })
    if (!response.ok) return null
    const raw = yield* Effect.tryPromise({
      try: () => response.json() as Promise<unknown>,
      catch: (error) => new VentiApiError(error instanceof Error ? error.message : String(error)),
    })
    const parsed = Schema.decodeUnknownResult(ventiAvailabilitySchema)(raw)
    if (parsed._tag !== 'Success' || parsed.success.status !== 'ok') return null
    return {
      minTicketPrice: parsed.success.minTicketPrice,
      allAvailableTicketsAreFree: parsed.success.allAvailableTicketsAreFree,
      hasTicketsAvailableForSale: parsed.success.hasTicketsAvailableForSale,
    }
  })
  return Effect.runPromise(Effect.match(program, {
    onFailure: (error) => {
      console.error(`[venti] Failed to fetch availability for ${urlName}:`, error)
      return null
    },
    onSuccess: (value) => value,
  }))
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
