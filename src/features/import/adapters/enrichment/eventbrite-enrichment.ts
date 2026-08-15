/**
 * Eventbrite Enrichment Adapter
 *
 * Eventbrite enrichment uses server-side Jina + AI:
 * - Descriptions available in initial JSON-LD (no separate enrichment needed typically)
 * - When enrichment is needed, uses Jina + Haiku pipeline
 * - Venue extraction from JSON-LD structured data
 *
 * Extraction methods:
 * - Description: Jina markdown → Haiku extraction (when needed)
 * - Venue: JSON-LD Event.location from direct fetch
 *
 * Language: Variable (needs detection - Spanish or English)
 *
 * Note: Eventbrite also has specific price/category enrichment but that's
 * handled separately during import, not via this adapter.
 */

import type {
  EnrichmentAdapter,
  ServerEnrichmentResult,
  ServerEnrichmentOptions,
} from '../enrichment-types.ts'
import { enrichEventFull } from '#shared/lib/ai/enrichment.ts'
import { extractEventbriteVenueInfo } from '../../scrapers/eventbrite/enrichment.ts'

export const eventbriteEnrichmentAdapter: EnrichmentAdapter = {
  source: 'eventbrite',

  capabilities: {
    descriptions: true,
    venues: true,
  },

  config: {
    requiresClientSide: false,
    strategyReason: 'Server-side Jina + Haiku; JSON-LD for venues',
    // Language is variable for Eventbrite - needs detection
    knownLanguage: undefined,
    concurrency: 3,
    delayMs: 1000,
  },

  /**
   * SERVER-SIDE: Perform full enrichment for a single Eventbrite event
   * Uses Jina Reader + Claude Haiku for descriptions, JSON-LD for venues
   */
  serverEnrich: async (
    link: string,
    options?: ServerEnrichmentOptions
  ): Promise<ServerEnrichmentResult | null> => {
    try {
      // Use the shared enrichment pipeline - language will be auto-detected
      const result = await enrichEventFull(link, {
        knownLanguage: undefined, // Auto-detect for Eventbrite
        extractVenue: options?.extractVenue ?? true,
      })

      if (!result) {
        // If Jina pipeline fails, try direct JSON-LD venue extraction as fallback
        if (options?.extractVenue) {
          const venueInfo = await extractEventbriteVenueInfo(link)
          if (venueInfo?.name) {
            return {
              description_es: null,
              description_en: null,
              venue_name: venueInfo.name,
            }
          }
        }
        return null
      }

      return {
        description_es: result.description_es,
        description_en: result.description_en,
        venue_name: result.venue_name,
      }
    } catch (error) {
      console.error('[Eventbrite Enrichment] Error:', error)
      return null
    }
  },
}
