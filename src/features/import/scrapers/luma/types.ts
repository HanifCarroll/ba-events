/**
 * Luma Event Types
 *
 * Types for events scraped from Luma Buenos Aires listing.
 * Luma embeds event data as JSON in the page.
 */

// Venue information from Luma
export interface LumaVenue {
  name: string | null
  address: string | null
  city: string | null
  latitude: number | null
  longitude: number | null
  full_address: string | null
}

// Host/organizer information
export interface LumaHost {
  name: string | null
  avatar_url: string | null
}

// Raw event structure from Luma's embedded JSON
export interface LumaEvent {
  // Core identifiers
  api_id: string
  url: string // Event page URL path (e.g., "/nk0ojnzi")

  // Event details
  name: string
  description: string | null

  // Date/time (ISO 8601 format)
  start_at: string
  end_at: string | null
  timezone: string

  // Venue
  venue: LumaVenue | null

  // Media
  cover_url: string | null

  // Pricing
  is_free: boolean
  price: number | null // In cents if available

  // Host
  host: LumaHost | null

  // Registration
  guest_count: number
}

// Venue info for matching
export interface LumaVenueInfo {
  name: string
  address: string | null
  latitude: number | null
  longitude: number | null
}
