/**
 * Eventbrite Source Adapter
 */

import type { SourceAdapter } from './types'
import type { EventbritePreviewEvent } from '../api/eventbrite'

export const eventbriteAdapter: SourceAdapter<EventbritePreviewEvent> = {
  source: 'eventbrite',

  getEventId: (event) => event.eventbrite.url,

  getEventName: (event) => event.eventbrite.name,

  getVenueName: (event) => event.eventbrite.location?.name || null,

  updateVenueMatch: (event, venue, matchType) => ({
    ...event,
    venueMatch: {
      venue,
      matchType,
      confidence: matchType === 'exact' ? 1.0 : 0.8,
      searchName: event.eventbrite.location?.name || '',
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
export type EventbriteAdapter = typeof eventbriteAdapter
