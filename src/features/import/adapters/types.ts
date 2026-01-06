/**
 * Source Adapter Types
 *
 * Defines the common interface for all import source adapters,
 * enabling unified handling of venue matching and event selection.
 */

import type { Venue, EventInsert, Neighborhood } from '@/shared/lib/types'
import type { VenueMatchResult } from '../scrapers/venue-matcher'

// All supported import sources
export type ImportSource = 'passline' | 'eventbrite' | 'ba-tourism' | 'meetup' | 'luma' | 'csv'

// Base preview event shape that all sources share
export interface BasePreviewEvent {
  venueMatch: VenueMatchResult
}

// Adapter interface - each source implements this
export interface SourceAdapter<TPreview extends BasePreviewEvent = BasePreviewEvent> {
  source: ImportSource

  // Event identification
  getEventId(event: TPreview): string
  getEventName(event: TPreview): string

  // Venue accessors
  getVenueName(event: TPreview): string | null

  // Venue matching - creates updated event with new venue match
  updateVenueMatch(event: TPreview, venue: Venue, matchType: 'exact' | 'fuzzy'): TPreview

  // Transform helpers
  getTransformed(event: TPreview): EventInsert | EventInsert[]
  isArrayTransform(): boolean
}

// Unmatched venue aggregation result
export interface UnmatchedVenueGroup {
  name: string
  eventIds: string[]
  count: number
}

// Venue edit state (used in venue mapping step)
export interface VenueEdit {
  name: string
  neighborhood: Neighborhood | null
  skip: boolean
  mergeInto?: string
}
