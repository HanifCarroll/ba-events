/**
 * Meetup Source Adapter
 *
 * Note: Meetup events transform to an array of EventInserts (recurring events expand to multiple dates).
 */

import type { SourceAdapter } from './types'
import type { MeetupPreviewEvent } from '../api/meetup'

export const meetupAdapter: SourceAdapter<MeetupPreviewEvent> = {
  source: 'meetup',

  getEventId: (event) => event.meetup.id,

  getEventName: (event) => event.meetup.name,

  getVenueName: (event) => event.meetup.venue?.name || null,

  updateVenueMatch: (event, venue, matchType) => ({
    ...event,
    venueMatch: {
      venue,
      matchType,
      confidence: matchType === 'exact' ? 1.0 : 0.8,
      searchName: event.meetup.venue?.name || '',
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
export type MeetupAdapter = typeof meetupAdapter
