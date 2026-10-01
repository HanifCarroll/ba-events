/**
 * Passline Enrichment Adapter
 *
 * Cloudflare blocks plain datacenter-IP server requests to Passline, so the
 * server batch job enriches detail pages through a Browserbase cloud browser
 * (`serverEnrich`). The client extractors are retained for the admin manual
 * import path.
 *
 * Extraction methods:
 * - JSON-LD: `description` field and `location.name` for venue
 * - DOM patterns: Address and location from venue block HTML
 *
 * Language: Always Spanish (es)
 */

import type { EnrichmentAdapter, DescriptionExtractionResult, VenueExtractionResult, ServerEnrichmentResult } from '../enrichment-types.ts'
import { EnrichmentSkippedError } from '../enrichment-types.ts'
import { isBrowserbaseAvailable } from '#shared/lib/browser/index.ts'
import { openPasslineBrowser, configurePasslineResources } from '#shared/lib/browser/managed.ts'
import { reuseDailyAcquisition, serializeAcquisition, withOwnedBrowser } from '../../acquisition/run.ts'
import { fetchPasslineDescriptionFromDetailPage } from '../../scrapers/passline/description-enrichment.ts'
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
    requiresClientSide: false,
    strategyReason: 'Browserbase cloud browser bypasses Cloudflare for server-side enrichment',
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

  /**
   * SERVER-SIDE: enrich a Passline detail page inside a Browserbase cloud
   * browser (datacenter IPs are blocked by Cloudflare; Browserbase egresses
   * through its managed proxy network). Only the description is extracted
   * here (venue is settled at import for Passline).
   */
  serverEnrich: async (link, options): Promise<ServerEnrichmentResult | null> => {
    if (!isBrowserbaseAvailable()) {
      // Terminal for the server job: mark `skipped`, never `failed`, so the
      // daily catch-up does not reselect Passline rows forever.
      throw new EnrichmentSkippedError(
        'passline requires client-side extraction (BROWSERBASE_API_KEY not set)'
      )
    }

    return reuseDailyAcquisition(`passline:detail:v1:${link}:venue=${Boolean(options?.extractVenue)}`, () =>
      serializeAcquisition('passline:detail', () =>
        withOwnedBrowser('passline:detail', () => openPasslineBrowser(true), async browser => {
          const context = browser.contexts()[0]
          if (!context) throw new Error('Browserbase session has no browser context')
          for (let attempt = 0; attempt < 2; attempt++) {
            const page = await context.newPage()
            try {
              const result = await fetchPasslineDescriptionFromDetailPage(page, link, link)
              if (!result.description) {
                if (!result.error) throw new EnrichmentSkippedError('passline description not found on detail page')
                throw new Error(result.error)
              }
              const venueName = options?.extractVenue ? extractVenueNameFromHtml(await page.content()) : null
              console.info('[passline] Detail acquisition completed', { profile: attempt ? 'standard' : 'thin' })
              return { description_es: result.description, description_en: null, venue_name: venueName }
            } catch (error) {
              if (error instanceof EnrichmentSkippedError || attempt === 1) throw error
              console.warn('[passline] Thin detail acquisition failed; one bounded standard-profile retry')
              await context.unrouteAll({ behavior: 'wait' })
              await configurePasslineResources(context, false)
            } finally {
              await page.close().catch(() => {})
              if (attempt === 1) {
                await context.unrouteAll({ behavior: 'wait' })
                await configurePasslineResources(context, true)
              }
            }
          }
          throw new Error('Passline detail retry exhausted')
        })
      )
    )
  },
}

/**
 * Extract the venue name from a Passline detail page's JSON-LD (`location.name`).
 * Returns null when the page has no structured venue (venue was already settled
 * at import for most Passline rows).
 */
function extractVenueNameFromHtml(html: string): string | null {
  const jsonLdMatch = html.match(
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i
  )

  if (!jsonLdMatch) return null

  try {
    const jsonLd = JSON.parse(jsonLdMatch[1]) as { location?: { name?: unknown } }
    const name = jsonLd.location?.name
    return typeof name === 'string' && name.length > 0 ? name : null
  } catch {
    return null
  }
}
