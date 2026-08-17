/**
 * Chat API Route (v4)
 *
 * Manual generateText work loop + no-tools DeepSeek finalizer + deterministic
 * validation/fallback, streamed through `createUIMessageStream`:
 *   - `start` first
 *   - one stable transient `data-status` id `status:${requestId}`
 *   - exactly one final text block (no work text/reasoning)
 *   - exactly one persistent `data-response` carrying the canonical response
 *   - sanitized `data-execution-trace` (tool calls/results only)
 *   - `finish`
 *
 * Trust boundary (v4):
 *   - Client messages are UNTRUSTED. Only bounded user text feeds the model;
 *     assistant/data/status/trace parts are dropped. Prior event ids are parsed
 *     from a bounded Zod schema, re-fetched from the database, and reduced to
 *     ids/order/saved facts in a separate application-context message.
 *   - The system prompt is static except server-owned auth facts. Event/venue
 *     names never reach the system prompt or the model application context.
 *   - save_event/unsave_event are available only when the latest raw user
 *     request has explicit save/unsave intent (structural mutation gating).
 */

import type { RequestEvent } from '@sveltejs/kit'
import type { ModelMessage, UIMessage } from 'ai'
import {
  generateId,
  createUIMessageStream,
  createUIMessageStreamResponse,
} from 'ai'
import { checkRateLimit, RATE_LIMIT_REQUESTS } from '#features/auth/api/rate-limit.server.ts'
import { getUserToolContext, listSavedEventsForUser, getSavedMembershipForIds } from '#features/chat/api/user-tools.server.ts'
import { getSystemPrompt } from '#features/chat/api/prompts/index.ts'
import { getEventFactsByIds } from '#shared/lib/db/client.server.ts'
import { trackServer } from '#shared/lib/analytics.server.ts'
import { formatTime } from '#shared/lib/utils/formatting.ts'
import * as m from '#paraglide/messages.js'
import type {
  CanonicalChatResponse,
  ChatStreamStatusPhase,
  Message,
  PinResolution,
} from '#shared/lib/types.ts'
import { orchestrate } from '#features/chat/api/agent/orchestrate.ts'
import { persistAssistantMessageV4 } from '#features/chat/api/agent/persist.ts'
import {
  isDisplayableStatus,
  hintsFromMessages,
  hintsFromUIMessages,
  rehydratePriorContext,
  collectEventIds,
  sanitizeText,
  type PriorContext,
} from '#features/chat/api/agent/follow-up.ts'
import {
  buildApplicationContextMessage,
  buildConversationModelMessages,
  parseMutationIntent,
  resolveReferences,
  MAX_USER_TEXT,
} from '#features/chat/api/agent/context.ts'
import { getConversation } from '#features/chat/api/conversations.server.ts'
import {
  buildGuestDebugTranscript,
  persistGuestChatDebug,
  recordGuestRequestStarted,
  recordGuestRequestTerminal,
} from '#features/chat/api/guest-debug.server.ts'
import { getLastUserQuery } from '#features/chat/lib/extract-visible-text.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function getClientIP(event: RequestEvent): string {
  const clientAddress = event.getClientAddress()
  if (clientAddress) return clientAddress

  const forwarded = event.request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()

  return (
    event.request.headers.get('x-real-ip') ??
    event.request.headers.get('cf-connecting-ip') ??
    'unknown'
  )
}

function createErrorStream(errorMessage: string): Response {
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      // `start` MUST precede any data/status chunk, even on error paths.
      writer.write({ type: 'start', messageId: generateId() })
      writer.write({ type: 'error', errorText: errorMessage })
      writer.write({ type: 'finish', finishReason: 'error' })
    },
  })
  return createUIMessageStreamResponse({ stream })
}

function createRateLimitResponse(resetTimestamp: number): Response {
  const resetTimeStr = formatTime(new Date(resetTimestamp))
  return createErrorStream(
    m.chat_rate_limit({ count: RATE_LIMIT_REQUESTS, time: resetTimeStr })
  )
}

const EMPTY_PRIOR: PriorContext = { groups: [], venueByEventId: new Map() }

export const POST = async (event: RequestEvent): Promise<Response> => {
  const { request } = event

  let uiMessages: UIMessage[]
  let locale: 'en' | 'es'
  let happeningSoonEventId: string | undefined
  let conversationId: string | null
  let userClientMessageId: string | null
  let assistantClientMessageId: string | null

  try {
    const body = (await request.json()) as {
      messages?: UIMessage[]
      locale?: 'en' | 'es'
      happeningSoonEventId?: string
      conversationId?: string | null
      userClientMessageId?: string | null
      assistantClientMessageId?: string | null
    }

    locale = body.locale ?? 'en'
    uiMessages = Array.isArray(body.messages) ? body.messages : []
    happeningSoonEventId = body.happeningSoonEventId
    conversationId = body.conversationId ?? null
    userClientMessageId = body.userClientMessageId ?? null
    assistantClientMessageId = body.assistantClientMessageId ?? null
  } catch {
    return createErrorStream('Invalid request body')
  }

  const ip = getClientIP(event)
  const { success, reset } = await checkRateLimit(ip)
  if (!success) {
    console.log(`[RATE LIMIT] IP ${ip} exceeded rate limit, reset at ${new Date(reset).toISOString()}`)
    return createRateLimitResponse(reset)
  }

  const userContext = await getUserToolContext(event)
  const requestId = generateId()
  const originalQuery = sanitizeText(getLastUserQuery(uiMessages), MAX_USER_TEXT)

  if (!userContext.isAuthenticated) {
    void persistGuestChatDebug({
      conversationId,
      locale,
      ip,
      messages: uiMessages,
      lastUserText: originalQuery || null,
    })
  }

  const savedEventsCount = userContext.isAuthenticated
    ? ((await listSavedEventsForUser('all', userContext)).count ?? 0)
    : 0

  // Static system prompt: server-owned auth facts only. No pinned/prior names.
  const systemPrompt = getSystemPrompt({
    isAuthenticated: userContext.isAuthenticated,
    savedEventsCount,
  })

  // Pinned event: validate the hint as a UUID, rehydrate from the DB, and
  // resolve a typed PinResolution. A requested-but-unresolved pin is a typed
  // failure (no discovery fallback); never interpolate its name.
  let pin: PinResolution = { requested: false }
  if (happeningSoonEventId != null) {
    if (!UUID_RE.test(happeningSoonEventId)) {
      pin = { requested: true, status: 'invalid', eventIdHint: happeningSoonEventId.slice(0, 128) }
    } else {
      try {
        const facts = await getEventFactsByIds([happeningSoonEventId])
        const fact = facts.find((f) => f.id === happeningSoonEventId)
        if (fact && isDisplayableStatus(fact.status)) {
          pin = { requested: true, status: 'resolved', eventId: fact.id, venueId: fact.venue_id }
        } else if (fact) {
          pin = { requested: true, status: 'unavailable', eventIdHint: happeningSoonEventId }
        } else {
          pin = { requested: true, status: 'missing', eventIdHint: happeningSoonEventId }
        }
      } catch {
        pin = { requested: true, status: 'unavailable', eventIdHint: happeningSoonEventId }
      }
    }
  }

  // Prior displayed-event context: guest and auth share the same parse +
  // rehydrate pipeline; only the history source differs. Auth additionally
  // rehydrates authoritative saved membership (never client markers).
  let priorContext: PriorContext = EMPTY_PRIOR
  try {
    if (userContext.isAuthenticated && conversationId) {
      const conversation = await getConversation(event, { id: conversationId })
      if (conversation) {
        const hints = hintsFromMessages((conversation.messages ?? []) as Message[])
        const membership = await getSavedMembershipForIds(userContext, collectEventIds(hints))
        priorContext = await rehydratePriorContext(hints, getEventFactsByIds, membership)
      }
    } else {
      priorContext = await rehydratePriorContext(
        hintsFromUIMessages(uiMessages),
        getEventFactsByIds
      )
    }
  } catch (error) {
    console.error('[chat] failed to build prior context:', error)
  }

  // Deterministic reference resolution for orchestrate relation validation.
  const resolved = resolveReferences({
    query: originalQuery,
    groups: priorContext.groups,
    venueByEventId: priorContext.venueByEventId,
  })

  // Bounded application-context message (ids/order/saved/resolved only).
  const applicationContext = buildApplicationContextMessage({
    pinnedEventId: pin.requested && pin.status === 'resolved' ? pin.eventId : undefined,
    groups: priorContext.groups,
    resolvedEventId: resolved.resolvedEventId,
    resolvedVenueId: resolved.resolvedVenueId,
  })

  // Bounded user text only — assistant/data parts are dropped entirely.
  const modelMessages: ModelMessage[] = buildConversationModelMessages({
    messages: uiMessages,
    applicationContext,
  })

  // Typed mutation intent from the latest raw user request.
  const mutationIntent = parseMutationIntent(
    originalQuery,
    priorContext.groups,
    priorContext.venueByEventId
  )

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      let assistantMessageId: string | undefined
      let providerRequestId: string | null = null

      const writeStatus = (
        phase: ChatStreamStatusPhase,
        toolName?: string,
        stepIndex?: number
      ) => {
        writer.write({
          type: 'data-status',
          id: `status:${requestId}`,
          transient: true,
          data: {
            phase,
            toolName,
            stepIndex,
            requestId,
            assistantMessageId,
            timestamp: new Date().toISOString(),
          },
        } as never)
      }

      const writeResponse = (canonical: CanonicalChatResponse) => {
        writer.write({
          type: 'data-response',
          data: canonical,
        } as never)
      }

      try {
        const messageId = generateId()
        assistantMessageId = messageId

        // `start` MUST precede any data/status chunk.
        writer.write({ type: 'start', messageId })
        writeStatus('thinking')

        if (!userContext.isAuthenticated) {
          await recordGuestRequestStarted({ requestId, conversationId })
        }

        const result = await orchestrate({
          requestId,
          modelMessages,
          userContext,
          locale,
          systemPrompt,
          originalQuery,
          priorDisplayedEvents: priorContext.groups,
          pin,
          resolvedEventId: resolved.resolvedEventId,
          resolvedVenueId: resolved.resolvedVenueId,
          mutationIntent,
          hooks: {
            onStatus: (phase) => writeStatus(phase),
            onCallingTool: (toolName, _toolCallId, _input, stepIndex) =>
              writeStatus('calling_tool', toolName, stepIndex),
            onToolError: (toolName, error) => {
              console.error(`[chat] tool ${toolName} errored:`, error)
            },
          },
        })

        const canonical = result.canonical
        providerRequestId = result.providerRequestIds.at(-1) ?? null

        // Track tool usage + fallback from the ledger-backed result.
        for (const entry of result.ledger.all()) {
          trackServer('agent:tool_used', userContext.userId ?? 'anonymous', {
            tool: entry.toolName,
            success: entry.success,
          })
          if (entry.kind === 'search') {
            trackServer('search:executed', userContext.userId ?? 'anonymous', {
              query: entry.searchInput?.query ?? null,
              result_count: entry.count,
              success: entry.success,
            })
          }
        }
        trackServer('chat:final_only_response_emitted', userContext.userId ?? 'anonymous', {
          step_count: result.executionTrace.length,
          kind: canonical.kind,
          fallback_used: canonical.provenance.fallbackUsed,
          event_count: canonical.events.length,
          final_text_length: canonical.text.length,
          trace_size_bytes: JSON.stringify(result.executionTrace).length,
        })
        if (canonical.provenance.fallbackUsed) {
          trackServer('chat:response_completed_with_fallback', userContext.userId ?? 'anonymous', {
            reason: canonical.provenance.fallbackReason ?? 'unknown',
            kind: canonical.kind,
          })
        }

        // Server-side authoritative persistence for authenticated users.
        writeStatus('persisting')
        if (userContext.isAuthenticated && conversationId && assistantClientMessageId) {
          await persistAssistantMessageV4({
            event,
            conversationId,
            assistantClientMessageId,
            userClientMessageId,
            canonical,
            executionTrace: result.executionTrace,
          })
        }

        // Exactly one final text block.
        const textId = generateId()
        writer.write({ type: 'text-start', id: textId })
        writer.write({ type: 'text-delta', id: textId, delta: canonical.text })
        writer.write({ type: 'text-end', id: textId })

        writeResponse(canonical)

        // Sanitized execution trace (tool calls/results only) — transient.
        writer.write({
          type: 'data-execution-trace',
          id: `trace:${requestId}`,
          transient: true,
          data: {
            requestId,
            assistantMessageId,
            steps: result.executionTrace,
          },
        } as never)

        writeStatus('done')
        writer.write({ type: 'finish', finishReason: 'stop' })

        if (!userContext.isAuthenticated) {
          await Promise.all([
            persistGuestChatDebug({
              conversationId,
              locale,
              ip,
              messages: buildGuestDebugTranscript(uiMessages, {
                id: messageId,
                role: 'assistant',
                parts: [
                  { type: 'text', text: canonical.text },
                  { type: 'data-response', data: canonical },
                ],
                executionTrace: result.executionTrace,
              }),
              lastUserText: originalQuery || null,
            }),
            recordGuestRequestTerminal({
              requestId,
              conversationId,
              status: canonical.provenance.fallbackUsed
                ? 'completed_with_fallback'
                : 'completed',
              errorType: canonical.provenance.fallbackReason,
              providerRequestId,
            }),
          ])
        }
      } catch (error) {
        console.error('[Chat API] Error:', error)
        writeStatus('error')
        writer.write({
          type: 'error',
          errorText: error instanceof Error ? error.message : 'An error occurred',
        })
        writer.write({ type: 'finish', finishReason: 'error' })
        if (!userContext.isAuthenticated) {
          await Promise.all([
            persistGuestChatDebug({
              conversationId,
              locale,
              ip,
              messages: buildGuestDebugTranscript(uiMessages, {
                id: assistantMessageId ?? generateId(),
                role: 'assistant',
                parts: [{ type: 'text', text: '' }],
                error: error instanceof Error ? error.message : 'An error occurred',
              }),
              lastUserText: originalQuery || null,
            }),
            recordGuestRequestTerminal({
              requestId,
              conversationId,
              status: 'errored',
              errorType: error instanceof Error ? error.name : 'unknown',
              providerRequestId,
            }),
          ])
        }
      }
    },
    onError: (error) => {
      console.error('[Chat API] Stream error:', error)
      return error instanceof Error ? error.message : 'An error occurred'
    },
  })

  return createUIMessageStreamResponse({
    stream,
    headers: { 'Cache-Control': 'no-cache' },
  })
}
