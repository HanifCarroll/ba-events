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

import { getSupabaseServiceRoleClient } from '#shared/lib/db/service.server.ts'
import { logger } from '#shared/lib/logger.ts'

import type { UIMessage } from 'ai'
import type { MessageExecutionStep } from '#shared/lib/types.ts'

export type GuestDebugAssistantMessage = {
  id: string
  role: 'assistant'
  parts: Array<{ type: 'text'; text: string }>
  executionTrace?: MessageExecutionStep[]
  error?: string
}

export async function persistGuestChatDebug(input: {
  conversationId: string | null
  locale: 'en' | 'es'
  ip: string
  messages: unknown
  lastUserText: string | null
}): Promise<void> {
  const conversationId = input.conversationId
  if (!conversationId) return

  try {
    await runWithTimeout(() =>
      upsertGuestChatDebug({
        conversationId,
        locale: input.locale,
        ip: input.ip,
        messages: input.messages,
        lastUserText: input.lastUserText,
      })
    )
  } catch (error) {
    logger.warn('[guest-debug] Guest transcript write timed out', {
      conversationId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export function buildGuestDebugTranscript(
  uiMessages: UIMessage[],
  assistant: GuestDebugAssistantMessage
): unknown[] {
  return [...uiMessages, assistant]
}

export async function upsertGuestChatDebug(input: {
  conversationId: string
  locale: 'en' | 'es'
  ip: string
  messages: unknown
  lastUserText: string | null
}): Promise<void> {
  if (!input.conversationId) {
    return
  }

  try {
    const client = getSupabaseServiceRoleClient()
    const { error } = await client.from('guest_chat_debug').upsert(
      {
        conversation_id: input.conversationId,
        locale: input.locale,
        ip: input.ip,
        messages: input.messages,
        last_user_text: input.lastUserText,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'conversation_id' }
    )

    if (error) {
      logger.warn('[guest-debug] Failed to persist guest chat debug row', {
        conversationId: input.conversationId,
        error: error.message,
      })
    }
  } catch (error) {
    logger.warn('[guest-debug] Failed to persist guest chat debug row', {
      conversationId: input.conversationId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
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
export async function recordGuestRequestStarted(input: {
  requestId: string
  conversationId: string | null
}): Promise<void> {
  if (!input.requestId) return

  try {
    const client = getSupabaseServiceRoleClient()
    await runWithTimeout(async () => {
      const { error } = await client.from('guest_request_lifecycle').insert({
        request_id: input.requestId,
        conversation_id: input.conversationId,
        status: 'started',
        started_at: new Date().toISOString(),
      })
      if (error) throw error
    })
  } catch (error) {
    logger.warn('[guest-debug] Failed to record guest request start', {
      requestId: input.requestId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Terminal `completed`/`errored` write for the same row. Upsert (not update)
 * so a terminal state is durable even when the `started` insert never landed
 * or was lost. Fail-open: never throws to the caller.
 */
export async function recordGuestRequestTerminal(input: {
  requestId: string
  status: 'completed' | 'errored'
  errorType?: string | null
  providerRequestId?: string | null
}): Promise<void> {
  if (!input.requestId) return

  try {
    const client = getSupabaseServiceRoleClient()
    await runWithTimeout(async () => {
      // `started_at` is intentionally omitted: on conflict the original start
      // time is preserved, and on insert the column's `DEFAULT now()` supplies
      // a defensible timestamp for the terminal-only row.
      const { error } = await client
        .from('guest_request_lifecycle')
        .upsert(
          {
            request_id: input.requestId,
            status: input.status,
            ended_at: new Date().toISOString(),
            error_type: input.errorType ?? null,
            provider_request_id: input.providerRequestId ?? null,
          },
          { onConflict: 'request_id' }
        )
      if (error) throw error
    })
  } catch (error) {
    logger.warn('[guest-debug] Failed to record guest request terminal state', {
      requestId: input.requestId,
      status: input.status,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
