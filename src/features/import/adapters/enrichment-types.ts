/**
 * Enrichment Adapter Types
 *
 * Defines the interface for source-specific enrichment adapters,
 * enabling unified handling of description and venue extraction
 * across different event sources with varying requirements.
 *
 * Key design decisions:
 * - Separate from SourceAdapter (import concerns vs enrichment concerns)
 * - Supports both client-side and server-side enrichment strategies
 * - Declarative config for routing decisions
 */

import type { ImportSource } from './types.ts'

/**
 * Typed error for enrichment attempts that are permanently ineligible for the
 * server batch job (client-side-only source, Browserbase unavailable, or a
 * Cloudflare challenge). Callers should mark the row `skipped` — NOT `failed` —
 * so catch-up does not reselect it on the next run.
 */
export class EnrichmentSkippedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EnrichmentSkippedError'
  }
}

/**
 * Venue information extracted from event pages
 */
export interface EnrichedVenueInfo {
  name: string
  address?: string | null
  location?: string | null // e.g., "Buenos Aires, PALERMO"
  latitude?: number | null
  longitude?: number | null
}

/**
 * Description extraction result
 */
export interface DescriptionExtractionResult {
  id: string
  description: string | null
  error?: string
}

/**
 * Venue extraction result
 */
export interface VenueExtractionResult {
  id: string
  venue: EnrichedVenueInfo | null
  error?: string
}

/**
 * What types of enrichment this source supports
 */
export interface EnrichmentCapabilities {
  /** Can extract/enrich event descriptions */
  descriptions: boolean
  /** Can extract/enrich venue information */
  venues: boolean
}

/**
 * Configuration for how enrichment should be executed
 */
export interface EnrichmentConfig {
  /**
   * Whether enrichment MUST run client-side (in browser).
   * True when server-side requests are blocked (e.g., Cloudflare).
   */
  requiresClientSide: boolean

  /**
   * Human-readable reason for client/server decision.
   * Documents why this source uses this strategy.
   */
  strategyReason: string

  /**
   * Known language for this source (skips language detection).
   * - 'es': Always Spanish (Passline, BA Tourism)
   * - 'en': Always English
   * - undefined: Detect language (Meetup, Luma, Eventbrite)
   */
  knownLanguage?: 'es' | 'en'

  /**
   * Max concurrent requests during batch enrichment.
   * Lower for client-side (browser) to avoid rate limiting.
   */
  concurrency: number

  /**
   * Delay between requests in milliseconds.
   * Higher for aggressive rate limiting (Cloudflare).
   */
  delayMs: number
}

/**
 * Options for server-side enrichment
 */
export interface ServerEnrichmentOptions {
  /** Whether to also extract venue information */
  extractVenue?: boolean
}

/**
 * Result from server-side enrichment
 */
export interface ServerEnrichmentResult {
  sourceObservedAt?: string | null
  sourceValidatedAt?: string | null
  description_es: string | null
  description_en: string | null
  venue_name: string | null
}

/**
 * Progress callback type for batch operations
 */
export type EnrichmentProgressCallback = (current: number, total: number) => void

/**
 * Enrichment Adapter Interface
 *
 * Each source implements this interface with source-specific extraction logic.
 * The adapter pattern enables:
 * 1. Unified routing in useImportWizard and event-enrichment.ts
 * 2. Self-documenting enrichment strategies per source
 * 3. Easy addition of new sources
 */
export interface EnrichmentAdapter<TPreviewEvent = unknown> {
  /** Source identifier (must match ImportSource) */
  source: ImportSource

  /** What this source can enrich */
  capabilities: EnrichmentCapabilities

  /** How enrichment should be executed */
  config: EnrichmentConfig

  /**
   * CLIENT-SIDE: Extract descriptions from events.
   * Only implemented for sources requiring client-side extraction.
   * Called from browser context (useImportWizard).
   */
  extractDescriptions?(
    events: Array<{ id: string; url: string }>,
    onProgress?: EnrichmentProgressCallback
  ): Promise<DescriptionExtractionResult[]>

  /**
   * CLIENT-SIDE: Extract venues from events.
   * Only implemented for sources requiring client-side extraction.
   * Called from browser context (useImportWizard).
   */
  extractVenues?(
    events: Array<{ id: string; url: string }>,
    onProgress?: EnrichmentProgressCallback
  ): Promise<VenueExtractionResult[]>

  /**
   * SERVER-SIDE: Perform full enrichment.
   * Only implemented for sources that can be enriched server-side.
   * Used by event-enrichment.ts batch job.
   *
   * @param link - URL to fetch and extract from
   * @param options - Extraction options
   * @returns Enrichment result or null if extraction failed
   */
  serverEnrich?(
    link: string,
    options?: ServerEnrichmentOptions
  ): Promise<ServerEnrichmentResult | null>

  /**
   * Get the URL to use for enrichment from a preview event.
   * Used to extract the link from source-specific event structures.
   */
  getEnrichmentUrl?(event: TPreviewEvent): string | null
}

/**
 * Type guard to check if adapter supports client-side description extraction
 */
export function hasClientDescriptionExtraction(
  adapter: EnrichmentAdapter
): adapter is EnrichmentAdapter & {
  extractDescriptions: NonNullable<EnrichmentAdapter['extractDescriptions']>
} {
  return adapter.config.requiresClientSide && !!adapter.extractDescriptions
}

/**
 * Type guard to check if adapter supports client-side venue extraction
 */
export function hasClientVenueExtraction(
  adapter: EnrichmentAdapter
): adapter is EnrichmentAdapter & {
  extractVenues: NonNullable<EnrichmentAdapter['extractVenues']>
} {
  return adapter.config.requiresClientSide && !!adapter.extractVenues
}

/**
 * Type guard to check if adapter supports server-side enrichment
 */
export function hasServerEnrichment(
  adapter: EnrichmentAdapter
): adapter is EnrichmentAdapter & {
  serverEnrich: NonNullable<EnrichmentAdapter['serverEnrich']>
} {
  return !adapter.config.requiresClientSide && !!adapter.serverEnrich
}
