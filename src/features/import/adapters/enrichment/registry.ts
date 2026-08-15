/**
 * Enrichment Adapter Registry
 *
 * Central registry for all source-specific enrichment adapters.
 * Provides lookup and helper functions for adapter-based routing.
 *
 * NOTE: The legacy `adapters/enrichment/index.ts` was a mixed barrel (registry
 * logic + `export *` re-exports of the adapter types and individual adapters).
 * Per contract §1 (no barrel files) only the registry logic was ported here;
 * the re-exported type/adapter names now live in their named modules
 * (`../enrichment-types.ts` and the individual `*-enrichment.ts` files).
 */

import type { ImportSource } from '../types.ts'
import type { EnrichmentAdapter } from '../enrichment-types.ts'

import { passlineEnrichmentAdapter } from './passline-enrichment.ts'
import { meetupEnrichmentAdapter } from './meetup-enrichment.ts'
import { lumaEnrichmentAdapter } from './luma-enrichment.ts'
import { baTourismEnrichmentAdapter } from './ba-tourism-enrichment.ts'
import { eventbriteEnrichmentAdapter } from './eventbrite-enrichment.ts'

/**
 * Registry of all enrichment adapters by source
 * Note: CSV doesn't have enrichment (manual import)
 */
const enrichmentAdapters: Partial<Record<ImportSource, EnrichmentAdapter>> = {
  passline: passlineEnrichmentAdapter,
  meetup: meetupEnrichmentAdapter,
  luma: lumaEnrichmentAdapter,
  'ba-tourism': baTourismEnrichmentAdapter,
  eventbrite: eventbriteEnrichmentAdapter,
  // csv: no enrichment adapter (manual import)
}

/**
 * Get the enrichment adapter for a given source.
 * Returns undefined for sources without enrichment support (e.g., CSV).
 */
export function getEnrichmentAdapter(source: ImportSource): EnrichmentAdapter | undefined {
  return enrichmentAdapters[source]
}

/**
 * Check if a source requires client-side enrichment.
 * Returns false if source doesn't have an enrichment adapter.
 */
export function requiresClientSideEnrichment(source: ImportSource): boolean {
  const adapter = enrichmentAdapters[source]
  return adapter?.config.requiresClientSide ?? false
}

/**
 * Check if a source supports description enrichment.
 */
export function supportsDescriptionEnrichment(source: ImportSource): boolean {
  const adapter = enrichmentAdapters[source]
  return adapter?.capabilities.descriptions ?? false
}

/**
 * Check if a source supports venue enrichment.
 */
export function supportsVenueEnrichment(source: ImportSource): boolean {
  const adapter = enrichmentAdapters[source]
  return adapter?.capabilities.venues ?? false
}

/**
 * Get the known language for a source's enrichment.
 * Returns undefined if language needs to be detected.
 */
export function getKnownLanguage(source: ImportSource): 'es' | 'en' | undefined {
  const adapter = enrichmentAdapters[source]
  return adapter?.config.knownLanguage
}

/**
 * Get all sources that support enrichment.
 */
export function getEnrichableSources(): ImportSource[] {
  return Object.keys(enrichmentAdapters) as ImportSource[]
}

/**
 * Get all sources that require client-side enrichment.
 */
export function getClientSideEnrichmentSources(): ImportSource[] {
  return Object.entries(enrichmentAdapters)
    .filter(([_, adapter]) => adapter?.config.requiresClientSide)
    .map(([source]) => source as ImportSource)
}

/**
 * Get all sources that support server-side enrichment.
 */
export function getServerSideEnrichmentSources(): ImportSource[] {
  return Object.entries(enrichmentAdapters)
    .filter(([_, adapter]) => adapter && !adapter.config.requiresClientSide)
    .map(([source]) => source as ImportSource)
}
