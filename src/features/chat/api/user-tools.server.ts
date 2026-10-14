/**
 * Server-side agent user tools. Session identity is derived from the request;
 * Supabase calls are leaves while authorization and result mapping remain in
 * Effect programs.
 */

import type { RequestEvent } from '@sveltejs/kit'
import { Data, Effect } from 'effect'
import { getSessionUserEffect } from '#features/auth/api/session.server.ts'
import { getEventWithVenue } from '#shared/lib/db/client.server.ts'
import { createSupabaseServerClient } from '#shared/lib/db/server-client.server.ts'
import { withReadSignal } from '#shared/lib/db/read-signal.ts'
import type { ChatEventPayload, EventWithVenue, SavedMembershipResult } from '#shared/lib/types.ts'
import { ensureChatEventPayload } from './tools/utils.ts'

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

class UserToolError extends Data.TaggedError('UserToolError')<{
  readonly message: string
  readonly cause?: unknown
}> {}

const userToolFailure = (message: string, cause?: unknown) => new UserToolError({ message, cause })

function promiseEffect<A>(run: (signal: AbortSignal) => PromiseLike<A>, fallbackMessage: string) {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => userToolFailure(
      cause instanceof Error && cause.message ? cause.message : fallbackMessage,
      cause,
    ),
  })
}

/** Effect-native bounded authoritative saved-membership query. */
export function getSavedMembershipForIdsEffect(
  ctx: UserToolContext,
  ids: string[],
  abortSignal?: AbortSignal,
): Effect.Effect<SavedMembershipResult, never> {
  if (!ctx.isAuthenticated || !ctx.userId || !ctx.event) return Effect.succeed({ status: 'unavailable' })
  if (ids.length === 0) return Effect.succeed({ status: 'complete', savedIds: new Set<string>() })
  const program = Effect.gen(function* () {
    const client = createSupabaseServerClient(ctx.event!)
    const { data, error } = yield* promiseEffect(
      (fiberSignal) => withReadSignal(client
        .from('saved_events')
        .select('event_id')
        .eq('user_id', ctx.userId!)
        .in('event_id', ids)
        .limit(ids.length), abortSignal ? AbortSignal.any([abortSignal, fiberSignal]) : fiberSignal),
      'Failed to load saved event membership',
    )
    if (error) return { status: 'unavailable' as const }
    const savedIds = new Set<string>((data ?? []).map((row: { event_id: string }) => row.event_id))
    return { status: 'complete' as const, savedIds }
  })
  return Effect.match(program, {
    onFailure: (error) => {
      console.error('[getSavedMembershipForIds] Error:', error)
      return { status: 'unavailable' as const }
    },
    onSuccess: (result) => result,
  })
}

export function getSavedMembershipForIds(ctx: UserToolContext, ids: string[], abortSignal?: AbortSignal) {
  return Effect.runPromise(getSavedMembershipForIdsEffect(ctx, ids, abortSignal), { signal: abortSignal })
}

/** Effect-native request session lookup. */
export function getUserToolContextEffect(event: RequestEvent): Effect.Effect<UserToolContext, UserToolError> {
  return Effect.map(
    getSessionUserEffect(event),
    (session) => ({ userId: session?.user?.id ?? null, isAuthenticated: !!session, event }),
  )
}

export function getUserToolContext(event: RequestEvent) {
  return Effect.runPromise(getUserToolContextEffect(event))
}

/** Effect-native save operation. */
export function saveEventForUserEffect(eventId: string, ctx: UserToolContext): Effect.Effect<SaveEventResult, never> {
  if (!ctx.isAuthenticated || !ctx.userId || !ctx.event) {
    return Effect.succeed({
      success: false,
      error: 'not_authenticated',
      message: 'You need to be logged in to save events. Would you like me to help you find the login page?',
    })
  }
  const program = Effect.gen(function* () {
    const client = createSupabaseServerClient(ctx.event!)
    const { data: event, error: eventError } = yield* promiseEffect(
      () => client.from('events').select('id, name').eq('id', eventId).single(),
      'Failed to read event',
    )
    if (eventError || !event) {
      return { success: false as const, error: 'event_not_found' as const, message: "I couldn't find that event. It may have been removed." }
    }
    const { error } = yield* promiseEffect(
      () => client.from('saved_events').insert({ user_id: ctx.userId!, event_id: eventId }),
      'Failed to save event',
    )
    if (error?.code === '23505') {
      return { success: true as const, error: 'already_saved' as const, message: `"${event.name}" is already in your saved events.` }
    }
    if (error) {
      console.error('[saveEventForUser] Error:', error)
      return { success: false as const, error: 'unknown_error' as const, message: 'Something went wrong saving the event. Please try again.' }
    }
    return { success: true as const, message: `Saved "${event.name}" to your list.` }
  })
  return Effect.match(program, {
    onFailure: (error) => {
      console.error('[saveEventForUser] Unexpected error:', error)
      return { success: false, error: 'unknown_error', message: 'Something went wrong. Please try again.' } satisfies SaveEventResult
    },
    onSuccess: (result) => result,
  })
}

export function saveEventForUser(eventId: string, ctx: UserToolContext) {
  return Effect.runPromise(saveEventForUserEffect(eventId, ctx))
}

/** Effect-native unsave operation. */
export function unsaveEventForUserEffect(eventId: string, ctx: UserToolContext): Effect.Effect<UnsaveEventResult, never> {
  if (!ctx.isAuthenticated || !ctx.userId || !ctx.event) {
    return Effect.succeed({ success: false, error: 'not_authenticated', message: 'You need to be logged in to manage saved events.' })
  }
  const program = Effect.gen(function* () {
    const client = createSupabaseServerClient(ctx.event!)
    const { data: event } = yield* promiseEffect(
      () => client.from('events').select('name').eq('id', eventId).single(),
      'Failed to read event',
    )
    const { error, count } = yield* promiseEffect(
      () => client.from('saved_events').delete().eq('user_id', ctx.userId!).eq('event_id', eventId),
      'Failed to remove saved event',
    )
    if (error) {
      console.error('[unsaveEventForUser] Error:', error)
      return { success: false as const, error: 'unknown_error' as const, message: 'Something went wrong removing the event. Please try again.' }
    }
    if (count === 0) return { success: false as const, error: 'not_saved' as const, message: "That event wasn't in your saved list." }
    return { success: true as const, message: event?.name ? `Removed "${event.name}" from your saved events.` : 'Event removed from your saved list.' }
  })
  return Effect.match(program, {
    onFailure: (error) => {
      console.error('[unsaveEventForUser] Unexpected error:', error)
      return { success: false, error: 'unknown_error', message: 'Something went wrong. Please try again.' } satisfies UnsaveEventResult
    },
    onSuccess: (result) => result,
  })
}

export function unsaveEventForUser(eventId: string, ctx: UserToolContext) {
  return Effect.runPromise(unsaveEventForUserEffect(eventId, ctx))
}

type SavedEventRow = {
  event_id: string
  created_at: string
  events_with_venues: EventWithVenue | null
}

/** Effect-native saved-event list operation. */
export function listSavedEventsForUserEffect(
  filter: 'all' | 'upcoming' | 'past' = 'all',
  ctx: UserToolContext,
  abortSignal?: AbortSignal,
): Effect.Effect<ListSavedEventsResult, never> {
  if (!ctx.isAuthenticated || !ctx.userId || !ctx.event) {
    return Effect.succeed({
      success: false,
      error: 'not_authenticated',
      events: [],
      message: 'You need to be logged in to see your saved events.',
    } as ListSavedEventsResult & { message: string })
  }
  const program = Effect.gen(function* () {
    const client = createSupabaseServerClient(ctx.event!)
    const now = new Date().toISOString()
    const { data, error } = yield* promiseEffect(
      (fiberSignal) => withReadSignal(client
        .from('saved_events')
        .select(`
        event_id,
        created_at,
        events_with_venues (*)
      `)
        .eq('user_id', ctx.userId!)
        .order('created_at', { ascending: false }), abortSignal ? AbortSignal.any([abortSignal, fiberSignal]) : fiberSignal),
      'Failed to list saved events',
    )
    if (error) {
      console.error('[listSavedEventsForUser] Error:', error)
      return { success: false as const, error: 'unknown_error' as const, events: [] }
    }
    const rows = (data || []) as unknown as SavedEventRow[]
    const allEvents = rows.map((item) => item.events_with_venues).filter((event): event is EventWithVenue => event !== null)
    const upcomingEvents = allEvents.filter((event) => new Date(event.starts_at) >= new Date(now))
    const pastEvents = allEvents.filter((event) => new Date(event.starts_at) < new Date(now))
    const filteredEvents = filter === 'upcoming' ? upcomingEvents : filter === 'past' ? pastEvents : allEvents
    return { success: true as const, events: filteredEvents, count: allEvents.length, upcomingCount: upcomingEvents.length, pastCount: pastEvents.length }
  })
  return Effect.match(program, {
    onFailure: (error) => {
      console.error('[listSavedEventsForUser] Unexpected error:', error)
      return { success: false, error: 'unknown_error', events: [] } satisfies ListSavedEventsResult
    },
    onSuccess: (result) => result,
  })
}

export function listSavedEventsForUser(filter: 'all' | 'upcoming' | 'past' = 'all', ctx: UserToolContext, abortSignal?: AbortSignal) {
  return Effect.runPromise(listSavedEventsForUserEffect(filter, ctx, abortSignal), { signal: abortSignal })
}

/** Effect-native public event-details lookup. */
export function getEventDetailsForUserEffect(eventId: string, abortSignal?: AbortSignal): Effect.Effect<GetEventDetailsResult, never> {
  const program = Effect.map(
    promiseEffect((fiberSignal) => getEventWithVenue(eventId, abortSignal ? AbortSignal.any([abortSignal, fiberSignal]) : fiberSignal), 'Failed to read event details'),
    (event) => {
      if (!event) return { success: false as const, error: 'not_found' as const }
      return { success: true as const, event: ensureChatEventPayload(event) }
    },
  )
  return Effect.match(program, {
    onFailure: (error) => {
      console.error('[getEventDetailsForUser] Error:', error)
      return { success: false, error: 'not_found' } satisfies GetEventDetailsResult
    },
    onSuccess: (result) => result,
  })
}

export function getEventDetailsForUser(eventId: string, abortSignal?: AbortSignal) {
  return Effect.runPromise(getEventDetailsForUserEffect(eventId, abortSignal), { signal: abortSignal })
}

/** Effect-native saved-state lookup. */
export function checkEventSavedForUserEffect(eventId: string, ctx: UserToolContext): Effect.Effect<CheckEventSavedResult, never> {
  if (!ctx.isAuthenticated || !ctx.userId || !ctx.event) {
    return Effect.succeed({ success: false, isSaved: false, error: 'not_authenticated' })
  }
  const program = Effect.gen(function* () {
    const client = createSupabaseServerClient(ctx.event!)
    const { data, error } = yield* promiseEffect(
      () => client.from('saved_events').select('id').eq('user_id', ctx.userId!).eq('event_id', eventId).maybeSingle(),
      'Failed to check saved event',
    )
    if (error) {
      console.error('[checkEventSavedForUser] Error:', error)
      return { success: false as const, isSaved: false, error: 'unknown_error' as const }
    }
    return { success: true as const, isSaved: data !== null }
  })
  return Effect.match(program, {
    onFailure: (error) => {
      console.error('[checkEventSavedForUser] Unexpected error:', error)
      return { success: false, isSaved: false, error: 'unknown_error' } satisfies CheckEventSavedResult
    },
    onSuccess: (result) => result,
  })
}

export function checkEventSavedForUser(eventId: string, ctx: UserToolContext) {
  return Effect.runPromise(checkEventSavedForUserEffect(eventId, ctx))
}
