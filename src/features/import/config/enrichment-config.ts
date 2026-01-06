/**
 * Enrichment Configuration
 *
 * Centralized configuration for enrichment operations.
 * Used by Luma description enrichment and Meetup venue enrichment.
 */

export const ENRICHMENT_CONFIG = {
  /** Number of concurrent requests during enrichment */
  concurrency: 3,

  /** Delay between batches in milliseconds */
  batchDelayMs: 1000,

  /** Request timeout in milliseconds */
  requestTimeoutMs: 30000,

  /** Maximum retry attempts for failed requests */
  maxRetries: 3,

  /** Delay between retries in milliseconds */
  retryDelayMs: 2000,
} as const

export type EnrichmentConfig = typeof ENRICHMENT_CONFIG
