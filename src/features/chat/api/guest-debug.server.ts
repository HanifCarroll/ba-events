/**
 * Guest chat debug persistence.
 *
 * Saves a server-side copy of a guest (not signed-in) concierge chat to the
 * `guest_chat_debug` table so Hanif can look it up by conversation id when
 * something breaks. Guests otherwise persist only in the browser (Dexie), so
 * the server has no record of their chat.
 *
 * This is a debug aid, not a feature: it must never fail the chat response.
 * Every error is swallowed and logged with `logger.warn`. This table is never exposed by a public API.
 * Up to 256 KiB of transcript JSON is retained, favoring the newest turns.
 */

import { Data, Effect } from 'effect'
import { logger } from '#shared/lib/logger.ts'
import { requireD1 } from '#shared/lib/db/d1-binding.server.ts'

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
  if (!conversationId) return Effect.undefined

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
  // The browser received a transient trace, not a persistent assistant part.
  // Only this turn's server-produced trace may arrive on a new write.
  return [...uiMessages.map(({ id, role, parts }) => ({ id, role, parts })), assistant]
}

export const GUEST_DEBUG_TRANSCRIPT_MAX_BYTES = 256 * 1024
const MAX_TRANSCRIPT_WRITE_ATTEMPTS = 3
const utf8 = new TextEncoder()

function records(messages: unknown): Record<string, unknown>[] {
  return Array.isArray(messages)
    ? messages.filter((message): message is Record<string, unknown> => !!message && typeof message === 'object' && !Array.isArray(message))
    : []
}

function debugMessageKey(message: Record<string, unknown>): string | undefined {
  if (message.role === 'assistant') {
    const response = records(message.parts).find(part => part.type === 'data-response')?.data
    if (response && typeof response === 'object' && 'requestId' in response && typeof response.requestId === 'string') {
      return `request:${response.requestId}`
    }
  }
  return typeof message.id === 'string' ? `message:${message.id}` : undefined
}

/** Keep server-owned traces when later snapshots resend only display parts. */
function mergeGuestDebugTranscript(previous: string | null, messages: unknown) {
  const stored = previous ? records(JSON.parse(previous)) : []
  const incoming = records(messages)
  const keyed = (rows: typeof stored) => new Map(rows.flatMap(message => {
    const key = debugMessageKey(message)
    return key ? [[key, message] as const] : []
  }))
  const storedByKey = keyed(stored)
  const incomingByKey = keyed(incoming)
  const newest = incoming.at(-1)
  const newestKey = newest && debugMessageKey(newest)
  const late = newestKey !== undefined && stored.slice(0, -1).some(message => debugMessageKey(message) === newestKey)
  const firstKey = incoming[0] && debugMessageKey(incoming[0])
  const prefix = firstKey ? stored.findIndex(message => debugMessageKey(message) === firstKey) : -1
  const base = late ? stored : [...stored.slice(0, Math.max(0, prefix)), ...incoming]
  const serialized: string[] = []
  let bytes = 2 // array brackets
  for (const message of base.toReversed()) {
    const key = debugMessageKey(message)
    const fromIncoming = key ? incomingByKey.get(key) : undefined
    const fromStorage = key ? storedByKey.get(key) : undefined
    const incomingTrace = fromIncoming?.executionTrace
    const trace = message.role !== 'assistant' ? undefined
      : Array.isArray(incomingTrace) && incomingTrace.length ? incomingTrace : fromStorage?.executionTrace
    const entry = JSON.stringify({ ...message, executionTrace: Array.isArray(trace) ? trace : undefined })
    const entryBytes = utf8.encode(entry).byteLength + (serialized.length ? 1 : 0)
    if (bytes + entryBytes > GUEST_DEBUG_TRANSCRIPT_MAX_BYTES) break
    serialized.push(entry)
    bytes += entryBytes
  }
  return { messages: `[${serialized.reverse().join(',')}]`, late }
}

export function upsertGuestChatDebugEffect(input: {
  conversationId: string
  locale: 'en' | 'es'
  ip: string
  messages: unknown
  lastUserText: string | null
}): Effect.Effect<void, never> {
  if (!input.conversationId) return Effect.undefined

  const now = new Date().toISOString()
  return Effect.match(Effect.tryPromise({
    try: async () => {
      const db = requireD1()
      for (let attempt = 0; attempt < MAX_TRANSCRIPT_WRITE_ATTEMPTS; attempt++) {
        const previous = await db.prepare('SELECT messages, last_user_text FROM guest_chat_debug WHERE conversation_id = ?')
          .bind(input.conversationId).first<{ messages: string; last_user_text: string | null }>()
        const { messages, late } = mergeGuestDebugTranscript(previous?.messages ?? null, input.messages)
        const lastUserText = late && previous ? previous.last_user_text : input.lastUserText
        const result = await db.prepare(`INSERT INTO guest_chat_debug (conversation_id, locale, ip, messages, last_user_text, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (conversation_id) DO UPDATE SET locale = excluded.locale, ip = excluded.ip,
          messages = excluded.messages, last_user_text = excluded.last_user_text, updated_at = excluded.updated_at
          WHERE guest_chat_debug.messages = ?`)
          .bind(input.conversationId, input.locale, input.ip, messages, lastUserText, now, now, previous?.messages ?? null).run()
        if (result.meta.changes > 0) return
      }
      throw new Error('Guest transcript changed during all write attempts')
    },
    catch: (cause) => guestDebugFailure('Failed to persist guest chat debug row', cause),
  }), {
    onFailure: (error) => logger.warn('[guest-debug] Failed to persist guest chat debug row', {
      conversationId: input.conversationId,
      error: error.cause instanceof Error ? error.cause.message : String(error.cause ?? error),
    }),
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

async function runWithTimeout(run: () => Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([run(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Guest request lifecycle write timed out')), REQUEST_LIFECYCLE_TIMEOUT_MS)
    })])
  } finally {
    clearTimeout(timer)
  }
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
  if (!input.requestId) return Effect.undefined

  const program = Effect.tryPromise({
    try: () => {
      const now = new Date().toISOString()
      return runWithTimeout(() => requireD1().prepare(`INSERT INTO guest_request_lifecycle (request_id, conversation_id, status, started_at)
        VALUES (?, ?, 'started', ?)`).bind(input.requestId, input.conversationId, now).run())
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
  if (!input.requestId) return Effect.undefined

  const program = Effect.tryPromise({
    try: () => {
      // Existing rows keep their started_at; terminal-only rows get the column default.
      return runWithTimeout(() => requireD1().prepare(`INSERT INTO guest_request_lifecycle
          (request_id, conversation_id, status, ended_at, error_type, provider_request_id) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (request_id) DO UPDATE SET conversation_id = excluded.conversation_id, status = excluded.status,
          ended_at = excluded.ended_at, error_type = excluded.error_type, provider_request_id = excluded.provider_request_id`)
        .bind(input.requestId, input.conversationId, input.status, new Date().toISOString(), input.errorType ?? null,
          input.providerRequestId ?? null).run())
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
