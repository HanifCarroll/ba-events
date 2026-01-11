/**
 * Source Adapter Registry
 *
 * Central registry for all import source adapters.
 * Provides type-safe access to adapters by source name.
 */

import type { ImportSource, SourceAdapter, BasePreviewEvent } from './types'
import { passlineAdapter } from './passline-adapter'
import { eventbriteAdapter } from './eventbrite-adapter'
import { baTourismAdapter } from './ba-tourism-adapter'
import { meetupAdapter } from './meetup-adapter'
import { lumaAdapter } from './luma-adapter'

// Registry of all available adapters
// Note: CSV is handled separately and doesn't have an adapter
const adapters: Partial<Record<ImportSource, SourceAdapter<BasePreviewEvent>>> = {
  passline: passlineAdapter as SourceAdapter<BasePreviewEvent>,
  eventbrite: eventbriteAdapter as SourceAdapter<BasePreviewEvent>,
  'ba-tourism': baTourismAdapter as SourceAdapter<BasePreviewEvent>,
  meetup: meetupAdapter as SourceAdapter<BasePreviewEvent>,
  luma: lumaAdapter as SourceAdapter<BasePreviewEvent>,
}

/**
 * Get the adapter for a given import source
 * @throws Error if source doesn't have an adapter (e.g., csv)
 */
export function getAdapter(source: ImportSource): SourceAdapter<BasePreviewEvent> {
  const adapter = adapters[source]
  if (!adapter) {
    throw new Error(`No adapter available for source: ${source}`)
  }
  return adapter
}

/**
 * Check if a source has an adapter
 */
export function hasAdapter(source: ImportSource): boolean {
  return source in adapters
}

// Re-export types
export * from './types'
export * from './enrichment-types'

// Re-export individual adapters for direct use with proper typing
export { passlineAdapter } from './passline-adapter'
export { eventbriteAdapter } from './eventbrite-adapter'
export { baTourismAdapter } from './ba-tourism-adapter'
export { meetupAdapter } from './meetup-adapter'
export { lumaAdapter } from './luma-adapter'

// Re-export enrichment adapters and registry
export * from './enrichment'
