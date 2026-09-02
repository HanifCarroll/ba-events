/**
 * Chat API Route (bounded concierge MVP).
 *
 * Latest user request + bounded recent DATA + server-rehydrated state -> a
 * bounded Vercel AI SDK `ToolLoopAgent` with read-only tools -> a canonical
 * response, streamed
 * through `createUIMessageStream`:
 *   - `start` first
 *   - one stable transient `data-status` id `status:${requestId}`
 *   - exactly one final text block containing the agent's grounded prose
 *   - exactly one persistent `data-response` carrying the canonical response
 *   - sanitized `data-execution-trace` (reads only)
 *   - `finish`
 *
 * Trust boundary:
 *   - Client messages are UNTRUSTED. Recent visible user/assistant text is
 *     bounded and labelled DATA. Prior event ids are parsed from a bounded Zod
 *     schema, re-fetched from the database, and reduced to server-owned handles
 *     + facts for the agent.
 *   - Prior and same-turn events use server-issued refs; raw IDs stay inside
 *     validated server tool artifacts and never come from model prose.
 *   - save/unsave are NEVER executed by the chat: the agent has no mutation
 *     tools; the card heart remains the mutation surface.
 */

import type { RequestEvent } from '@sveltejs/kit'
import { Effect } from 'effect'
import type { UIMessage } from 'ai'
import { generateId, createUIMessageStream, createUIMessageStreamResponse } from 'ai'
import { checkRateLimit, RATE_LIMIT_REQUESTS } from '#features/auth/api/rate-limit.server.ts'
import { getUserToolContext } from '#features/chat/api/user-tools.server.ts'
import { getEventFactsByIds } from '#shared/lib/db/client.server.ts'
import { formatTime } from '#shared/lib/utils/formatting.ts'
import * as m from '#paraglide/messages.js'
import type {
  CanonicalChatResponse,
  ChatStreamStatusPhase,
  Message,
  PinResolution,
} from '#shared/lib/types.ts'
import {
  normalizeChatTurn,
  runSharedChatTurnEffect,
} from '#features/chat/api/agent/shared-turn.server.ts'
import { persistAssistantMessageV4Effect } from '#features/chat/api/agent/persist.ts'
import {
  claimChatTurnEffect,
  completeChatTurnEffect,
  failChatTurnEffect,
  getTurnAssistantEffect,
  type ChatTurn,
} from '#features/chat/api/turns.server.ts'
import { applyAuthoritativeTurn, mayRunProvider } from '#features/chat/api/turn-authority.ts'
import {
  isDisplayableStatus,
  hintsFromMessages,
  hintsFromUIMessages,
  sanitizeText,
  type PriorResponseHint,
} from '#features/chat/api/agent/follow-up.ts'
import {
  lastSearchContextFromMessages,
  lastSearchContextFromUIMessages,
  type LastSearchContext,
} from '#features/chat/api/agent/search-context.ts'
import { getConversationEffect } from '#features/chat/api/conversations.server.ts'
import {
  buildGuestDebugTranscript,
  persistGuestChatDebugEffect,
  recordGuestRequestStartedEffect,
  recordGuestRequestTerminalEffect,
} from '#features/chat/api/guest-debug.server.ts'
import { getLastUserQuery } from '#features/chat/lib/extract-visible-text.ts'
import { buildAgentHistoryFromStoredMessages, buildAgentHistoryFromUIMessages } from '#features/chat/api/agent/history.ts'
import { parseMainChatRequest } from '#features/chat/api/main-request.ts'

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

function publicChatError(error: unknown): string {
	return error instanceof Error && error.message === 'Chat turn unavailable'
		? error.message
		: 'An error occurred while processing your message'
}

export const POST = async (event: RequestEvent): Promise<Response> => {
  const { request } = event

  let uiMessages: UIMessage[]
  let locale: 'en' | 'es'
  let happeningSoonEventId: string | undefined
  let happeningSoonEventIds: string[]
  let conversationId: string | null
  let userClientMessageId: string | null
  let assistantClientMessageId: string | null
  let turnId: string | null
  let retryTurn = false

  try {
    const body = parseMainChatRequest(await request.json())
    if (!body) return createErrorStream('Invalid request body')

    locale = body.locale === 'es' ? 'es' : 'en'
    uiMessages = Array.isArray(body.messages) ? body.messages : []
    happeningSoonEventId = body.happeningSoonEventId
    happeningSoonEventIds = Array.isArray(body.happeningSoonEventIds)
      ? body.happeningSoonEventIds.filter((id): id is string => typeof id === 'string')
      : []
    conversationId = body.conversationId ?? null
    userClientMessageId = body.userClientMessageId ?? null
    assistantClientMessageId = body.assistantClientMessageId ?? null
    turnId = body.turnId ?? null
    retryTurn = body.retry === true
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
  const requestId = crypto.randomUUID()
  let originalQuery: string
  let authoritativeTurn: ChatTurn | null = null
  let replayAssistant: {
    id: string
    canonical: CanonicalChatResponse
  } | null = null

  if (userContext.isAuthenticated && turnId) {
    if (!UUID_RE.test(turnId)) return createErrorStream('Invalid chat turn')
    try {
      authoritativeTurn = await Effect.runPromise(claimChatTurnEffect(event, turnId, requestId, retryTurn))
    } catch {
      return createErrorStream('Chat turn unavailable')
    }
    if (authoritativeTurn.status === 'completed') {
      replayAssistant = await Effect.runPromise(getTurnAssistantEffect(event, authoritativeTurn))
      if (!replayAssistant) return createErrorStream('Chat turn unavailable')
    } else if (!mayRunProvider(authoritativeTurn, requestId)) {
      return createErrorStream(
        authoritativeTurn.status === 'interrupted' || authoritativeTurn.status === 'failed'
          ? 'This turn needs an explicit retry.'
          : 'This turn is already running in another tab.'
      )
    }
    ({ conversationId, userClientMessageId, assistantClientMessageId, originalQuery, locale } =
      applyAuthoritativeTurn({
        conversationId,
        userClientMessageId,
        assistantClientMessageId,
        originalQuery: '',
        locale
      }, authoritativeTurn))
  } else {
    const normalizedTurn = normalizeChatTurn(getLastUserQuery(uiMessages), locale)
    originalQuery = normalizedTurn.originalQuery
    locale = normalizedTurn.locale
  }

  if (!userContext.isAuthenticated) {
    void Effect.runPromise(persistGuestChatDebugEffect({
      conversationId,
      locale,
      ip,
      messages: uiMessages,
      lastUserText: originalQuery || null,
    }))
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
  let priorHints: PriorResponseHint[] = []
  let lastSearch: LastSearchContext | null = null
  let historyLoadFailed = false
  let recentMessages: Array<{ role: 'user' | 'assistant'; content: string }> = []
  if (userContext.isAuthenticated && conversationId) {
    try {
      const conversation = await Effect.runPromise(getConversationEffect(event, { id: conversationId }))
      if (conversation) {
        const storedMessages = (conversation.messages ?? []) as Message[]
        priorHints = hintsFromMessages(storedMessages)
        lastSearch = lastSearchContextFromMessages(storedMessages)
        recentMessages = buildAgentHistoryFromStoredMessages(storedMessages, originalQuery)
		} else if (authoritativeTurn?.status === 'running' && turnId) {
			await Effect.runPromise(failChatTurnEffect(event, turnId, requestId)).catch(() => {})
			return createErrorStream('Chat turn unavailable')
      }
    } catch (error) {
      historyLoadFailed = true
      console.error('[chat] failed to load conversation context:', error)
		if (authoritativeTurn?.status === 'running' && turnId) {
			await Effect.runPromise(failChatTurnEffect(event, turnId, requestId)).catch(() => {})
			return createErrorStream('Chat turn unavailable')
      }
    }
  } else {
    priorHints = hintsFromUIMessages(uiMessages)
    lastSearch = lastSearchContextFromUIMessages(uiMessages)
    recentMessages = buildAgentHistoryFromUIMessages(uiMessages, originalQuery)
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
        const claimedTurn = authoritativeTurn

        if (replayAssistant) {
          writer.write({ type: 'start', messageId: replayAssistant.id })
          writeStatus('persisting')
          writer.write({ type: 'text-start', id: `replay:${replayAssistant.id}` })
          writer.write({ type: 'text-delta', id: `replay:${replayAssistant.id}`, delta: replayAssistant.canonical.text })
          writer.write({ type: 'text-end', id: `replay:${replayAssistant.id}` })
          writer.write({ type: 'data-response', data: replayAssistant.canonical } as never)
          writeStatus('done')
          writer.write({ type: 'finish', finishReason: 'stop' })
          return
        }
        const messageId = generateId()
        assistantMessageId = messageId

        // `start` MUST precede any data/status chunk.
        writer.write({ type: 'start', messageId })
        writeStatus('thinking')

        if (!userContext.isAuthenticated) {
          await Effect.runPromise(recordGuestRequestStartedEffect({ requestId, conversationId }))
        }

		const result = await Effect.runPromise(runSharedChatTurnEffect({
          requestId,
          userContext,
          locale,
          text: originalQuery,
          priorHints,
          lastSearch,
          homeEventIds: historyLoadFailed ? [] : happeningSoonEventIds,
          pin,
          pinFacts,
          recentMessages,
		}))

        const canonical = result.canonical
        providerRequestId = result.providerRequestId

        // Server-side authoritative persistence for authenticated users.
        writeStatus('persisting')
        if (userContext.isAuthenticated && turnId && claimedTurn && assistantClientMessageId) {
          await Effect.runPromise(completeChatTurnEffect(event, {
            turnId,
            claimId: requestId,
            assistantClientMessageId,
            content: canonical.text,
            attachedData: { canonical },
            executionTrace: result.executionTrace,
          }))
        } else if (userContext.isAuthenticated && conversationId && assistantClientMessageId) {
			await Effect.runPromise(persistAssistantMessageV4Effect({
				event,
            conversationId,
            assistantClientMessageId,
            userClientMessageId,
            canonical,
            executionTrace: result.executionTrace,
			}))
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
            Effect.runPromise(persistGuestChatDebugEffect({
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
            })),
            Effect.runPromise(recordGuestRequestTerminalEffect({
              requestId,
              conversationId,
              status: canonical.provenance.fallbackUsed
                ? 'completed_with_fallback'
                : 'completed',
              errorType: canonical.provenance.fallbackReason,
              providerRequestId,
            })),
          ])
        }
		} catch (error) {
			console.error('[Chat API] Error:', error)
			if (userContext.isAuthenticated && turnId && authoritativeTurn?.status === 'running') {
				await Effect.runPromise(failChatTurnEffect(event, turnId, requestId)).catch((failError) => {
					console.error('[Chat API] Failed to mark turn failed:', failError)
				})
			}
			writeStatus('error')
			writer.write({
				type: 'error',
				errorText: publicChatError(error),
        })
        writer.write({ type: 'finish', finishReason: 'error' })
        if (!userContext.isAuthenticated) {
          await Promise.all([
            Effect.runPromise(persistGuestChatDebugEffect({
              conversationId,
              locale,
              ip,
              messages: buildGuestDebugTranscript(uiMessages, {
                id: assistantMessageId ?? generateId(),
                role: 'assistant',
                parts: [{ type: 'text', text: '' }],
					error: publicChatError(error),
              }),
              lastUserText: originalQuery || null,
            })),
            Effect.runPromise(recordGuestRequestTerminalEffect({
              requestId,
              conversationId,
              status: 'errored',
              errorType: error instanceof Error ? error.name : 'unknown',
              providerRequestId,
            })),
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
