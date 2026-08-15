/**
 * Chat API Route
 *
 * Handles AI chat requests using Vercel AI SDK with streaming.
 * Supports tool calling for event search and user actions.
 */

import type { RequestEvent } from '@sveltejs/kit'
import {
  convertToModelMessages,
  generateId,
  streamText,
  stepCountIs,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
} from 'ai'
import { checkRateLimit, RATE_LIMIT_REQUESTS } from '#features/auth/api/rate-limit.server.ts'
import { getUserToolContext, listSavedEventsForUser } from '#features/chat/api/user-tools.server.ts'
import { createTools } from '#features/chat/api/tools-ai-sdk.ts'
import { getSystemPrompt } from '#features/chat/api/prompts/index.ts'
import { generateSuggestions } from '#features/chat/api/suggestions.ts'
import { guardForOffTopic } from '#features/chat/api/topic-guard.ts'
import { guardCoverageClaims, type CoverageInfo } from '#features/chat/api/tools/coverage-guard.ts'
import {
  MAX_STEPS,
  buildExecutionTrace,
  getLastUserQuery,
  getFinalVisibleTextFromSteps,
  getNonEmptyStepTextCount,
  sanitizeFinalAssistantText,
  stripLeakedReasoning,
  filterEventsMentionedInText,
  buildStreamEnvelope,
  inferToolResultSuccess,
  type StepResultLike,
} from '#features/chat/api/stream-helpers.ts'
import { CHAT_THINKING, textModel } from '#shared/lib/ai/providers.ts'
import { getEventWithVenue } from '#shared/lib/db/client.server.ts'
import { trackServer } from '#shared/lib/analytics.server.ts'
import { formatTime } from '#shared/lib/utils/formatting.ts'
import * as m from '#paraglide/messages.js'
import type {
  ChatEventPayload,
  DirectionsData,
  ChatStreamStatusData,
} from '#shared/lib/types.ts'
import type { SearchEventsInput } from '#features/chat/api/tools/search-events.ts'
import {
  buildGuestDebugTranscript,
  persistGuestChatDebug,
} from '#features/chat/api/guest-debug.server.ts'

/**
 * Get client IP for rate limiting.
 *
 * SvelteKit's `getClientAddress()` (set by the adapter, trusted when it is
 * configured to honor proxy headers) is the primary source. The legacy
 * header-parsing chain is preserved as a fallback, in its original order:
 * x-forwarded-for → x-real-ip → cf-connecting-ip → 'unknown'.
 */
function getClientIP(event: RequestEvent): string {
  const clientAddress = event.getClientAddress()
  if (clientAddress) return clientAddress

  const forwarded = event.request.headers.get('x-forwarded-for')
  if (forwarded) {
    return forwarded.split(',')[0].trim()
  }
  return (
    event.request.headers.get('x-real-ip') ??
    event.request.headers.get('cf-connecting-ip') ??
    'unknown'
  )
}

/**
 * Create a streaming error response (client expects streaming, not JSON)
 */
function createErrorStream(errorMessage: string): Response {
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      writer.write({
        type: 'error',
        errorText: errorMessage,
      })
      writer.write({
        type: 'finish',
        finishReason: 'error',
      })
    },
  })
  return createUIMessageStreamResponse({ stream })
}

/**
 * Create rate limit error response (as streaming)
 */
function createRateLimitResponse(resetTimestamp: number): Response {
  const resetDate = new Date(resetTimestamp)
  const resetTimeStr = formatTime(resetDate)

  return createErrorStream(
    m.chat_rate_limit({ count: RATE_LIMIT_REQUESTS, time: resetTimeStr })
  )
}

export const POST = async (event: RequestEvent): Promise<Response> => {
  const { request } = event

  // Parse request body
  let uiMessages: UIMessage[]
  let modelMessages: Awaited<ReturnType<typeof convertToModelMessages>>
  let locale: 'en' | 'es'
  let happeningSoonEventId: string | undefined
  let conversationId: string | null

  try {
    const body = (await request.json()) as {
      messages?: UIMessage[]
      locale?: 'en' | 'es'
      happeningSoonEventId?: string
      conversationId?: string | null
    }

    locale = body.locale ?? 'en'
    uiMessages = Array.isArray(body.messages) ? body.messages : []
    happeningSoonEventId = body.happeningSoonEventId
    conversationId = body.conversationId ?? null
    modelMessages = await convertToModelMessages(uiMessages)
  } catch {
    return createErrorStream('Invalid request body')
  }

  // Rate limiting
  const ip = getClientIP(event)
  const { success, reset } = await checkRateLimit(ip)
  if (!success) {
    console.log(`[RATE LIMIT] IP ${ip} exceeded rate limit, reset at ${new Date(reset).toISOString()}`)
    return createRateLimitResponse(reset)
  }

  // Get user context for authenticated actions
  const userContext = await getUserToolContext(event)
  console.log(`[DEBUG] User context: authenticated=${userContext.isAuthenticated}, userId=${userContext.userId?.slice(0, 8) ?? 'none'}`)

  // Server-side debug copy for GUEST chats only. Authenticated chats already
  // have a server record in `conversations` and are deliberately skipped.
  // Written at request start (user turn) and again after the reply exists.
  // Fire-and-forget so the write can never delay the stream.
  if (!userContext.isAuthenticated) {
    persistGuestChatDebug({
      conversationId,
      locale,
      ip,
      messages: uiMessages,
      lastUserText: getLastUserQuery(uiMessages) || null,
    })
  }

  // Inject auth state into the system prompt (replaces the old
  // get_user_context tool - static info, not worth a model step)
  const savedEventsCount = userContext.isAuthenticated
    ? ((await listSavedEventsForUser('all', userContext)).count ?? 0)
    : 0
  let systemPrompt = getSystemPrompt({
    isAuthenticated: userContext.isAuthenticated,
    savedEventsCount,
  })

  // Pin a home-screen happening-soon event tap to that exact event. The id
  // is carried in the request body (never in the visible message text), so
  // the chat UI and persisted history stay clean.
  if (happeningSoonEventId) {
    try {
      const pinnedEvent = await getEventWithVenue(happeningSoonEventId)
      if (pinnedEvent) {
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

  // Accumulate events across all tool calls
  const allEvents = new Map<string, ChatEventPayload>()
  let lastSearchInput: SearchEventsInput | null = null
  let lastSearchCoverage: CoverageInfo | null = null
  let lastOriginalQuery = ''
  let directionsData: DirectionsData | null = null

  // Get the last user message for suggestions
  lastOriginalQuery = getLastUserQuery(uiMessages)

  // Create the stream with custom data support
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      let wroteStart = false
      const requestId = generateId()
      let assistantMessageId: string | undefined
      let stepIndex = -1

      const writeStatus = (
        phase: ChatStreamStatusData['phase'],
        options?: Pick<
          ChatStreamStatusData,
          'toolName' | 'stepIndex' | 'assistantMessageId'
        >
      ) => {
        writer.write({
          type: 'data-status' as const,
          data: {
            phase,
            toolName: options?.toolName,
            stepIndex: options?.stepIndex,
            requestId,
            assistantMessageId: options?.assistantMessageId,
            timestamp: new Date().toISOString(),
          },
        })
      }

      try {
        writeStatus('thinking')

        const messageId = generateId()
        assistantMessageId = messageId
        writer.write({ type: 'start', messageId })
        wroteStart = true

        let streamedReasoning = ''
        let textBlockId: string | undefined
        let streamedAnswer = ''

        const result = streamText({
          model: textModel,
          system: systemPrompt,
          messages: modelMessages,
          tools: createTools(userContext, locale),
          ...CHAT_THINKING,
          stopWhen: stepCountIs(MAX_STEPS),
          onChunk: ({ chunk }) => {
            if (chunk.type === 'reasoning-delta' && chunk.text) {
              streamedReasoning += chunk.text
              return
            }
            if (chunk.type !== 'text-delta' || !chunk.text) return
            if (!textBlockId) {
              textBlockId = generateId()
              writeStatus('composing', { assistantMessageId })
              writer.write({ type: 'text-start', id: textBlockId })
            }
            streamedAnswer += chunk.text
            writer.write({
              type: 'text-delta',
              id: textBlockId,
              delta: chunk.text,
            })
          },
          onStepFinish: ({ toolCalls, toolResults }) => {
            stepIndex += 1

            // Accumulate events from each step
            for (const result of toolResults) {
              const toolOutput = result.output as {
                events?: ChatEventPayload[]
                metadata?: {
                  toolInput?: SearchEventsInput
                  coverage?: CoverageInfo
                }
                // For get_directions tool
                success?: boolean
                venueName?: string
                address?: string
                mapsUrl?: string
                eventName?: string
              } | undefined

              if (toolOutput?.events) {
                for (const event of toolOutput.events) {
                  allEvents.set(event.id, event)
                }
              }
              // Track last search input for suggestions
              if (result.toolName === 'search_events' && toolOutput?.metadata?.toolInput) {
                lastSearchInput = toolOutput.metadata.toolInput
              }
              if (result.toolName === 'search_events' && toolOutput?.metadata?.coverage) {
                lastSearchCoverage = toolOutput.metadata.coverage
              }
              // Capture directions data
              if (result.toolName === 'get_directions' && toolOutput?.success && toolOutput?.mapsUrl) {
                directionsData = {
                  venueName: toolOutput.venueName!,
                  address: toolOutput.address!,
                  mapsUrl: toolOutput.mapsUrl,
                  eventName: toolOutput.eventName,
                }
              }
            }

            // Track tool usage with the REAL outcome (the previous
            // hardcoded `success: true` reported failed searches as
            // successful). Search calls additionally emit a dedicated
            // search:executed event with retrieval metadata.
            for (const call of toolCalls) {
              writeStatus('calling_tool', {
                toolName: call.toolName,
                stepIndex,
              })
              const matchingResult = toolResults.find(
                (result) => result.toolCallId === call.toolCallId
              )
              const toolSucceeded = matchingResult
                ? inferToolResultSuccess(matchingResult.output)
                : false
              trackServer('agent:tool_used', userContext.userId ?? 'anonymous', {
                tool: call.toolName,
                success: toolSucceeded,
              })

              if (call.toolName === 'search_events') {
                const searchOutput = matchingResult?.output as {
                  success?: boolean
                  metadata?: {
                    resultCount?: number
                    hasQuery?: boolean
                    hasFilters?: boolean
                    searchMode?: 'semantic' | 'filter_only' | 'now'
                    durationMs?: number
                    coverage?: {
                      totalMatches?: number
                      returned?: number
                      searchedFrom?: string | null
                      searchedTo?: string | null
                      maxEventDate?: string | null
                    }
                    toolInput?: SearchEventsInput
                  }
                } | null
                trackServer('search:executed', userContext.userId ?? 'anonymous', {
                  query: searchOutput?.metadata?.toolInput?.query ?? null,
                  has_query: searchOutput?.metadata?.hasQuery ?? false,
                  has_filters: searchOutput?.metadata?.hasFilters ?? false,
                  search_mode: searchOutput?.metadata?.searchMode ?? null,
                  result_count: searchOutput?.metadata?.resultCount ?? 0,
                  total_matches: searchOutput?.metadata?.coverage?.totalMatches ?? 0,
                  returned: searchOutput?.metadata?.coverage?.returned ?? 0,
                  time_filter: searchOutput?.metadata?.toolInput?.timeFilter ?? null,
                  limit: searchOutput?.metadata?.toolInput?.limit ?? null,
                  success: searchOutput
                    ? inferToolResultSuccess(searchOutput)
                    : false,
                  duration_ms: searchOutput?.metadata?.durationMs ?? null,
                })
              }
            }
          },
        })

        const [steps, generatedText] = await Promise.all([result.steps, result.text])
        const typedSteps = steps as StepResultLike[]
        const executionTrace = buildExecutionTrace(typedSteps)
        if (streamedReasoning && executionTrace[0] && !executionTrace[0].reasoning) {
          executionTrace[0].reasoning = streamedReasoning
        }

        const rawFinalText = getFinalVisibleTextFromSteps(typedSteps, generatedText)
        const nonEmptyStepTextCount = getNonEmptyStepTextCount(typedSteps)
        const accumulatedEvents = Array.from(allEvents.values())
        let finalText = stripLeakedReasoning(
          sanitizeFinalAssistantText(rawFinalText, {
            hasStructuredData: accumulatedEvents.length > 0 || directionsData !== null,
          }),
          streamedReasoning
        )

        const isDiscoveryList = (lastSearchInput?.limit ?? 1) > 1
        let events = filterEventsMentionedInText(accumulatedEvents, finalText, {
          preserveAll: isDiscoveryList,
        })

        if (finalText && !happeningSoonEventId) {
          const guarded = await guardForOffTopic(finalText, locale, {
            query: lastOriginalQuery,
            eventNames: events.map((e) => e.name),
          })
          if (guarded) {
            finalText = guarded
            events = []
          }
        }

        if (finalText && lastSearchCoverage) {
          finalText = guardCoverageClaims(finalText, locale, lastSearchCoverage)
        }

        if (nonEmptyStepTextCount > 1) {
          trackServer('chat:response_contract_violation', userContext.userId ?? 'anonymous', {
            reason: 'multiple_non_empty_step_text',
            non_empty_step_text_count: nonEmptyStepTextCount,
          })
        }

        const totalToolCalls = typedSteps.reduce(
          (count, step) => count + (step.toolCalls?.length ?? 0),
          0
        )
        const totalToolResults = typedSteps.reduce(
          (count, step) => count + (step.toolResults?.length ?? 0),
          0
        )
        const finalStepIndex =
          typedSteps.length > 0 ? typedSteps.length - 1 : undefined

        trackServer('chat:final_only_response_emitted', userContext.userId ?? 'anonymous', {
          step_count: typedSteps.length,
          tool_call_count: totalToolCalls,
          tool_result_count: totalToolResults,
          final_text_length: finalText.length,
          trace_size_bytes: JSON.stringify(executionTrace).length,
        })

        if (!textBlockId) {
          textBlockId = generateId()
          writeStatus('composing', {
            stepIndex: finalStepIndex,
            assistantMessageId,
          })
          writer.write({ type: 'text-start', id: textBlockId })
        }

        if (finalText && finalText !== streamedAnswer) {
          writer.write({ type: 'text-end', id: textBlockId })
          textBlockId = generateId()
          writer.write({ type: 'text-start', id: textBlockId })
          writer.write({
            type: 'text-delta',
            id: textBlockId,
            delta: finalText,
          })
        }
        writer.write({ type: 'text-end', id: textBlockId })

        // Send accumulated events as custom data
        if (events.length > 0) {
          writer.write({
            type: 'data-events' as const,
            data: buildStreamEnvelope(requestId, events, assistantMessageId),
          })
          console.log(`[DEBUG] Sending ${events.length} accumulated events`)
        }

        // Generate and send suggestions
        if (lastSearchInput) {
          const suggestions = generateSuggestions({
            originalQuery: lastOriginalQuery,
            toolInput: lastSearchInput,
            results: events,
            locale,
          })
          if (suggestions.length > 0) {
            writer.write({
              type: 'data-suggestions' as const,
              data: buildStreamEnvelope(requestId, suggestions, assistantMessageId),
            })
            console.log(`[DEBUG] Generated ${suggestions.length} suggestions`)
          }
        }

        // Send directions data if available
        if (directionsData) {
          writer.write({
            type: 'data-directions' as const,
            data: buildStreamEnvelope(requestId, directionsData, assistantMessageId),
          })
          console.log(`[DEBUG] Sending directions for "${directionsData.venueName}"`)
        }

        // Send execution trace for persistence/debugging (not rendered in bubble text).
        writer.write({
          type: 'data-execution-trace' as const,
          data: buildStreamEnvelope(requestId, executionTrace, assistantMessageId),
        })

        writeStatus('done', {
          stepIndex: finalStepIndex,
          assistantMessageId,
        })

        writer.write({
          type: 'finish',
          finishReason: 'stop',
        })
        if (!userContext.isAuthenticated) {
          persistGuestChatDebug({
            conversationId,
            locale,
            ip,
            messages: buildGuestDebugTranscript(uiMessages, {
              id: messageId,
              role: 'assistant',
              parts: [{ type: 'text', text: finalText }],
              executionTrace,
            }),
            lastUserText: lastOriginalQuery || null,
          })
        }
      } catch (error) {
        console.error('[Chat API] Error:', error)
        writeStatus('error', {
          stepIndex: stepIndex >= 0 ? stepIndex : undefined,
          assistantMessageId,
        })
        writer.write({
          type: 'error',
          errorText: error instanceof Error ? error.message : 'An error occurred',
        })
        if (wroteStart) {
          writer.write({
            type: 'finish',
            finishReason: 'error',
          })
        }
        if (!userContext.isAuthenticated) {
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
            lastUserText: lastOriginalQuery || null,
          })
        }
      }
    },
    onError: (error) => {
      console.error('[Chat API] Stream error:', error)
      return error instanceof Error ? error.message : 'An error occurred'
    },
  })

  // Return the stream as a response
  return createUIMessageStreamResponse({
    stream,
    headers: {
      'Cache-Control': 'no-cache',
    },
  })
}
