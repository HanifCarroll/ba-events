/**
 * Server functions for agent user tools.
 *
 * These functions allow the AI agent to perform actions on behalf of authenticated users.
 * User identity is derived from server-side session cookies - never from client input or the LLM.
 *
 * Security model:
 * - User identity comes from `getSessionUser()` (reads HTTP cookies)
 * - The LLM never sees user IDs or tokens
 * - Supabase RLS provides additional database-level protection
 * - Graceful degradation for anonymous users (return error, don't crash)
 */

import type { RequestEvent } from '@sveltejs/kit'
import { getSessionUser } from '#features/auth/api/session.server.ts'
import { getEventWithVenue } from '#shared/lib/db/client.server.ts'
import { createSupabaseServerClient } from '#shared/lib/db/server-client.server.ts'
import type { ChatEventPayload, EventWithVenue } from '#shared/lib/types.ts'

// ============================================================================
// TYPES
// ============================================================================

export interface UserToolContext {
  userId: string | null
  isAuthenticated: boolean
  /** The request event, so user-scoped DB operations can build the cookie-bound client. */
  event?: RequestEvent
}

export interface SaveEventResult {
  success: boolean
  error?: 'not_authenticated' | 'already_saved' | 'event_not_found' | 'unknown_error'
  message?: string
}

export interface UnsaveEventResult {
  success: boolean
  error?: 'not_authenticated' | 'not_saved' | 'unknown_error'
  message?: string
}

export interface ListSavedEventsResult {
  success: boolean
  error?: 'not_authenticated' | 'unknown_error'
  events?: EventWithVenue[]
  count?: number
  upcomingCount?: number
  pastCount?: number
}

export interface GetEventDetailsResult {
  success: boolean
  error?: 'not_found' | 'unknown_error'
  event?: ChatEventPayload
}

export interface CheckEventSavedResult {
  success: boolean
  isSaved: boolean
  error?: 'not_authenticated' | 'unknown_error'
}

// ============================================================================
// HELPER: Get User Tool Context
// ============================================================================

/**
 * Bounded authoritative saved-membership query for a set of prior event ids.
 * Returns a map event_id -> true for events the user currently has saved.
 * Used by authenticated prior-context rehydration; never trusts client input.
 */
export async function getSavedMembershipForIds(
  ctx: UserToolContext,
  ids: string[]
): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>()
  if (!ctx.isAuthenticated || !ctx.userId || !ctx.event || ids.length === 0) return out
  try {
    const client = createSupabaseServerClient(ctx.event)
    const { data, error } = await client
      .from('saved_events')
      .select('event_id')
      .eq('user_id', ctx.userId)
      .in('event_id', ids)
      .limit(ids.length)
    if (error) return out
    for (const row of (data ?? []) as Array<{ event_id: string }>) {
      out.set(row.event_id, true)
    }
  } catch (error) {
    console.error('[getSavedMembershipForIds] Error:', error)
  }
  return out
}

/**
 * Get the user context for tool execution.
 * This is called once at the start of the agent loop and passed to tool executors.
 */
export async function getUserToolContext(event: RequestEvent): Promise<UserToolContext> {
  const session = await getSessionUser(event)
  return {
    userId: session?.user?.id ?? null,
    isAuthenticated: !!session,
    event,
  }
}

// ============================================================================
// TOOL IMPLEMENTATIONS
// ============================================================================

/**
 * Save an event to the user's saved events list.
 * Requires authentication.
 */
export async function saveEventForUser(
  eventId: string,
  ctx: UserToolContext
): Promise<SaveEventResult> {
  if (!ctx.isAuthenticated || !ctx.userId || !ctx.event) {
    return {
      success: false,
      error: 'not_authenticated',
      message: 'You need to be logged in to save events. Would you like me to help you find the login page?',
    }
  }

  try {
    const client = createSupabaseServerClient(ctx.event)

    // First check if the event exists
    const { data: event, error: eventError } = await client
      .from('events')
      .select('id, name')
      .eq('id', eventId)
      .single()

    if (eventError || !event) {
      return {
        success: false,
        error: 'event_not_found',
        message: "I couldn't find that event. It may have been removed.",
      }
    }

    // Try to save the event
    const { error } = await client.from('saved_events').insert({
      user_id: ctx.userId,
      event_id: eventId,
    })

    if (error) {
      // Handle duplicate (already saved)
      if (error.code === '23505') {
        return {
          success: true, // Still successful from user's perspective
          error: 'already_saved',
          message: `"${event.name}" is already in your saved events.`,
        }
      }
      console.error('[saveEventForUser] Error:', error)
      return {
        success: false,
        error: 'unknown_error',
        message: 'Something went wrong saving the event. Please try again.',
      }
    }

    return {
      success: true,
      message: `Saved "${event.name}" to your list.`,
    }
  } catch (error) {
    console.error('[saveEventForUser] Unexpected error:', error)
    return {
      success: false,
      error: 'unknown_error',
      message: 'Something went wrong. Please try again.',
    }
  }
}

/**
 * Remove an event from the user's saved events list.
 * Requires authentication.
 */
export async function unsaveEventForUser(
  eventId: string,
  ctx: UserToolContext
): Promise<UnsaveEventResult> {
  if (!ctx.isAuthenticated || !ctx.userId || !ctx.event) {
    return {
      success: false,
      error: 'not_authenticated',
      message: 'You need to be logged in to manage saved events.',
    }
  }

  try {
    const client = createSupabaseServerClient(ctx.event)

    // Get event name for confirmation message
    const { data: event } = await client
      .from('events')
      .select('name')
      .eq('id', eventId)
      .single()

    const { error, count } = await client
      .from('saved_events')
      .delete()
      .eq('user_id', ctx.userId)
      .eq('event_id', eventId)

    if (error) {
      console.error('[unsaveEventForUser] Error:', error)
      return {
        success: false,
        error: 'unknown_error',
        message: 'Something went wrong removing the event. Please try again.',
      }
    }

    // Check if anything was actually deleted
    if (count === 0) {
      return {
        success: false,
        error: 'not_saved',
        message: "That event wasn't in your saved list.",
      }
    }

    return {
      success: true,
      message: event?.name
        ? `Removed "${event.name}" from your saved events.`
        : 'Event removed from your saved list.',
    }
  } catch (error) {
    console.error('[unsaveEventForUser] Unexpected error:', error)
    return {
      success: false,
      error: 'unknown_error',
      message: 'Something went wrong. Please try again.',
    }
  }
}

/**
 * Get the user's saved events.
 * Requires authentication.
 */
export async function listSavedEventsForUser(
  filter: 'all' | 'upcoming' | 'past' = 'all',
  ctx: UserToolContext
): Promise<ListSavedEventsResult> {
  if (!ctx.isAuthenticated || !ctx.userId || !ctx.event) {
    return {
      success: false,
      error: 'not_authenticated',
      events: [],
      message: 'You need to be logged in to see your saved events.',
    } as ListSavedEventsResult & { message: string }
  }

  try {
    const client = createSupabaseServerClient(ctx.event)
    const now = new Date().toISOString()

    // Query saved_events joined with events_with_venues view
    let query = client
      .from('saved_events')
      .select(`
        event_id,
        created_at,
        events_with_venues (*)
      `)
      .eq('user_id', ctx.userId)
      .order('created_at', { ascending: false })

    const { data, error } = await query

    if (error) {
      console.error('[listSavedEventsForUser] Error:', error)
      return {
        success: false,
        error: 'unknown_error',
        events: [],
      }
    }

    // Transform and filter the results
    type SavedEventRow = {
      event_id: string
      created_at: string
      events_with_venues: EventWithVenue | null
    }

    const rows = (data || []) as unknown as SavedEventRow[]
    const allEvents = rows
      .map((item) => item.events_with_venues)
      .filter((event): event is EventWithVenue => event !== null)

    // Count upcoming vs past
    const upcomingEvents = allEvents.filter(e => new Date(e.starts_at) >= new Date(now))
    const pastEvents = allEvents.filter(e => new Date(e.starts_at) < new Date(now))

    // Apply filter
    let filteredEvents: EventWithVenue[]
    switch (filter) {
      case 'upcoming':
        filteredEvents = upcomingEvents
        break
      case 'past':
        filteredEvents = pastEvents
        break
      default:
        filteredEvents = allEvents
    }

    return {
      success: true,
      events: filteredEvents,
      count: allEvents.length,
      upcomingCount: upcomingEvents.length,
      pastCount: pastEvents.length,
    }
  } catch (error) {
    console.error('[listSavedEventsForUser] Unexpected error:', error)
    return {
      success: false,
      error: 'unknown_error',
      events: [],
    }
  }
}

/**
 * Get full details for a specific event.
 * Does not require authentication (events are public).
 */
export async function getEventDetailsForUser(
  eventId: string
): Promise<GetEventDetailsResult> {
  try {
    const event = await getEventWithVenue(eventId)

    if (!event) {
      return {
        success: false,
        error: 'not_found',
      }
    }

    // Embeddings are internal search infrastructure and must not cross to the
    // client — strip the vector before returning the event to the chat.
    const { embedding: _embedding, ...eventWithoutEmbedding } = event

    return {
      success: true,
      event: eventWithoutEmbedding,
    }
  } catch (error) {
    console.error('[getEventDetailsForUser] Error:', error)
    return {
      success: false,
      error: 'not_found',
    }
  }
}

/**
 * Check if a specific event is saved by the user.
 * Requires authentication.
 */
export async function checkEventSavedForUser(
  eventId: string,
  ctx: UserToolContext
): Promise<CheckEventSavedResult> {
  if (!ctx.isAuthenticated || !ctx.userId || !ctx.event) {
    return {
      success: false,
      isSaved: false,
      error: 'not_authenticated',
    }
  }

  try {
    const client = createSupabaseServerClient(ctx.event)

    const { data, error } = await client
      .from('saved_events')
      .select('id')
      .eq('user_id', ctx.userId)
      .eq('event_id', eventId)
      .maybeSingle()

    if (error) {
      console.error('[checkEventSavedForUser] Error:', error)
      return {
        success: false,
        isSaved: false,
        error: 'unknown_error',
      }
    }

    return {
      success: true,
      isSaved: data !== null,
    }
  } catch (error) {
    console.error('[checkEventSavedForUser] Unexpected error:', error)
    return {
      success: false,
      isSaved: false,
      error: 'unknown_error',
    }
  }
}
