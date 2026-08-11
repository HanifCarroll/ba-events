/**
 * Import Adapter Registry
 *
 * Re-exports the shared import types and the enrichment adapter registry.
 *
 * Note: The manual import wizard (and its per-source SourceAdapters) was
 * removed — agents drive imports via the automated Trigger.dev pipeline. Only
 * the enrichment adapters remain, consumed by the daily enrichment job
 * (`event-enrichment.ts` via `getEnrichmentAdapter`).
 */

// Re-export types
export * from './types'
export * from './enrichment-types'

// Re-export enrichment adapters and registry
export * from './enrichment'
