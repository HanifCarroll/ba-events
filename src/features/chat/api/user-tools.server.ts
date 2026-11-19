import type { RequestEvent } from '@sveltejs/kit'
import { Data, Effect } from 'effect'
import { getSessionUserEffect } from '#features/auth/api/session.server.ts'
import { getEventWithVenue } from '#shared/lib/db/client.server.ts'
import { withReadSignal } from '#shared/lib/db/read-signal.ts'
import { boundD1Database } from '#shared/lib/db/d1.server.ts'
import { d1UserStore } from '#features/auth/api/user-store.server.ts'
import type { ChatEventPayload, EventWithVenue, SavedMembershipResult } from '#shared/lib/types.ts'
import { ensureChatEventPayload } from './tools/utils.ts'

export interface UserToolContext {
  userId: string | null
  isAuthenticated: boolean
  /** The request event, which carries the D1 binding. */
  event?: RequestEvent
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

function d1For(ctx: UserToolContext) {
  return ctx.event ? boundD1Database((ctx.event.platform as { env?: unknown } | undefined)?.env) : null
}

/** Effect-native bounded authoritative saved-membership query. */
export function getSavedMembershipForIdsEffect(
  ctx: UserToolContext,
  ids: string[],
  abortSignal?: AbortSignal,
): Effect.Effect<SavedMembershipResult, never> {
  if (!ctx.isAuthenticated || !ctx.userId || !ctx.event) return Effect.succeed({ status: 'unavailable' })
  if (ids.length === 0) return Effect.succeed({ status: 'complete', savedIds: new Set<string>() })
  const d1 = d1For(ctx)
  if (!d1) return Effect.succeed({ status: 'unavailable' })
  return Effect.match(
    promiseEffect(signal => withReadSignal(() => d1UserStore(d1).savedMembership(ctx.userId!, ids), abortSignal ? AbortSignal.any([abortSignal, signal]) : signal), 'Failed to load saved event membership'),
    {
      onFailure: (error) => {
        console.error('[getSavedMembershipForIds] Error:', error)
        return { status: 'unavailable' as const }
      },
      onSuccess: (savedIds) => ({ status: 'complete' as const, savedIds }),
    },
  )
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
  const d1 = d1For(ctx)
  if (!d1) return Effect.succeed({ success: false, error: 'unknown_error', events: [] })
  return Effect.match(
    promiseEffect(signal => withReadSignal(() => d1UserStore(d1).savedEvents(ctx.userId!), abortSignal ? AbortSignal.any([abortSignal, signal]) : signal), 'Failed to list saved events'),
    {
      onFailure: (error) => {
        console.error('[listSavedEventsForUser] Unexpected error:', error)
        return { success: false, error: 'unknown_error', events: [] } satisfies ListSavedEventsResult
      },
      onSuccess: (saved) => {
        const now = new Date()
        const allEvents: EventWithVenue[] = saved.map(({ saved_at: _savedAt, ...event }) => event)
        const upcomingEvents = allEvents.filter((event) => new Date(event.starts_at) >= now)
        const pastEvents = allEvents.filter((event) => new Date(event.starts_at) < now)
        const filteredEvents = filter === 'upcoming' ? upcomingEvents : filter === 'past' ? pastEvents : allEvents
        return { success: true, events: filteredEvents, count: allEvents.length, upcomingCount: upcomingEvents.length, pastCount: pastEvents.length }
      },
    },
  )
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
