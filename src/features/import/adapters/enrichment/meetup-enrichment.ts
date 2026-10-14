import type {
  EnrichmentAdapter,
  ServerEnrichmentResult,
  ServerEnrichmentOptions,
} from '../enrichment-types.ts'
import { fetchMeetupEventDetail } from '../../scrapers/meetup/detail.ts'

export const meetupEnrichmentAdapter: EnrichmentAdapter = {
  source: 'meetup',
  capabilities: { descriptions: true, venues: true },
  config: {
    requiresClientSide: false,
    strategyReason: 'Jina returns HTTP 451; uses direct fetch with browser headers',
    knownLanguage: undefined,
    concurrency: 3,
    delayMs: 1000,
  },
  serverEnrich: async (
    link: string,
    options?: ServerEnrichmentOptions
  ): Promise<ServerEnrichmentResult | null> => {
    try {
      const detail = await fetchMeetupEventDetail(link)
      if (!detail?.description) return null
      return {
        sourceObservedAt: detail.sourceObservedAt ?? null,
        sourceValidatedAt: detail.sourceValidatedAt ?? null,
        description_es: null,
        description_en: detail.description,
        venue_name: options?.extractVenue ? detail.venue?.name ?? null : null,
      }
    } catch (error) {
      console.error('[Meetup Enrichment] Error:', error)
      return null
    }
  },
}
