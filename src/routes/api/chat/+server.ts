/**
 * Chat API Route (v3)
 *
 * Manual generateText work loop + no-tools DeepSeek finalizer + deterministic
 * validation/fallback, streamed through `createUIMessageStream`:
 *   - `start` first
 *   - one stable transient `data-status` id `status:${requestId}`
 *   - exactly one final text block (no work text/reasoning)
 *   - exactly one persistent `data-response` carrying the canonical response
 *   - sanitized `data-execution-trace` (tool calls/results only)
 *   - `finish`
 */

import type { RequestEvent } from '@sveltejs/kit'
import {
  convertToModelMessages,
  generateId,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
} from 'ai'
import { checkRateLimit, RATE_LIMIT_REQUESTS } from '#features/auth/api/rate-limit.server.ts'
import { getUserToolContext, listSavedEventsForUser } from '#features/chat/api/user-tools.server.ts'
import { getSystemPrompt } from '#features/chat/api/prompts/index.ts'
import { getEventWithVenue } from '#shared/lib/db/client.server.ts'
import { trackServer } from '#shared/lib/analytics.server.ts'
import { formatTime } from '#shared/lib/utils/formatting.ts'
import * as m from '#paraglide/messages.js'
import type {
  CanonicalChatResponse,
  ChatStreamStatusPhase,
  Message,
} from '#shared/lib/types.ts'
import {
  orchestrate,
} from '#features/chat/api/agent/orchestrate.ts'
import { persistAssistantMessageV3 } from '#features/chat/api/agent/persist.ts'
import {
  priorEventsFromCanonical,
  priorEventsFromUIMessages,
  formatPriorEvents,
} from '#features/chat/api/agent/follow-up.ts'
import { adaptLegacyToCanonical } from '#features/chat/lib/canonical.ts'
import { getConversation } from '#features/chat/api/conversations.server.ts'
import {
  buildGuestDebugTranscript,
  persistGuestChatDebug,
  recordGuestRequestStarted,
  recordGuestRequestTerminal,
} from '#features/chat/api/guest-debug.server.ts'
import { getLastUserQuery } from '#features/chat/lib/extract-visible-text.ts'

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

function canonicalsFromMessages(messages: Message[]): CanonicalChatResponse[] {
  return messages
    .filter((msg) => msg.role === 'assistant')
    .map((msg) => msg.attached_data?.canonical ?? adaptLegacyToCanonical(msg))
}

export const POST = async (event: RequestEvent): Promise<Response> => {
  const { request } = event

  let uiMessages: UIMessage[]
  let modelMessages: Awaited<ReturnType<typeof convertToModelMessages>>
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
    modelMessages = await convertToModelMessages(uiMessages)
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
  const originalQuery = getLastUserQuery(uiMessages)

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

  let systemPrompt = getSystemPrompt({
    isAuthenticated: userContext.isAuthenticated,
    savedEventsCount,
  })

  let pinnedEventName: string | undefined
  if (happeningSoonEventId) {
    try {
      const pinnedEvent = await getEventWithVenue(happeningSoonEventId)
      if (pinnedEvent) {
        pinnedEventName = pinnedEvent.name
        systemPrompt =
          `${systemPrompt}\n\n` +
          `The user just tapped a specific event from the home screen: "${pinnedEvent.name}" ` +
          `(id: ${pinnedEvent.id}). Answer about THIS exact event. ` +
          `Call get_event_details with the exact id "${pinnedEvent.id}" and present that event. ` +
          `Do not run a broad search or recommend a different set of events.`
      }
    } catch {
      // Event missing or unreadable — fall back to the normal flow.
    }
  }

  // Trusted prior displayed-event context. Authenticated conversations load
  // their canonical responses server-side; guests contribute their retained
  // canonical data-response parts (ids remain untrusted downstream).
  let priorDisplayedEvents: ReturnType<typeof priorEventsFromCanonical> = []
  if (userContext.isAuthenticated && conversationId) {
    try {
      const conversation = await getConversation(event, { id: conversationId })
      if (conversation) {
        priorDisplayedEvents = priorEventsFromCanonical(
          canonicalsFromMessages((conversation.messages ?? []) as Message[])
        )
      }
    } catch (error) {
      console.error('[chat] failed to load prior conversation:', error)
    }
  } else {
    priorDisplayedEvents = priorEventsFromUIMessages(uiMessages)
  }

  // Inject trusted prior displayed events (ids + order + saved state) so the
  // work loop can resolve "save the second one", "tell me more", "other one",
  // "closest", and directions without hidden client context.
  if (priorDisplayedEvents.length > 0) {
    systemPrompt =
      `${systemPrompt}\n\n## Recently shown events (trusted)\n` +
      `Each entry is an event you already displayed in this conversation, in display order: ` +
      `"<id>: <name>" (saved when marked). Resolve follow-ups against these ids — e.g. ` +
      `"save the second one" means the second event below, "tell me more" means the event just discussed.\n` +
      formatPriorEvents(priorDisplayedEvents)
  }

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
          priorDisplayedEvents,
          pinnedEventId: happeningSoonEventId,
          pinnedEventName,
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
          await persistAssistantMessageV3({
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
