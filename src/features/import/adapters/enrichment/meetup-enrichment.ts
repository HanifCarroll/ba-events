/**
 * Meetup Enrichment Adapter
 *
 * Meetup enrichment uses server-side direct fetch because:
 * - Jina Reader returns HTTP 451 for Meetup pages
 * - Direct fetch with browser headers works fine
 *
 * Extraction methods:
 * - Description: `__NEXT_DATA__` props.pageProps.event.description
 * - Venue: JSON-LD `@type: Place` in Event location
 *
 * Language: Variable (needs detection)
 */

import type {
  EnrichmentAdapter,
  ServerEnrichmentResult,
  ServerEnrichmentOptions,
} from '../enrichment-types'
import type { MeetupPreviewEvent } from '@/features/import'
import { fetchMeetupDescriptionFromDetailPage } from '../../scrapers/meetup/description-enrichment'
import { fetchMeetupVenueFromUrl } from '../../scrapers/meetup/venue-enrichment'

export const meetupEnrichmentAdapter: EnrichmentAdapter<MeetupPreviewEvent> = {
  source: 'meetup',

  capabilities: {
    descriptions: true,
    venues: true,
  },

  config: {
    requiresClientSide: false,
    strategyReason: 'Jina returns HTTP 451; uses direct fetch with browser headers',
    // Language is variable for Meetup - needs detection
    knownLanguage: undefined,
    concurrency: 3,
    delayMs: 1000,
  },

  /**
   * SERVER-SIDE: Perform full enrichment for a single Meetup event
   * Extracts description from __NEXT_DATA__ and venue from JSON-LD
   */
  serverEnrich: async (
    link: string,
    options?: ServerEnrichmentOptions
  ): Promise<ServerEnrichmentResult | null> => {
    try {
      // Fetch description
      const description = await fetchMeetupDescriptionFromDetailPage(link)

      // Optionally fetch venue
      let venueName: string | null = null
      if (options?.extractVenue) {
        const venue = await fetchMeetupVenueFromUrl(link)
        venueName = venue?.name ?? null
      }

      // Return null if no description found (primary enrichment target)
      if (!description) {
        return null
      }

      // For Meetup, we don't know the language - let caller detect
      return {
        description_es: null, // Language unknown, needs detection
        description_en: description, // Store in en temporarily, caller will detect and move if needed
        venue_name: venueName,
      }
    } catch (error) {
      console.error('[Meetup Enrichment] Error:', error)
      return null
    }
  },

  /**
   * Get enrichment URL from a Meetup preview event
   * Uses meetup.eventUrl which is the detail page URL
   */
  getEnrichmentUrl: (event) => {
    // MeetupEvent has eventUrl, transformed has link
    // Prefer meetup.eventUrl as it's the canonical source
    return event.meetup.eventUrl ?? event.transformed[0]?.link ?? null
  },
}
