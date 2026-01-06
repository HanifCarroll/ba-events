/**
 * Luma Source Adapter
 */

import type { SourceAdapter } from './types'
import type { LumaPreviewEvent } from '../api/luma'

export const lumaAdapter: SourceAdapter<LumaPreviewEvent> = {
  source: 'luma',

  getEventId: (event) => event.luma.api_id,

  getEventName: (event) => event.luma.name,

  getVenueName: (event) => event.luma.venue?.name || null,

  updateVenueMatch: (event, venue, matchType) => ({
    ...event,
    venueMatch: {
      venue,
      matchType,
      confidence: matchType === 'exact' ? 1.0 : 0.8,
      searchName: event.luma.venue?.name || '',
    },
    transformed: {
      ...event.transformed,
      venue_id: venue.id,
    },
  }),

  getTransformed: (event) => event.transformed,

  isArrayTransform: () => false,
}

// Type assertion for type safety
export type LumaAdapter = typeof lumaAdapter
