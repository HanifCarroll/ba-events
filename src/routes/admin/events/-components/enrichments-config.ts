/**
 * Enrichments Configuration
 *
 * Centralized configuration for all enrichment buttons in BulkActionBar.
 * Adding a new enrichment type requires adding a single config object here.
 */

import { Sparkles, DollarSign, MapPin, FileText } from 'lucide-react'
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
 */
export interface EnrichmentsConfigParams {
  // Generic description enrichment
  descriptionCount: number
  onDescriptionEnrich: () => void
  backgroundEnrichment: {
    isEnriching: boolean
    stopEnrichment: () => void
  }

  // Venue enrichment
  venueCount: number
  onVenueEnrich: () => void
  venueEnrichment: {
    isVenueEnriching: boolean
  }

  // Luma description enrichment
  lumaCount: number
  onLumaEnrich: () => void
  lumaEnrichment: {
    isLumaEnriching: boolean
  }

  // Passline description enrichment
  passlineCount: number
  onPasslineEnrich: () => void
  passlineEnrichment: {
    isPasslineEnriching: boolean
    stopPasslineEnrichment: () => void
  }
}

/**
 * Build the enrichments config array from hook results and counts.
 * This is the main entry point - call this in useMemo to get the config.
 */
export function buildEnrichmentsConfig(params: EnrichmentsConfigParams): EnrichmentConfig[] {
  return [
    buildEnrichmentConfig({
      key: 'descriptions',
      label: 'Add Descriptions',
      progressLabel: 'Adding Descriptions',
      color: 'primary',
      icon: Sparkles,
      count: params.descriptionCount,
      onClick: params.onDescriptionEnrich,
      hook: {
        isEnriching: params.backgroundEnrichment.isEnriching,
        stopEnrichment: params.backgroundEnrichment.stopEnrichment,
      },
    }),
    // Eventbrite enrichment (not currently wired up)
    buildEnrichmentConfig({
      key: 'eventbrite',
      label: 'Add Prices',
      progressLabel: 'Adding Prices',
      color: 'orange',
      icon: DollarSign,
      count: 0,
      onClick: () => {},
      hook: { isEnriching: false },
    }),
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
    buildEnrichmentConfig({
      key: 'luma',
      label: 'Luma Descriptions',
      progressLabel: 'Adding Luma Descriptions',
      color: 'violet',
      icon: FileText,
      count: params.lumaCount,
      onClick: params.onLumaEnrich,
      hook: {
        isEnriching: params.lumaEnrichment.isLumaEnriching,
      },
    }),
    buildEnrichmentConfig({
      key: 'passline',
      label: 'Passline Descriptions',
      progressLabel: 'Adding Passline Descriptions',
      color: 'indigo',
      icon: FileText,
      count: params.passlineCount,
      onClick: params.onPasslineEnrich,
      hook: {
        isEnriching: params.passlineEnrichment.isPasslineEnriching,
        stopEnrichment: params.passlineEnrichment.stopPasslineEnrichment,
      },
    }),
  ]
}
