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

import { searchContextFromCanonical } from './agent/search-context.ts'
import { GUEST_DEBUG_FORMAT_VERSION, isServerGuestTranscript } from './guest-debug-format.ts'
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

type GuestDebugWrite = {
  conversationId: string | null
  locale: 'en' | 'es'
  ip: string
  /** Untrusted client history, always projected before persistence. */
  messages: unknown
  /** The current response, separately supplied by the server. */
  assistant?: GuestDebugAssistantMessage
  lastUserText: string | null
}

export function persistGuestChatDebugEffect(input: GuestDebugWrite): Effect.Effect<void, never> {
  const conversationId = input.conversationId
  if (!conversationId) return Effect.undefined

  const program = Effect.tryPromise({
    try: () => runWithTimeout(() =>
      Effect.runPromise(upsertGuestChatDebugEffect({ ...input, conversationId }))
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

export function persistGuestChatDebug(input: GuestDebugWrite) {
  return Effect.runPromise(persistGuestChatDebugEffect(input))
}

export const GUEST_DEBUG_TRANSCRIPT_MAX_BYTES = 256 * 1024
const MAX_TRANSCRIPT_WRITE_ATTEMPTS = 3
const utf8 = new TextEncoder()

function records(messages: unknown): Record<string, unknown>[] {
  return Array.isArray(messages)
    ? messages.filter((message): message is Record<string, unknown> => !!message && typeof message === 'object' && !Array.isArray(message))
    : []
}

/** The client can supply display history, never an execution trace, error, or provenance. */
function clientHistory(messages: unknown): Record<string, unknown>[] {
  return records(messages).flatMap(({ id, role, parts, content }) => {
    if (typeof id !== 'string' || (role !== 'user' && role !== 'assistant')) return []
    const visible: Record<string, unknown>[] = []
    for (const { type, text, data } of records(parts)) {
      if (type === 'text' && typeof text === 'string') visible.push({ type, text })
      else if (role === 'assistant' && type === 'data-response' && data && typeof data === 'object') {
        const response = data as Record<string, unknown>
        const events = records(response.events).flatMap(({ name }) => typeof name === 'string' ? [{ name }] : [])
        const suggestions = records(response.suggestions).map(({ id, label, prompt, icon, type }) =>
          Object.fromEntries(Object.entries({ id, label, prompt, icon, type }).filter(([, value]) => typeof value === 'string')))
        visible.push({ type, data: { requestId: typeof response.requestId === 'string' ? response.requestId : undefined,
          events, suggestions, searchContext: searchContextFromCanonical(response) } })
      }
    }
    return [{ id, role, parts: visible, ...(typeof content === 'string' ? { content } : {}) }]
  })
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
function mergeGuestDebugTranscript(previous: string | null, clientMessages: unknown, assistant?: GuestDebugAssistantMessage) {
  const parsed: unknown = previous ? JSON.parse(previous) : []
  const stored = isServerGuestTranscript(parsed) ? records(parsed.messages) : clientHistory(parsed)
  const serverMessage = assistant ? { ...assistant, serverRecorded: true } : undefined
  const incoming = clientHistory(clientMessages)
  if (serverMessage) incoming.push(serverMessage)
  const keyed = (rows: typeof stored) => new Map(rows.flatMap(message => {
    const key = debugMessageKey(message)
    return key ? [[key, message] as const] : []
  }))
  const storedByKey = keyed(stored)
  const serverKey = serverMessage && debugMessageKey(serverMessage)
  const newest = incoming.at(-1)
  const newestKey = newest && debugMessageKey(newest)
  const late = newestKey !== undefined && stored.slice(0, -1).some(message => debugMessageKey(message) === newestKey)
  const firstKey = incoming[0] && debugMessageKey(incoming[0])
  const prefix = firstKey ? stored.findIndex(message => debugMessageKey(message) === firstKey) : -1
  const base = late ? stored : [...stored.slice(0, Math.max(0, prefix)), ...incoming]
  const serialized: string[] = []
  const prefixJson = `{"version":${GUEST_DEBUG_FORMAT_VERSION},"messages":[`
  const suffixJson = ']}'
  let bytes = prefixJson.length + suffixJson.length
  for (const message of base.toReversed()) {
    const key = debugMessageKey(message)
    const fromStorage = key ? storedByKey.get(key) : undefined
    const trusted = key && key === serverKey ? serverMessage : fromStorage?.serverRecorded === true ? fromStorage : undefined
    const entry = JSON.stringify(trusted ?? message)
    const entryBytes = utf8.encode(entry).byteLength + (serialized.length ? 1 : 0)
    if (bytes + entryBytes > GUEST_DEBUG_TRANSCRIPT_MAX_BYTES) break
    serialized.push(entry)
    bytes += entryBytes
  }
  return { messages: `${prefixJson}${serialized.reverse().join(',')}${suffixJson}`, late }
}

function upsertGuestChatDebugEffect(input: GuestDebugWrite & { conversationId: string }): Effect.Effect<void, never> {
  if (!input.conversationId) return Effect.undefined

  const now = new Date().toISOString()
  return Effect.match(Effect.tryPromise({
    try: async () => {
      const db = requireD1()
      for (let attempt = 0; attempt < MAX_TRANSCRIPT_WRITE_ATTEMPTS; attempt++) {
        const previous = await db.prepare('SELECT messages, last_user_text FROM guest_chat_debug WHERE conversation_id = ?')
          .bind(input.conversationId).first<{ messages: string; last_user_text: string | null }>()
        const { messages, late } = mergeGuestDebugTranscript(previous?.messages ?? null, input.messages, input.assistant)
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
