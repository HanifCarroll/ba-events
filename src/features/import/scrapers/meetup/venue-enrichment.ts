import { fetchMeetupEventDetail } from './detail.ts'
import { logger } from '#shared/lib/logger.ts'

export interface MeetupVenueInfo {
  name: string
  address: string | null
  city?: string | null
  lat?: number | null
  lng?: number | null
}

export interface EnrichmentEvent {
  id: string
  eventUrl: string
}

export interface EnrichmentResult {
  eventId: string
  venue: MeetupVenueInfo | null
  error?: string
}

export async function fetchMeetupVenueFromUrl(eventUrl: string): Promise<MeetupVenueInfo | null> {
  const detail = await fetchMeetupEventDetail(eventUrl)
  return detail?.venue
    ? {
        name: detail.venue.name,
        address: detail.venue.address,
        city: detail.venue.city,
        lat: detail.venue.lat,
        lng: detail.venue.lng,
      }
    : null
}

export async function enrichMeetupEventsWithVenues(
  events: EnrichmentEvent[],
  concurrency: number = 3,
  delayMs: number = 1000
): Promise<EnrichmentResult[]> {
  if (events.length === 0) return []
  const results: EnrichmentResult[] = []
  logger.info('[Meetup Enrichment] Starting enrichment', { count: events.length })

  for (let i = 0; i < events.length; i += concurrency) {
    const batch = events.slice(i, i + concurrency)
    results.push(...await Promise.all(batch.map(async (event) => {
      try {
        return { eventId: event.id, venue: await fetchMeetupVenueFromUrl(event.eventUrl) }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error'
        logger.warn('[Meetup Enrichment] Error fetching venue', { eventId: event.id, error: errorMsg })
        return { eventId: event.id, venue: null, error: errorMsg }
      }
    })))
    if (i + concurrency < events.length) await new Promise((resolve) => setTimeout(resolve, delayMs))
  }
  return results
}
