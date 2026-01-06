/**
 * BA Tourism Source Adapter
 *
 * Note: BA Tourism events transform to an array of EventInserts (one per date).
 */

import type { SourceAdapter } from './types'
import type { BATourismPreviewEvent } from '../api/ba-tourism'

export const baTourismAdapter: SourceAdapter<BATourismPreviewEvent> = {
  source: 'ba-tourism',

  // Use a composite ID since BA Tourism doesn't have unique IDs
  getEventId: (event) => `${event.baTourism.name}-${event.baTourism.venueName}`,

  getEventName: (event) => event.baTourism.name,

  getVenueName: (event) => event.baTourism.venueName,

  updateVenueMatch: (event, venue, matchType) => ({
    ...event,
    venueMatch: {
      venue,
      matchType,
      confidence: matchType === 'exact' ? 1.0 : 0.8,
      searchName: event.baTourism.venueName || '',
    },
    // Update venue_id in all transformed events (array)
    transformed: event.transformed.map((t) => ({
      ...t,
      venue_id: venue.id,
    })),
  }),

  getTransformed: (event) => event.transformed,

  isArrayTransform: () => true,
}

// Type assertion for type safety
export type BATourismAdapter = typeof baTourismAdapter
