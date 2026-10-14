/**
 * Chat API Route (bounded concierge MVP).
 *
 * Latest user request + bounded recent DATA + server-rehydrated state -> a
 * bounded Vercel AI SDK `ToolLoopAgent` with read-only tools -> a canonical
 * response, delivered through `createUIMessageStream` and a durable replay log:
 *   - `start` first
 *   - one stable transient `data-status` id `status:${requestId}`
 *   - transient server-assembled previews during successful reads and model text
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
import { checkRateLimit, RATE_LIMIT_REQUESTS, RATE_LIMIT_RETRY_SECONDS } from '#features/auth/api/rate-limit.server.ts'
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
import { beginChatDeliveryCommit, getChatDeliveryCheckpoint, saveChatDeliveryCheckpoint } from './delivery.server.ts'
import { EXECUTION_FENCE_HEADER, EXECUTION_STAGE_HEADER } from '../../../chat-delivery-worker/recovery.ts'
import { DELIVERY_OWNER_HEADER, DELIVERY_TURN_HEADER, parseDeliveryIdentity } from '#features/chat/lib/delivery-protocol.ts'
import { progressArtifactKey, progressText } from '#features/chat/lib/progress.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function getClientIP(event: RequestEvent): string {
  const forwardedClient = event.request.headers.get('x-chat-client-ip')
  if (forwardedClient) return forwardedClient
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

export const POST = async (event: RequestEvent, dependencies: { rateLimit?: typeof checkRateLimit } = {}): Promise<Response> => {
  const { request } = event
  const stage = request.headers.get(EXECUTION_STAGE_HEADER)

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
  let limit: Pick<Awaited<ReturnType<typeof checkRateLimit>>, 'success' | 'reset'>
  try {
    limit = stage === 'commit' || stage === 'fail' || Number(request.headers.get(EXECUTION_FENCE_HEADER)) > 1
      ? { success: true, reset: 0 } : await (dependencies.rateLimit ?? checkRateLimit)(ip)
  } catch {
    const response = createErrorStream(m.chat_error_generic({}, { locale }))
    response.headers.set('Retry-After', String(RATE_LIMIT_RETRY_SECONDS))
    return response
  }
  const { success, reset } = limit
  if (!success) {
    console.log(`[RATE LIMIT] IP ${ip} exceeded rate limit, reset at ${new Date(reset).toISOString()}`)
    return createRateLimitResponse(reset)
  }

  const userContext = await getUserToolContext(event)
  if (event.request.headers.get(DELIVERY_OWNER_HEADER) !== (userContext.userId ?? 'guest') ||
      event.request.headers.get(DELIVERY_TURN_HEADER) !== turnId) return new Response(null, { status: 403 })
  request.signal.throwIfAborted()
  const requestId = parseDeliveryIdentity(turnId, request.headers)!.attemptId
  if (stage === 'fail') {
    if (userContext.isAuthenticated && turnId) await Effect.runPromise(failChatTurnEffect(event, turnId, requestId))
    else await Effect.runPromise(recordGuestRequestTerminalEffect({ requestId, conversationId, status: 'errored', errorType: 'runtime_interruption', providerRequestId: null }))
    return new Response(null, { status: 204 })
  }
  const checkpoint = stage === 'commit' ? await getChatDeliveryCheckpoint(event) : null
  if (stage === 'commit' && !checkpoint) return createErrorStream('Chat response checkpoint unavailable')
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
    request.signal.throwIfAborted();
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
        const facts = await getEventFactsByIds([happeningSoonEventId], request.signal)
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
      const conversation = await Effect.runPromise(getConversationEffect(event, { id: conversationId }), { signal: request.signal })
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
    execute: ({ writer }) => {
      const execution = (async () => {
      let assistantMessageId: string | undefined
      let providerRequestId: string | null = null
      let lastProgressArtifacts: string | null = null

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
          writer.write({ type: 'start', messageId: assistantClientMessageId ?? replayAssistant.id })
          if (stage === 'generate') {
            await saveChatDeliveryCheckpoint(event, { canonical: replayAssistant.canonical, executionTrace: [] })
            return
          }
          await beginChatDeliveryCommit(event)
          writeStatus('persisting')
          writer.write({ type: 'text-start', id: `replay:${replayAssistant.id}` })
          writer.write({ type: 'text-delta', id: `replay:${replayAssistant.id}`, delta: replayAssistant.canonical.text })
          writer.write({ type: 'text-end', id: `replay:${replayAssistant.id}` })
          writer.write({ type: 'data-response', data: replayAssistant.canonical } as never)
          writeStatus('done')
          writer.write({ type: 'finish', finishReason: 'stop' })
          return
        }
        const messageId = assistantClientMessageId ?? generateId()
        assistantMessageId = messageId

        // `start` MUST precede any data/status chunk.
        writer.write({ type: 'start', messageId })
        writeStatus('thinking')

        if (!userContext.isAuthenticated && stage !== 'commit') {
          await Effect.runPromise(recordGuestRequestStartedEffect({ requestId, conversationId }))
        }

		const result = checkpoint ?? await Effect.runPromise(runSharedChatTurnEffect({
          requestId,
          sessionId: conversationId ?? undefined,
          channel: 'web',
          userContext,
          locale,
          text: originalQuery,
          priorHints,
          lastSearch,
          homeEventIds: historyLoadFailed ? [] : happeningSoonEventIds,
          pin,
          pinFacts,
          recentMessages,
          abortSignal: request.signal,
          onProgress: (response) => {
            const artifacts = progressArtifactKey(response)
            if (artifacts !== lastProgressArtifacts) {
              lastProgressArtifacts = artifacts
              writer.write({ type: 'data-progress', id: `progress:${requestId}`, transient: true, data: response } as never)
            } else {
              writer.write({ type: 'data-progress-text', id: `progress-text:${requestId}`, transient: true, data: progressText(response) } as never)
            }
          },
		}), { signal: request.signal })

        const canonical = result.canonical
        providerRequestId = result.providerRequestId ?? null
        if (stage === 'generate') {
          request.signal.throwIfAborted()
          await saveChatDeliveryCheckpoint(event, { canonical, executionTrace: result.executionTrace, providerRequestId: providerRequestId ?? undefined })
          return
        }

        // Server-side authoritative persistence for authenticated users.
        request.signal.throwIfAborted()
        await beginChatDeliveryCommit(event)
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
			// Runtime interruption and commit transport failures belong to workflow recovery.
			// Explicit Stop already owns cancellation in delivery and the public bridge.
			if (stage === 'commit' || request.signal.aborted) return
			let ownsFence = true
			if (stage) { try { await getChatDeliveryCheckpoint(event) } catch { ownsFence = false } }
			if (!ownsFence) return
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
      })()
      // Stop aborts model work; retain its bounded cleanup/trace flush after the stream closes.
      event.platform?.context?.waitUntil(execution)
      return execution
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
