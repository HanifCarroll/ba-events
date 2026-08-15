/**
 * Passline Enrichment Adapter
 *
 * Cloudflare blocks server-side requests to Passline, so all enrichment
 * must happen client-side in the browser.
 *
 * Extraction methods:
 * - JSON-LD: `description` field and `location.name` for venue
 * - DOM patterns: Address and location from venue block HTML
 *
 * Language: Always Spanish (es)
 */

import type { EnrichmentAdapter, DescriptionExtractionResult, VenueExtractionResult } from '../enrichment-types.ts'
import {
  extractPasslineEventsBatchClient,
  type PasslineEnrichmentResult,
} from '../../scrapers/passline/client-enrichment.ts'

export const passlineEnrichmentAdapter: EnrichmentAdapter = {
  source: 'passline',

  capabilities: {
    descriptions: true,
    venues: true,
  },

  config: {
    requiresClientSide: true,
    strategyReason: 'Cloudflare blocks server-side requests',
    knownLanguage: 'es',
    concurrency: 1, // Sequential to avoid rate limiting
    delayMs: 300,
  },

  /**
   * Extract descriptions from Passline event pages (client-side)
   * Extracts from JSON-LD `description` field
   */
  extractDescriptions: async (events, onProgress): Promise<DescriptionExtractionResult[]> => {
    const results = await extractPasslineEventsBatchClient(
      events,
      onProgress,
      passlineEnrichmentAdapter.config.delayMs
    )

    return results.map((r: PasslineEnrichmentResult) => ({
      id: r.id,
      description: r.description,
      error: r.error,
    }))
  },

  /**
   * Extract venues from Passline event pages (client-side)
   * Extracts from JSON-LD `location.name` and DOM patterns for address
   */
  extractVenues: async (events, onProgress): Promise<VenueExtractionResult[]> => {
    const results = await extractPasslineEventsBatchClient(
      events,
      onProgress,
      passlineEnrichmentAdapter.config.delayMs
    )

    return results.map((r: PasslineEnrichmentResult) => ({
      id: r.id,
      venue: r.venue
        ? {
            name: r.venue.venueName,
            address: r.venue.address,
            location: r.venue.location,
          }
        : null,
      error: r.error,
    }))
  },
}
