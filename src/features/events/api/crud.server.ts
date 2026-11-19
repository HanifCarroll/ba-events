import { getEventWithVenue } from '#shared/lib/db/client.server.ts'
import { Data, Effect } from 'effect'

class EventReadError extends Data.TaggedError('EventReadError')<{
  readonly message: string
  readonly cause?: unknown
}> {}

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
