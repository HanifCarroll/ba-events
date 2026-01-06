/**
 * Passline Source Adapter
 */

import type { SourceAdapter } from './types'
import type { PasslinePreviewEvent } from '../api/passline'

export const passlineAdapter: SourceAdapter<PasslinePreviewEvent> = {
  source: 'passline',

  getEventId: (event) => event.passline.id,

  getEventName: (event) => event.passline.nombre,

  getVenueName: (event) => event.passline.lugar,

  updateVenueMatch: (event, venue, matchType) => ({
    ...event,
    venueMatch: {
      venue,
      matchType,
      confidence: matchType === 'exact' ? 1.0 : 0.8,
      searchName: event.passline.lugar || '',
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
export type PasslineAdapter = typeof passlineAdapter
