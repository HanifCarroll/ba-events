/**
 * Venti Event Types
 *
 * Types for events from Venti's public API (api.venti.live).
 * The catalog endpoint returns full event objects including descriptions.
 */

// Venue information from Venti
export interface VentiVenue {
  id: number
  placeName: string | null
  readableAddress: string | null
  latitude: number | null
  longitude: number | null
  cityId: number | null
  googleMapsPlaceId: string | null
  mapsUrl: string | null
}

// Raw event structure from Venti's /api/event/search response
export interface VentiEvent {
  // Core identifiers
  id: number
  urlName: string | null

  // Event details
  name: string
  description: string | null
  category: string | null // party | concert | festival | gastronomy
  status: string | null // active | ...
  financialStatus: string | null

  // Date/time (UTC ISO 8601)
  startDate: string | null
  endDate: string | null

  // Venue
  venue: VentiVenue | null
  placeName: string | null // Free-text venue name when venue object is null

  // Media
  bannerImg: string | null
  promoImg: string | null

  // Misc
  currency: string | null
  producerId: number | null
}

// Ticket availability (per-event price info)
export interface VentiTicketAvailability {
  minTicketPrice: number | null
  allAvailableTicketsAreFree: boolean
  hasTicketsAvailableForSale: boolean
}

// Venue info for settlement
export interface VentiVenueInfo {
  name: string
  address: string | null
  latitude: number | null
  longitude: number | null
}
