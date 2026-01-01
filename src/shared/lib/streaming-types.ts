/**
 * Shared streaming progress types for admin operations
 * These types are used across multiple source files for consistent streaming updates
 */

// ============================================================================
// IMPORT STREAMING TYPES (used by all 4 source importers)
// ============================================================================

export interface ImportProgress {
  type: 'progress'
  current: number
  total: number
  eventName: string
  phase: 'categorizing' | 'embedding' | 'importing'
}

export interface ImportComplete {
  type: 'complete'
  inserted: number
  updated: number
  venuesCreated: number
}

export type ImportUpdate = ImportProgress | ImportComplete

// ============================================================================
// VENUE ENRICHMENT STREAMING TYPES (used by source-specific venue enrichment)
// ============================================================================

export interface VenueEnrichProgress {
  type: 'progress'
  current: number
  total: number
  eventName: string
  action: 'matched' | 'created' | 'error'
  venueName?: string
}

export interface VenueEnrichComplete {
  type: 'complete'
  enriched: number
  venuesCreated: number
  total: number
  errors: Array<{ id: string; error: string }>
}

export type VenueEnrichUpdate = VenueEnrichProgress | VenueEnrichComplete

// ============================================================================
// NOMINATIM VENUE ENRICHMENT STREAMING TYPES
// ============================================================================

export interface NominatimEnrichProgress {
  type: 'progress'
  current: number
  total: number
  venueName: string
  success: boolean
  error?: string
}

export interface NominatimEnrichComplete {
  type: 'complete'
  enriched: number
  total: number
  errors: Array<{ venueId: string; venueName: string; error: string }>
}

export type NominatimEnrichUpdate = NominatimEnrichProgress | NominatimEnrichComplete

// ============================================================================
// ADDRESS DETECTION STREAMING TYPES (venue review)
// ============================================================================

export interface AddressNameResult {
  venue_id: string
  is_address_like: boolean
  confidence: number
  suggested_name?: string
}

export interface AddressDetectionProgress {
  type: 'progress'
  current: number
  total: number
  batchNumber: number
  totalBatches: number
  batchResults: AddressNameResult[]
}

export interface AddressDetectionComplete {
  type: 'complete'
  results: AddressNameResult[]
  total: number
}

export type AddressDetectionUpdate = AddressDetectionProgress | AddressDetectionComplete

// ============================================================================
// EMBEDDING REGENERATION STREAMING TYPES
// ============================================================================

export interface EmbeddingProgress {
  type: 'progress'
  current: number
  total: number
  eventName: string
  success: boolean
  error?: string
}

export interface EmbeddingComplete {
  type: 'complete'
  regenerated: number
  total: number
  errors?: Array<{ id: string; error: string }>
}

export type EmbeddingUpdate = EmbeddingProgress | EmbeddingComplete

// ============================================================================
// DESCRIPTION UPDATE STREAMING TYPES
// ============================================================================

export interface DescriptionUpdateProgress {
  type: 'progress'
  current: number
  total: number
  eventName: string
  success: boolean
}

export interface DescriptionUpdateComplete {
  type: 'complete'
  updated: number
  total: number
}

export type DescriptionUpdateUpdate = DescriptionUpdateProgress | DescriptionUpdateComplete

// ============================================================================
// DESCRIPTION ENRICHMENT STREAMING TYPES
// ============================================================================

export interface DescriptionEnrichProgress {
  type: 'progress'
  current: number
  total: number
  eventName: string
  success: boolean
  error?: string
}

export interface DescriptionEnrichComplete {
  type: 'complete'
  enriched: number
  total: number
  errors?: Array<{ id: string; error: string }>
}

export type DescriptionEnrichUpdate = DescriptionEnrichProgress | DescriptionEnrichComplete
