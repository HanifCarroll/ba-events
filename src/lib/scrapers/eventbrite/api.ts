/**
 * Eventbrite JSON-LD Scraper
 *
 * Fetches events from Eventbrite's public listing pages by extracting
 * embedded JSON-LD structured data (schema.org format).
 *
 * No API key required - uses publicly available data.
 */

// JSON-LD Address structure
export interface EventbriteAddress {
  '@type': 'PostalAddress'
  streetAddress?: string
  addressLocality?: string
  addressRegion?: string
  postalCode?: string
  addressCountry?: string
}

// JSON-LD GeoCoordinates structure
export interface EventbriteGeoCoordinates {
  '@type': 'GeoCoordinates'
  latitude: string
  longitude: string
}

// JSON-LD Location structure
export interface EventbriteLocation {
  '@type': 'Place'
  name?: string
  address?: EventbriteAddress
  geo?: EventbriteGeoCoordinates
}

// JSON-LD Event structure from Eventbrite
export interface EventbriteEvent {
  '@type': 'Event'
  name: string
  description?: string
  startDate: string // "YYYY-MM-DD" format
  endDate: string // "YYYY-MM-DD" format
  url: string
  image?: string
  eventAttendanceMode?: string // "https://schema.org/OfflineEventAttendanceMode" | "https://schema.org/OnlineEventAttendanceMode"
  location?: EventbriteLocation
}

// JSON-LD ItemList wrapper
interface EventbriteJsonLdResponse {
  '@context': string
  '@type': 'ItemList'
  itemListElement: Array<{
    '@type': 'ListItem'
    position: number
    item: EventbriteEvent
  }>
}

const EVENTBRITE_BUENOS_AIRES_URL =
  'https://www.eventbrite.com.ar/d/argentina--buenos-aires/events/'

/**
 * Fetch Eventbrite listing page HTML
 */
async function fetchEventbritePage(url: string = EVENTBRITE_BUENOS_AIRES_URL): Promise<string> {
  const response = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
    },
  })

  if (!response.ok) {
    throw new Error(`Eventbrite fetch failed: ${response.status} ${response.statusText}`)
  }

  return response.text()
}

/**
 * Extract JSON-LD data from HTML
 */
function extractJsonLd(html: string): EventbriteJsonLdResponse | null {
  // Find JSON-LD script tag
  const jsonLdMatch = html.match(
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i
  )

  if (!jsonLdMatch) {
    return null
  }

  try {
    const data = JSON.parse(jsonLdMatch[1])
    if (data['@type'] === 'ItemList') {
      return data as EventbriteJsonLdResponse
    }
    return null
  } catch {
    return null
  }
}

/**
 * Fetch all events from Eventbrite Buenos Aires listing
 *
 * Returns raw JSON-LD events (not transformed to EventInsert yet)
 */
export async function fetchEventbriteEvents(
  url: string = EVENTBRITE_BUENOS_AIRES_URL
): Promise<EventbriteEvent[]> {
  const html = await fetchEventbritePage(url)
  const jsonLd = extractJsonLd(html)

  if (!jsonLd) {
    throw new Error('No JSON-LD data found on Eventbrite page')
  }

  return jsonLd.itemListElement.map((item) => item.item)
}

/**
 * Filter for in-person events only (exclude online events)
 */
export function filterInPersonEvents(events: EventbriteEvent[]): EventbriteEvent[] {
  return events.filter(
    (event) => event.eventAttendanceMode !== 'https://schema.org/OnlineEventAttendanceMode'
  )
}

/**
 * Filter events by date range
 *
 * Uses startDate for filtering (format: YYYY-MM-DD)
 */
export function filterByDateRange(
  events: EventbriteEvent[],
  startDate: string,
  endDate: string
): EventbriteEvent[] {
  return events.filter((event) => {
    const eventDate = event.startDate
    return eventDate >= startDate && eventDate <= endDate
  })
}

/**
 * Check if an event is online-only
 */
export function isOnlineEvent(event: EventbriteEvent): boolean {
  return event.eventAttendanceMode === 'https://schema.org/OnlineEventAttendanceMode'
}

/**
 * Get venue name from event location
 */
export function getVenueName(event: EventbriteEvent): string | null {
  return event.location?.name || null
}

/**
 * Get venue address as a single string
 */
export function getVenueAddress(event: EventbriteEvent): string | null {
  const address = event.location?.address
  if (!address) return null

  const parts = [
    address.streetAddress,
    address.addressLocality,
    address.addressRegion,
    address.postalCode,
  ].filter(Boolean)

  return parts.length > 0 ? parts.join(', ') : null
}

/**
 * Extract event ID from Eventbrite URL
 *
 * URL format: https://www.eventbrite.com.ar/e/event-name-tickets-1234567890
 * Returns: "1234567890"
 */
export function extractEventId(url: string): string | null {
  const match = url.match(/tickets-(\d+)/)
  return match ? match[1] : null
}
