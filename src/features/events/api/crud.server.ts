import {
  getHappeningSoonEvents,
  getEventWithVenue,
} from '#shared/lib/db/client.server.ts'
import type { ChatEventPayload } from '#shared/lib/types.ts'

/**
 * Next upcoming events for the chat home "Happening soon" grid.
 * Public — no auth, lightweight chat columns only.
 */
export async function getHappeningSoonEventsForGrid(): Promise<ChatEventPayload[]> {
  return getHappeningSoonEvents(8)
}

/**
 * Get a single event with its venue for the public event detail page.
 * Public — no auth.
 */
export async function getEventWithVenueById(id: string) {
  return getEventWithVenue(id)
}
