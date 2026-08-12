import { createServerFn } from '@tanstack/react-start'
import {
  getTrendingEvents,
  getEventWithVenue,
} from '@/shared/lib/db/client'
import type { ChatEventPayload } from '@/shared/lib/types'

/**
 * Next upcoming events for the chat home "Happening soon" grid.
 * Public — no auth, lightweight chat columns only.
 */
export const getTrendingEventsAction = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ChatEventPayload[]> => {
    return getTrendingEvents(8)
  }
)

/**
 * Get a single event with its venue for the public event detail page.
 * Public — no auth.
 */
export const getEventWithVenueAction = createServerFn({ method: 'GET' }).validator((id: string) => id)
  .handler(async ({ data: id }) => {
    return getEventWithVenue(id)
  })
