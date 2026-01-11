/**
 * Enrichments Configuration
 *
 * Centralized configuration for all enrichment buttons in BulkActionBar.
 * Adding a new enrichment type requires adding a single config object here.
 */

import { Sparkles, MapPin } from 'lucide-react'
import type { EnrichmentConfig, EnrichmentColor } from './EnrichmentButton'
import type { LucideIcon } from 'lucide-react'

/**
 * Hook interface that all enrichment hooks should implement.
 * This enables type-safe config building.
 */
interface EnrichmentHookResult {
  isEnriching: boolean
  stopEnrichment?: () => void
}

interface EnrichmentConfigInput {
  key: string
  label: string
  progressLabel: string
  color: EnrichmentColor
  icon: LucideIcon
  count: number
  onClick: () => void
  hook: EnrichmentHookResult
}

/**
 * Build an EnrichmentConfig from input parameters.
 * Extracts isEnriching and onStop from the hook result.
 */
function buildEnrichmentConfig(input: EnrichmentConfigInput): EnrichmentConfig {
  return {
    key: input.key,
    label: input.label,
    progressLabel: input.progressLabel,
    color: input.color,
    icon: input.icon,
    count: input.count,
    onClick: input.onClick,
    isEnriching: input.hook.isEnriching,
    onStop: input.hook.stopEnrichment,
  }
}

/**
 * Parameters needed to build the full enrichments config array.
 *
 * Note: Description enrichment is now unified - it automatically routes events
 * to the correct enrichment method (Passline, Luma, or generic) based on source.
 */
export interface EnrichmentsConfigParams {
  // Unified description enrichment (handles Passline, Luma, and generic sources)
  descriptionCount: number
  onDescriptionEnrich: () => void
  descriptionEnrichment: {
    isEnriching: boolean
    stopEnrichment: () => void
  }

  // Venue enrichment
  venueCount: number
  onVenueEnrich: () => void
  venueEnrichment: {
    isVenueEnriching: boolean
  }
}

/**
 * Build the enrichments config array from hook results and counts.
 * This is the main entry point - call this in useMemo to get the config.
 */
export function buildEnrichmentsConfig(params: EnrichmentsConfigParams): EnrichmentConfig[] {
  return [
    // Unified description enrichment - automatically routes to Passline, Luma, or generic
    buildEnrichmentConfig({
      key: 'descriptions',
      label: 'Add Descriptions',
      progressLabel: 'Adding Descriptions',
      color: 'primary',
      icon: Sparkles,
      count: params.descriptionCount,
      onClick: params.onDescriptionEnrich,
      hook: {
        isEnriching: params.descriptionEnrichment.isEnriching,
        stopEnrichment: params.descriptionEnrichment.stopEnrichment,
      },
    }),
    // Venue enrichment
    buildEnrichmentConfig({
      key: 'venues',
      label: 'Add Venues',
      progressLabel: 'Adding Venues',
      color: 'blue',
      icon: MapPin,
      count: params.venueCount,
      onClick: params.onVenueEnrich,
      hook: {
        isEnriching: params.venueEnrichment.isVenueEnriching,
      },
    }),
  ]
}
