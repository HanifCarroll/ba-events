/**
 * Luma Enrichment Adapter
 *
 * One read of Luma's JSON API (`api2.luma.com/event/get?event_api_id=<slug>`)
 * gives both the description (Prosemirror `description_mirror`) and the public
 * venue (`geo_address_info`). luma.com HTML answers Cloudflare Workers with 429.
 *
 * Language: Variable (needs detection - could be English or Spanish)
 */

import type {
  EnrichmentAdapter,
  ServerEnrichmentResult,
  ServerEnrichmentOptions,
} from '../enrichment-types.ts'
import { fetchLumaEventDetail } from '../../scrapers/luma/detail.ts'

export const lumaEnrichmentAdapter: EnrichmentAdapter = {
  source: 'luma',

  capabilities: {
    descriptions: true,
    venues: true,
  },

  config: {
    requiresClientSide: false,
    strategyReason: 'Luma JSON API; luma.com HTML is rate-limited for Cloudflare Workers',
    // Language is variable for Luma - needs detection
    knownLanguage: undefined,
    concurrency: 3,
    delayMs: 1000,
  },

  /**
   * SERVER-SIDE: Perform full enrichment for a single Luma event
   * One API read gives the description and the public venue
   */
  serverEnrich: async (
    link: string,
    options?: ServerEnrichmentOptions
  ): Promise<ServerEnrichmentResult | null> => {
    try {
      const sourceObservedAt = new Date().toISOString()
      const detail = await fetchLumaEventDetail(link)
      const description = detail?.description ?? null
      const venueName = options?.extractVenue ? detail?.venue?.name ?? null : null

      const location_hidden = detail?.location_hidden ?? undefined

      // No description: keep the privacy reading so it is still persisted.
      if (!description) {
        return location_hidden === undefined ? null : { sourceObservedAt, description_es: null, description_en: null, venue_name: null, location_hidden }
      }

      // For Luma, we don't know the language - let caller detect
      return {
        sourceObservedAt,
        description_es: null, // Language unknown, needs detection
        description_en: description, // Store in en temporarily, caller will detect and move if needed
        venue_name: venueName,
        ...(location_hidden === undefined ? {} : { location_hidden }),
      }
    } catch (error) {
      console.error('[Luma Enrichment] Error:', error)
      return null
    }
  },
}
