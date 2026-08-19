/**
 * Chat API Route (bounded concierge MVP).
 *
 * Latest user request + bounded server-rehydrated state -> ONE planner
 * `generateText` call (`Output.object`, closed `TurnPlan`, NO tools) -> one
 * deterministic executor -> a server-built `CanonicalChatResponse`, streamed
 * through `createUIMessageStream`:
 *   - `start` first
 *   - one stable transient `data-status` id `status:${requestId}`
 *   - exactly one final text block (deterministic server text — the model never
 *     writes visible prose)
 *   - exactly one persistent `data-response` carrying the canonical response
 *   - sanitized `data-execution-trace` (reads only)
 *   - `finish`
 *
 * Trust boundary:
 *   - Client messages are UNTRUSTED. Only bounded user text feeds the planner;
 *     assistant/data/status/trace parts are dropped. Prior event ids are parsed
 *     from a bounded Zod schema, re-fetched from the database, and reduced to
 *     server-owned handles + facts (name/venue/saved) in the planner prompt.
 *   - The planner never sees or returns a raw event UUID: prior events are
 *     addressed by server-owned handles (`requestId:event_N`).
 *   - save/unsave are NEVER executed by the chat: the planner maps them to
 *     show_for_save / show_for_unsave, which return the card + a deterministic
 *     pointer to the card's heart control.
 */

import type { RequestEvent } from '@sveltejs/kit'
import type { UIMessage } from 'ai'
import { generateId, createUIMessageStream, createUIMessageStreamResponse } from 'ai'
import { checkRateLimit, RATE_LIMIT_REQUESTS } from '#features/auth/api/rate-limit.server.ts'
import { getUserToolContext, getSavedMembershipForIds } from '#features/chat/api/user-tools.server.ts'
import { getEventFactsByIds } from '#shared/lib/db/client.server.ts'
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
import { detectResponseLanguage, MAX_USER_TEXT } from '#features/chat/api/agent/context.ts'
import {
  currentDateInBuenosAires,
  lastSearchContextFromMessages,
  lastSearchContextFromUIMessages,
  type LastSearchContext,
} from '#features/chat/api/agent/search-context.ts'
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

    locale = body.locale === 'es' ? 'es' : 'en'
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
  const currentDateInBA = currentDateInBuenosAires()

  // Response language follows the latest user message; the UI locale is only a
  // fallback when the message is empty or language-neutral.
  locale = detectResponseLanguage(originalQuery, locale)

  if (!userContext.isAuthenticated) {
    void persistGuestChatDebug({
      conversationId,
      locale,
      ip,
      messages: uiMessages,
      lastUserText: originalQuery || null,
    })
  }

  // Pinned event: validate the hint as a UUID, rehydrate from the DB, and
  // resolve a typed PinResolution. A requested-but-unresolved pin is a typed
  // failure (no discovery fallback); never interpolate its name.
  let pin: PinResolution = { requested: false }
  let pinFacts: { name: string; venueName: string | null } | null = null
  if (happeningSoonEventId != null) {
    if (!UUID_RE.test(happeningSoonEventId)) {
      pin = { requested: true, status: 'invalid', eventIdHint: happeningSoonEventId.slice(0, 128) }
    } else {
      try {
        const facts = await getEventFactsByIds([happeningSoonEventId])
        const fact = facts.find((f) => f.id === happeningSoonEventId)
        if (fact && isDisplayableStatus(fact.status)) {
          pin = { requested: true, status: 'resolved', eventId: fact.id, venueId: fact.venue_id }
          pinFacts = {
            name: sanitizeText(fact.name),
            venueName: fact.venue_name ? sanitizeText(fact.venue_name) : null,
          }
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

  // Prior displayed-event context and previous-search context: guest and auth
  // share bounded validation, while authenticated history is read from the
  // server-owned persisted conversation instead of client-supplied canonicals.
  let priorContext: PriorContext = EMPTY_PRIOR
  let lastSearch: LastSearchContext | null = null
  try {
    if (userContext.isAuthenticated && conversationId) {
      const conversation = await getConversation(event, { id: conversationId })
      if (conversation) {
        const storedMessages = (conversation.messages ?? []) as Message[]
        const hints = hintsFromMessages(storedMessages)
        const membership = await getSavedMembershipForIds(userContext, collectEventIds(hints))
        priorContext = await rehydratePriorContext(hints, getEventFactsByIds, membership)
        lastSearch = lastSearchContextFromMessages(storedMessages)
      }
    } else {
      priorContext = await rehydratePriorContext(
        hintsFromUIMessages(uiMessages),
        getEventFactsByIds
      )
      lastSearch = lastSearchContextFromUIMessages(uiMessages)
    }
  } catch (error) {
    console.error('[chat] failed to build prior context:', error)
  }

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      let assistantMessageId: string | undefined
      let providerRequestId: string | null = null

      const writeStatus = (phase: ChatStreamStatusPhase) => {
        writer.write({
          type: 'data-status',
          id: `status:${requestId}`,
          transient: true,
          data: {
            phase,
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
          userContext,
          locale,
          originalQuery,
          priorDisplayedEvents: priorContext.groups,
          venueByEventId: priorContext.venueByEventId,
          lastSearch,
          currentDateInBA,
          pin,
          pinFacts,
        })

        const canonical = result.canonical
        providerRequestId = result.providerRequestId

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

        // Sanitized execution trace (reads only) — transient.
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
