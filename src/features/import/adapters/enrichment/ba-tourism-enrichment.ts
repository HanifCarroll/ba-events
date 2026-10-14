/**
 * BA Tourism Enrichment Adapter
 *
 * BA Tourism enrichment uses server-side Jina + AI:
 * - Jina Reader fetches and converts page to markdown
 * - Claude Haiku extracts semantic description
 * - Known Spanish language (skips detection)
 *
 * Extraction methods:
 * - Description: Jina markdown → Haiku extraction
 * - Venue: Simple regex after "¿Dónde?" heading (no AI needed)
 *
 * Language: Always Spanish (es)
 */

import type {
  EnrichmentAdapter,
  ServerEnrichmentResult,
  ServerEnrichmentOptions,
} from '../enrichment-types.ts'
import { enrichEventFull } from '#shared/lib/ai/enrichment.ts'

export const baTourismEnrichmentAdapter: EnrichmentAdapter = {
  source: 'ba-tourism',

  capabilities: {
    descriptions: true,
    venues: true,
  },

  config: {
    requiresClientSide: false,
    strategyReason: 'Server-side Jina + Haiku; known Spanish language',
    knownLanguage: 'es',
    concurrency: 2,
    delayMs: 1500, // Higher delay for rate limiting
  },

  /**
   * SERVER-SIDE: Perform full enrichment for a single BA Tourism event
   * Uses Jina Reader + Claude Haiku with known Spanish language
   */
  serverEnrich: async (
    link: string,
    options?: ServerEnrichmentOptions
  ): Promise<ServerEnrichmentResult | null> => {
    try {
      // Use the shared enrichment pipeline with known Spanish language
      const result = await enrichEventFull(link, {
        knownLanguage: 'spanish',
        extractVenue: options?.extractVenue ?? true,
      })

      if (!result) {
        return null
      }

      return {
        description_es: result.description_es,
        sourceObservedAt: result.sourceObservedAt ?? null,
        description_en: result.description_en,
        venue_name: result.venue_name,
      }
    } catch (error) {
      console.error('[BA Tourism Enrichment] Error:', error)
      return null
    }
  },
}
