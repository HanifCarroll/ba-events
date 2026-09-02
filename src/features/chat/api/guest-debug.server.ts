/**
 * Guest chat debug persistence.
 *
 * Saves a server-side copy of a guest (not signed-in) concierge chat to the
 * `guest_chat_debug` table so Hanif can look it up by conversation id when
 * something breaks. Guests otherwise persist only in the browser (Dexie), so
 * the server has no record of their chat.
 *
 * This is a debug aid, not a feature: it must never fail the chat response.
 * Every error is swallowed and logged with `logger.warn`. The table has no RLS
 * policies, so only the service-role client can read or write it.
 */

import { Data, Effect } from 'effect'
import { getSupabaseServiceRoleClient } from '#shared/lib/db/service.server.ts'
import { logger } from '#shared/lib/logger.ts'

import type { UIMessage } from 'ai'
import type { MessageExecutionStep } from '#shared/lib/types.ts'

export type GuestDebugAssistantMessage = {
  id: string
  role: 'assistant'
  parts: Array<
    | { type: 'text'; text: string }
    | { type: 'data-response'; data: unknown }
  >
  executionTrace?: MessageExecutionStep[]
  error?: string
}

export type GuestRequestTerminalStatus =
  | 'completed'
  | 'completed_with_fallback'
  | 'errored'

class GuestDebugPersistenceError extends Data.TaggedError('GuestDebugPersistenceError')<{
  readonly message: string
  readonly cause?: unknown
}> {}

const guestDebugFailure = (message: string, cause?: unknown) => new GuestDebugPersistenceError({ message, cause })

export function persistGuestChatDebugEffect(input: {
  conversationId: string | null
  locale: 'en' | 'es'
  ip: string
  messages: unknown
  lastUserText: string | null
}): Effect.Effect<void, never> {
  const conversationId = input.conversationId
  if (!conversationId) return Effect.succeed(undefined)

  const program = Effect.tryPromise({
    try: () => runWithTimeout(() =>
      upsertGuestChatDebug({
        conversationId,
        locale: input.locale,
        ip: input.ip,
        messages: input.messages,
        lastUserText: input.lastUserText,
      })
    ),
    catch: (cause) => guestDebugFailure('Guest transcript write timed out', cause),
  })
  return Effect.match(program, {
    onFailure: (error) => {
      logger.warn('[guest-debug] Guest transcript write timed out', {
        conversationId,
        error: error.cause instanceof Error ? error.cause.message : String(error.cause ?? error),
      })
    },
    onSuccess: () => undefined,
  })
}

export function persistGuestChatDebug(input: {
  conversationId: string | null
  locale: 'en' | 'es'
  ip: string
  messages: unknown
  lastUserText: string | null
}) {
  return Effect.runPromise(persistGuestChatDebugEffect(input))
}

export function buildGuestDebugTranscript(
  uiMessages: UIMessage[],
  assistant: GuestDebugAssistantMessage
): unknown[] {
  return [...uiMessages, assistant]
}

export function upsertGuestChatDebugEffect(input: {
  conversationId: string
  locale: 'en' | 'es'
  ip: string
  messages: unknown
  lastUserText: string | null
}): Effect.Effect<void, never> {
  if (!input.conversationId) return Effect.succeed(undefined)

  const program = Effect.gen(function* () {
    const client = getSupabaseServiceRoleClient()
    const { error } = yield* Effect.tryPromise({
      try: () => client.from('guest_chat_debug').upsert(
      {
        conversation_id: input.conversationId,
        locale: input.locale,
        ip: input.ip,
        messages: input.messages,
        last_user_text: input.lastUserText,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'conversation_id' }
      ),
      catch: (cause) => guestDebugFailure('Failed to persist guest chat debug row', cause),
    })

    if (error) {
      logger.warn('[guest-debug] Failed to persist guest chat debug row', {
        conversationId: input.conversationId,
        error: error.message,
      })
    }
  })
  return Effect.match(program, {
    onFailure: (error) => {
      const cause = error.cause
    logger.warn('[guest-debug] Failed to persist guest chat debug row', {
      conversationId: input.conversationId,
      error: cause instanceof Error ? cause.message : String(cause ?? error),
    })
    },
    onSuccess: () => undefined,
  })
}

export function upsertGuestChatDebug(input: {
  conversationId: string
  locale: 'en' | 'es'
  ip: string
  messages: unknown
  lastUserText: string | null
}) {
  return Effect.runPromise(upsertGuestChatDebugEffect(input))
}

/**
 * Upper bound on any lifecycle write so diagnostics can never gate the chat
 * stream. Writes are awaited (so a process death still leaves a durable
 * `started` row) but capped: if the database does not settle in time the
 * write is abandoned and logged.
 */
const REQUEST_LIFECYCLE_TIMEOUT_MS = 1500

function runWithTimeout(run: () => Promise<unknown>): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>()
  const timeoutId = setTimeout(
    () => reject(new Error('Guest request lifecycle write timed out')),
    REQUEST_LIFECYCLE_TIMEOUT_MS
  )
  run().then(
    () => {
      clearTimeout(timeoutId)
      resolve()
    },
    (error: unknown) => {
      clearTimeout(timeoutId)
      reject(error)
    }
  )
  return promise
}

/**
 * Durable "started" marker, written before the model is invoked. A row left
 * in `started` is evidence the process died before reaching a terminal state.
 * Fail-open: never throws to the caller.
 */
export function recordGuestRequestStartedEffect(input: {
  requestId: string
  conversationId: string | null
}): Effect.Effect<void, never> {
  if (!input.requestId) return Effect.succeed(undefined)

  const program = Effect.tryPromise({
    try: () => {
      const client = getSupabaseServiceRoleClient()
      return runWithTimeout(async () => {
        const { error } = await client.from('guest_request_lifecycle').insert({
        request_id: input.requestId,
        conversation_id: input.conversationId,
        status: 'started',
        started_at: new Date().toISOString(),
        })
        if (error) throw error
      })
    },
    catch: (cause) => guestDebugFailure('Failed to record guest request start', cause),
  })
  return Effect.match(program, {
    onFailure: (error) => logger.warn('[guest-debug] Failed to record guest request start', {
      requestId: input.requestId,
      error: error.cause instanceof Error ? error.cause.message : String(error.cause ?? error),
    }),
    onSuccess: () => undefined,
  })
}

export function recordGuestRequestStarted(input: { requestId: string; conversationId: string | null }) {
  return Effect.runPromise(recordGuestRequestStartedEffect(input))
}

/**
 * Terminal `completed`/`errored` write for the same row. Upsert (not update)
 * so a terminal state is durable even when the `started` insert never landed
 * or was lost. Fail-open: never throws to the caller.
 */
export function recordGuestRequestTerminalEffect(input: {
  requestId: string
  conversationId: string | null
  status: GuestRequestTerminalStatus
  errorType?: string | null
  providerRequestId?: string | null
}): Effect.Effect<void, never> {
  if (!input.requestId) return Effect.succeed(undefined)

  const program = Effect.tryPromise({
    try: () => {
      const client = getSupabaseServiceRoleClient()
      return runWithTimeout(async () => {
      // `started_at` is intentionally omitted: on conflict the original start
      // time is preserved, and on insert the column's `DEFAULT now()` supplies
      // a defensible timestamp for the terminal-only row.
      const { error } = await client
        .from('guest_request_lifecycle')
        .upsert(
          {
            request_id: input.requestId,
            conversation_id: input.conversationId,
            status: input.status,
            ended_at: new Date().toISOString(),
            error_type: input.errorType ?? null,
            provider_request_id: input.providerRequestId ?? null,
          },
          { onConflict: 'request_id' }
        )
      if (error) throw error
      })
    },
    catch: (cause) => guestDebugFailure('Failed to record guest request terminal state', cause),
  })
  return Effect.match(program, {
    onFailure: (error) => logger.warn('[guest-debug] Failed to record guest request terminal state', {
      requestId: input.requestId,
      status: input.status,
      error: error.cause instanceof Error ? error.cause.message : String(error.cause ?? error),
    }),
    onSuccess: () => undefined,
  })
}

export function recordGuestRequestTerminal(input: {
  requestId: string
  conversationId: string | null
  status: GuestRequestTerminalStatus
  errorType?: string | null
  providerRequestId?: string | null
}) {
  return Effect.runPromise(recordGuestRequestTerminalEffect(input))
}
