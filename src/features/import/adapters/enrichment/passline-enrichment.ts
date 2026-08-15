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
import { chromium } from 'playwright'
import { createBrowserbaseSession, isBrowserbaseAvailable } from '#shared/lib/browser/index.ts'
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

    const { sessionId, connectUrl } = await createBrowserbaseSession()
    console.log(`[passline] Browserbase session created for enrichment: ${sessionId}`)

    const browser = await chromium.connectOverCDP(connectUrl)

    try {
      const ctx = browser.contexts()[0]
      const page = ctx.pages()[0] || (await ctx.newPage())

      const result = await fetchPasslineDescriptionFromDetailPage(page, link, link)

      if (!result.description) {
        // A Cloudflare challenge (already bounded by the fetch helper) or a
        // clean page with no description are both terminal for the server job.
        if (!result.error || /cloudflare/i.test(result.error)) {
          throw new EnrichmentSkippedError(
            result.error ?? 'passline description not found on detail page'
          )
        }
        // Transient fetch failure — surface as a normal error so the row stays
        // `failed` and retryable on the next catch-up run.
        throw new Error(result.error)
      }

      let venueName: string | null = null
      if (options?.extractVenue) {
        const html = await page.content()
        venueName = extractVenueNameFromHtml(html)
      }

      return {
        description_es: result.description,
        description_en: null,
        venue_name: venueName,
      }
    } finally {
      await browser.close()
    }
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
