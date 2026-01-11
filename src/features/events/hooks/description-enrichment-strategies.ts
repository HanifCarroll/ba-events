/**
 * Description Enrichment Strategy Mapping
 *
 * Maps event sources to their optimal description enrichment method.
 * This enables the unified enrichment button to automatically route
 * events to the correct enrichment strategy.
 */

import type { ImportSource } from '@/features/import/adapters/types'
import type { EventWithVenue } from '@/shared/lib/types'

/**
 * The enrichment method to use for description extraction.
 *
 * - 'background': Generic Jina Reader + Claude AI extraction
 * - 'passline': Client-side JSON-LD extraction + server translation
 * - 'luma': Server-side Playwright scraping
 * - 'none': No enrichment available (e.g., CSV manual imports)
 */
export type DescriptionEnrichmentMethod = 'background' | 'passline' | 'luma' | 'none'

interface StrategyConfig {
  method: DescriptionEnrichmentMethod
  reason: string
  isStoppable: boolean
}

/**
 * Source-to-strategy mapping.
 *
 * Each source has a specific enrichment strategy based on:
 * - Technical constraints (e.g., Cloudflare blocking)
 * - Content format (e.g., JSON-LD, JavaScript rendering)
 * - Data availability (e.g., descriptions included vs need fetching)
 */
const STRATEGY_MAP: Record<ImportSource, StrategyConfig> = {
  passline: {
    method: 'passline',
    reason: 'Cloudflare blocks server-side requests; uses client-side JSON-LD extraction',
    isStoppable: true,
  },
  luma: {
    method: 'luma',
    reason: 'Requires Playwright to render JavaScript content',
    isStoppable: true,
  },
  meetup: {
    method: 'background',
    reason: 'Works with Jina Reader for description extraction',
    isStoppable: true,
  },
  eventbrite: {
    method: 'background',
    reason: 'Works with Jina Reader for description extraction',
    isStoppable: true,
  },
  'ba-tourism': {
    method: 'background',
    reason: 'Works with Jina Reader for description extraction',
    isStoppable: true,
  },
  csv: {
    method: 'none',
    reason: 'Manual import; no source URL to fetch descriptions from',
    isStoppable: false,
  },
}

/**
 * Get the enrichment strategy for a given source.
 */
export function getEnrichmentStrategy(source: ImportSource | string): StrategyConfig {
  return STRATEGY_MAP[source as ImportSource] ?? {
    method: 'background',
    reason: 'Unknown source, falling back to generic enrichment',
    isStoppable: true,
  }
}

/**
 * Get the enrichment method for a given source.
 */
export function getEnrichmentMethod(source: ImportSource | string): DescriptionEnrichmentMethod {
  return getEnrichmentStrategy(source).method
}

/**
 * Check if an enrichment method is stoppable.
 */
export function isMethodStoppable(source: ImportSource | string): boolean {
  return getEnrichmentStrategy(source).isStoppable
}

/**
 * Group events by their enrichment method.
 *
 * Returns a map where keys are enrichment methods and values are arrays
 * of events that should use that method.
 */
export function groupEventsByEnrichmentMethod(
  events: EventWithVenue[],
  selectedIds: Set<string>
): Map<DescriptionEnrichmentMethod, EventWithVenue[]> {
  const groups = new Map<DescriptionEnrichmentMethod, EventWithVenue[]>()

  // Initialize all groups
  groups.set('passline', [])
  groups.set('luma', [])
  groups.set('background', [])
  // Note: 'none' group is not needed since those events can't be enriched

  for (const event of events) {
    if (!selectedIds.has(event.id)) continue

    const method = getEnrichmentMethod(event.source)

    // Skip events with no enrichment method
    if (method === 'none') continue

    const group = groups.get(method) ?? []
    group.push(event)
    groups.set(method, group)
  }

  return groups
}

/**
 * Get all enrichable sources (sources that have an enrichment method).
 */
export function getEnrichableSources(): ImportSource[] {
  return Object.entries(STRATEGY_MAP)
    .filter(([, config]) => config.method !== 'none')
    .map(([source]) => source as ImportSource)
}
