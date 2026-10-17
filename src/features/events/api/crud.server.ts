import {
  getHappeningSoonEvents,
  getEventWithVenue,
} from '#shared/lib/db/client.server.ts'
import { Data, Effect } from 'effect'
import type { HomeEventCard } from '../lib/home-feed.ts'

class EventReadError extends Data.TaggedError('EventReadError')<{
  readonly message: string
  readonly cause?: unknown
}> {}

/**
 * Next upcoming events for the chat home "Happening soon" grid.
 * Public — no auth, lightweight chat columns only.
 */
export function getHappeningSoonEventsForGridEffect(): Effect.Effect<HomeEventCard[], EventReadError> {
  return Effect.tryPromise({
    try: () => getHappeningSoonEvents(4),
    catch: (cause) => new EventReadError({ message: 'Failed to load happening soon events', cause }),
  })
}

export function getHappeningSoonEventsForGrid() {
  return Effect.runPromise(getHappeningSoonEventsForGridEffect())
}

/**
 * Get a single event with its venue for the public event detail page.
 * Public — no auth.
 */
export function getEventWithVenueByIdEffect(id: string): Effect.Effect<Awaited<ReturnType<typeof getEventWithVenue>>, EventReadError> {
  return Effect.tryPromise({
    try: () => getEventWithVenue(id),
    catch: (cause) => new EventReadError({ message: 'Failed to load event', cause }),
  })
}

export function getEventWithVenueById(id: string) {
  return Effect.runPromise(getEventWithVenueByIdEffect(id))
}
