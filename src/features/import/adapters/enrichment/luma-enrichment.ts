/**
 * Luma Enrichment Adapter
 *
 * Luma enrichment uses server-side direct fetch:
 * - Works well with direct HTTP requests
 * - No Cloudflare blocking issues
 *
 * Extraction methods:
 * - Description: `__NEXT_DATA__` → JSON-LD → meta tags (fallback chain)
 * - Venue: `__NEXT_DATA__` geo_address_json/venue/location → JSON-LD
 *
 * Language: Variable (needs detection - could be English or Spanish)
 */

import type {
  EnrichmentAdapter,
  ServerEnrichmentResult,
  ServerEnrichmentOptions,
} from '../enrichment-types'
import type { LumaPreviewEvent } from '@/features/import'
import { fetchLumaDescriptionFromDetailPage } from '../../scrapers/luma/description-enrichment'
import { fetchLumaVenueFromUrl } from '../../scrapers/luma/venue-enrichment'

export const lumaEnrichmentAdapter: EnrichmentAdapter<LumaPreviewEvent> = {
  source: 'luma',

  capabilities: {
    descriptions: true,
    venues: true,
  },

  config: {
    requiresClientSide: false,
    strategyReason: 'Direct fetch works; extracts from __NEXT_DATA__ and JSON-LD',
    // Language is variable for Luma - needs detection
    knownLanguage: undefined,
    concurrency: 3,
    delayMs: 1000,
  },

  /**
   * SERVER-SIDE: Perform full enrichment for a single Luma event
   * Extracts description from __NEXT_DATA__/JSON-LD and venue from structured data
   */
  serverEnrich: async (
    link: string,
    options?: ServerEnrichmentOptions
  ): Promise<ServerEnrichmentResult | null> => {
    try {
      // Fetch description
      const description = await fetchLumaDescriptionFromDetailPage(link)

      // Optionally fetch venue
      let venueName: string | null = null
      if (options?.extractVenue) {
        const venue = await fetchLumaVenueFromUrl(link)
        venueName = venue?.name ?? null
      }

      // Return null if no description found (primary enrichment target)
      if (!description) {
        return null
      }

      // For Luma, we don't know the language - let caller detect
      return {
        description_es: null, // Language unknown, needs detection
        description_en: description, // Store in en temporarily, caller will detect and move if needed
        venue_name: venueName,
      }
    } catch (error) {
      console.error('[Luma Enrichment] Error:', error)
      return null
    }
  },

  /**
   * Get enrichment URL from a Luma preview event
   * Uses luma.url which is the event page path (e.g., "/nk0ojnzi")
   */
  getEnrichmentUrl: (event) => {
    // LumaEvent has url (path), transformed has link (full URL)
    // Prefer the full link from transformed
    if (event.transformed.link) {
      return event.transformed.link
    }
    // Construct full URL from path if needed
    if (event.luma.url) {
      return `https://lu.ma${event.luma.url.startsWith('/') ? '' : '/'}${event.luma.url}`
    }
    return null
  },
}
