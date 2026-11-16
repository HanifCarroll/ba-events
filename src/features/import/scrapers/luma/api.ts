/**
 * Luma Events Scraper
 *
 * Reads the Buenos Aires discover page's events from Luma's JSON API, the same
 * call luma.com makes for the page. luma.com's HTML answers Cloudflare Worker
 * subrequests with 429; the API does not.
 *
 * No API key required - uses publicly available data.
 */

import type { LumaEvent, LumaVenue, LumaHost } from './types.ts'
import { fetchLumaJson } from './http.ts'

/** luma.com/buenos-aires */
const BUENOS_AIRES_PLACE = 'discplace-wX2J5xGwAJpznew'
const PAGE_LIMIT = 50
const MAX_PAGES = 20

/** Every entry the discover page lists, following the cursor. */
async function fetchDiscoverEntries(fetchImpl?: typeof fetch): Promise<unknown[]> {
  const entries: unknown[] = []
  let cursor: string | null = null
  for (let page = 0; page < MAX_PAGES; page++) {
    const query = new URLSearchParams({ discover_place_api_id: BUENOS_AIRES_PLACE, pagination_limit: String(PAGE_LIMIT) })
    if (cursor) query.set('pagination_cursor', cursor)
    const body = await fetchLumaJson(`/discover/get-paginated-events?${query}`, fetchImpl) as { entries?: unknown; has_more?: unknown; next_cursor?: unknown }
    if (!Array.isArray(body.entries)) throw new Error('Luma discover response has no entries')
    entries.push(...body.entries)
    if (body.has_more !== true || typeof body.next_cursor !== 'string') return entries
    cursor = body.next_cursor
  }
  throw new Error(`Luma discover pagination exceeded ${MAX_PAGES} pages`)
}

/**
 * Parse raw event data from Luma's data structure
 */
function parseEventsFromData(data: unknown): LumaEvent[] {
  if (!data || typeof data !== 'object') {
    return []
  }

  const events: LumaEvent[] = []

  // Helper to recursively find events in the data structure
  function findEvents(obj: unknown, depth = 0): void {
    if (depth > 10 || !obj || typeof obj !== 'object') return

    // Check if this object looks like an event
    if (isLumaEventLike(obj)) {
      const event = parseRawEvent(obj as Record<string, unknown>)
      if (event) {
        events.push(event)
      }
      return
    }

    // Search arrays
    if (Array.isArray(obj)) {
      for (const item of obj) {
        findEvents(item, depth + 1)
      }
      return
    }

    // Search object properties
    for (const value of Object.values(obj)) {
      findEvents(value, depth + 1)
    }
  }

  findEvents(data)
  return events
}

/**
 * Check if an object looks like a Luma event
 */
function isLumaEventLike(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object') return false
  const record = obj as Record<string, unknown>

  // Must have api_id starting with "evt-" and a name
  return (
    typeof record.api_id === 'string' &&
    record.api_id.startsWith('evt-') &&
    typeof record.name === 'string' &&
    record.name.length > 0
  )
}

/**
 * Parse a raw event object into our LumaEvent type
 */
function parseRawEvent(raw: Record<string, unknown>): LumaEvent | null {
  try {
    const api_id = raw.api_id as string
    const name = raw.name as string

    // Extract start time
    const start_at = (raw.start_at || raw.startDate || raw.start) as string | undefined
    if (!start_at) return null

    // Extract venue info
    let venue: LumaVenue | null = null
    const rawVenue = raw.geo_address_json || raw.venue || raw.location
    if (rawVenue && typeof rawVenue === 'object') {
      const v = rawVenue as Record<string, unknown>
      venue = {
        name: (v.name || v.place_name || null) as string | null,
        address: (v.address || v.street_address || null) as string | null,
        city: (v.city || v.locality || null) as string | null,
        latitude: typeof v.latitude === 'number' ? v.latitude : null,
        longitude: typeof v.longitude === 'number' ? v.longitude : null,
        full_address: (v.full_address || v.formatted_address || null) as string | null,
      }
    }

    // Extract host info
    let host: LumaHost | null = null
    const rawHost = raw.host || raw.organizer || raw.hosts
    if (rawHost && typeof rawHost === 'object' && !Array.isArray(rawHost)) {
      const h = rawHost as Record<string, unknown>
      host = {
        name: (h.name || h.display_name || null) as string | null,
        avatar_url: (h.avatar_url || h.avatar || null) as string | null,
      }
    } else if (Array.isArray(rawHost) && rawHost.length > 0) {
      const h = rawHost[0] as Record<string, unknown>
      host = {
        name: (h.name || h.display_name || null) as string | null,
        avatar_url: (h.avatar_url || h.avatar || null) as string | null,
      }
    }

    // Build the URL - Luma uses short codes
    let url = (raw.url || raw.event_url || '') as string
    if (!url && api_id) {
      // Try to extract the short code from api_id or use a slug
      const slug = (raw.slug || raw.url_slug || '') as string
      url = slug ? `https://luma.com/${slug}` : ''
    }
    if (url && !url.startsWith('http')) {
      url = `https://luma.com${url.startsWith('/') ? '' : '/'}${url}`
    }

    return {
      api_id,
      url,
      name,
      description: (raw.description || raw.description_md || null) as string | null,
      start_at,
      end_at: (raw.end_at || raw.endDate || raw.end || null) as string | null,
      timezone: (raw.timezone || 'America/Buenos_Aires') as string,
      venue,
      cover_url: (raw.cover_url || raw.cover_image_url || raw.image || null) as string | null,
      is_free: Boolean(raw.is_free ?? raw.isFree ?? true),
      price: typeof raw.price === 'number' ? raw.price : null,
      host,
      guest_count: typeof raw.guest_count === 'number' ? raw.guest_count : 0,
    }
  } catch {
    return null
  }
}

/**
 * Fetch all events from the Luma Buenos Aires listing
 *
 * Returns raw Luma events (not transformed to EventInsert yet)
 */
export async function fetchLumaEvents(fetchImpl?: typeof fetch): Promise<LumaEvent[]> {
  const events = parseEventsFromData(await fetchDiscoverEntries(fetchImpl))
  if (events.length === 0) console.warn('[Luma] No events parsed from the discover API')
  return events
}

/**
 * Filter events by date range
 *
 * Uses start_at for filtering (ISO 8601 format)
 */
export function filterByDateRange(
  events: LumaEvent[],
  startDate: string,
  endDate: string
): LumaEvent[] {
  const start = new Date(startDate)
  const end = new Date(endDate)
  end.setHours(23, 59, 59, 999) // Include entire end day

  return events.filter((event) => {
    const eventDate = new Date(event.start_at)
    return eventDate >= start && eventDate <= end
  })
}

/**
 * Get venue name from event
 */
export function getVenueName(event: LumaEvent): string | null {
  return event.venue?.name || null
}

/**
 * Get venue address as a single string
 */
export function getVenueAddress(event: LumaEvent): string | null {
  if (!event.venue) return null

  // Prefer full_address if available
  if (event.venue.full_address) {
    return event.venue.full_address
  }

  // Otherwise combine parts
  const parts = [event.venue.address, event.venue.city].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : null
}
