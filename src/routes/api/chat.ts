/**
 * Chat API Route
 *
 * Handles AI chat requests using Vercel AI SDK with streaming.
 * Supports tool calling for event search and user actions.
 */

import { createFileRoute } from '@tanstack/react-router'
import {
  convertToModelMessages,
  generateId,
  streamText,
  stepCountIs,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
} from 'ai'
import { checkRateLimit, RATE_LIMIT_REQUESTS } from '@/features/auth/api/rate-limit'
import { getUserToolContext, listSavedEventsForUser } from '@/features/chat/api/user-tools'
import { createTools } from '@/features/chat/api/tools-ai-sdk'
import { getSystemPrompt } from '@/features/chat/api/prompts'
import { generateSuggestions } from '@/features/chat/api/suggestions'
import { guardForOffTopic } from '@/features/chat/api/topic-guard'
import { guardCoverageClaims, type CoverageInfo } from '@/features/chat/api/tools/coverage-guard'
import {
  extractVisibleTextFromStepTexts,
  extractVisibleTextFromUIMessageParts,
} from '@/features/chat/lib/extract-visible-text'
import { NO_THINKING, textModel } from '@/shared/lib/ai/providers'
import { getEventWithVenue } from '@/shared/lib/db/client'
import { trackServer } from '@/lib/analytics.server'
import { BA_TIMEZONE } from '@/shared/lib/constants'
import type {
  ChatEventPayload,
  DirectionsData,
  ChatStreamStatusData,
  ChatStreamDataEnvelope,
  Json,
  MessageExecutionStep,
} from '@/shared/lib/types'
import type { SearchEventsInput } from '@/features/chat/api/tools/search-events'

// Agent loop configuration (reduced from 5 for faster responses)
const MAX_STEPS = 3

export type StepResultLike = {
  stepType?: string
  text?: string
  finishReason?: string
  toolCalls?: Array<{
    toolCallId?: string
    toolName?: string
    input?: unknown
  }>
  toolResults?: Array<{
    toolCallId?: string
    toolName?: string
    input?: unknown
    output?: unknown
  }>
}

function toJsonSafe(value: unknown): Json | null {
  if (value === undefined) return null

  try {
    return JSON.parse(
      JSON.stringify(value, (key, inner) => {
        if (key === 'embedding') return undefined
        if (typeof inner === 'bigint') return Number(inner)
        return inner
      })
    ) as Json
  } catch {
    return null
  }
}

function inferToolResultSuccess(output: unknown): boolean {
  if (output && typeof output === 'object' && 'success' in output) {
    const success = (output as { success?: unknown }).success
    if (typeof success === 'boolean') return success
  }
  return true
}

function normalizeStepType(stepType: unknown): MessageExecutionStep['stepType'] {
  if (stepType === 'initial' || stepType === 'continue' || stepType === 'tool-result') {
    return stepType
  }
  return 'unknown'
}

export function buildExecutionTrace(steps: StepResultLike[]): MessageExecutionStep[] {
  return steps.map((step, index) => ({
    stepIndex: index,
    stepType: normalizeStepType(step.stepType),
    text: step.text ?? '',
    finishReason: step.finishReason ?? 'unknown',
    toolCalls: (step.toolCalls ?? []).map((call) => ({
      toolCallId: call.toolCallId ?? '',
      toolName: call.toolName ?? 'unknown',
      input: toJsonSafe(call.input),
    })),
    toolResults: (step.toolResults ?? []).map((result) => ({
      toolCallId: result.toolCallId ?? '',
      toolName: result.toolName ?? 'unknown',
      input: toJsonSafe(result.input),
      output: toJsonSafe(result.output),
      success: inferToolResultSuccess(result.output),
    })),
  }))
}

function getLastUserQuery(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i] as {
      role?: string
      parts?: Array<{ type?: string; text?: string }>
      content?: string
    }

    if (message.role !== 'user') continue

    if (Array.isArray(message.parts)) {
      const content = extractVisibleTextFromUIMessageParts(message.parts)
      if (content.trim().length > 0) return content
    }

    if (typeof message.content === 'string' && message.content.trim().length > 0) {
      return message.content
    }
  }

  return ''
}

export function getFinalVisibleTextFromSteps(
  steps: StepResultLike[],
  generatedText: string
): string {
  const finalStepText = (steps[steps.length - 1]?.text ?? '').trim()
  if (finalStepText.length > 0) {
    return extractVisibleTextFromStepTexts([finalStepText])
  }

  // If we used tools and ended without a final prose step, prefer no text over
  // leaking intermediate planning/search narration.
  if (steps.length > 1) {
    return ''
  }

  return extractVisibleTextFromStepTexts([generatedText])
}

function getNonEmptyStepTextCount(steps: StepResultLike[]): number {
  return steps.reduce((count, step) => {
    return count + ((step.text ?? '').trim().length > 0 ? 1 : 0)
  }, 0)
}

const META_NARRATION_PATTERN =
  /\b(let me|i(?:'m| am| ll|'ll)\s+(?:check|search|look|try)|still getting|different angle|search again|looking for)\b/i

/**
 * Remove tool/process narration from assistant text when structured results
 * (event cards or directions) are already present.
 */
export function sanitizeFinalAssistantText(
  text: string,
  options: { hasStructuredData: boolean }
): string {
  const trimmed = text.trim()
  if (!trimmed) return ''
  if (!options.hasStructuredData) return trimmed

  const endsWithColon = /:\s*$/.test(trimmed)
  const shortText = trimmed.length <= 180
  const hasMetaNarration = META_NARRATION_PATTERN.test(trimmed)

  if (hasMetaNarration && (endsWithColon || shortText)) {
    return ''
  }

  return trimmed
}

/**
 * Normalize a string for event-name matching in assistant text: lowercase,
 * collapse whitespace, strip emoji and the "|" separator used in titles.
 */
function normalizeForNameMatch(value: string): string {
  return value
    .toLowerCase()
    // Strip emoji (event titles often carry decorative glyphs)
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, ' ')
    // The " | " separator splits a title from its subtitle ("Name | Brand")
    .replace(/[|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Filter accumulated events down to the ones the final assistant text actually
 * mentions by name. The model may search with a broad limit but only write
 * about one pick — emitting every searched event as a card makes the UI show
 * more cards than the answer references.
 *
 * Falls back to all events when nothing matches (generic "here are options"
 * replies that present a list without naming each event).
 */
export function filterEventsMentionedInText(
  events: ChatEventPayload[],
  finalText: string
): ChatEventPayload[] {
  if (events.length === 0 || !finalText) return events

  const normalizedText = normalizeForNameMatch(finalText)
  const mentioned = events.filter((event) => {
    const name = normalizeForNameMatch(event.name)
    if (!name) return false
    // Match the full title, or any significant segment (before "|", or the
    // first 3+ words) so "Make Friends: Deep talks & Coffee" matches the card
    // even when the model drops the subtitle.
    if (normalizedText.includes(name)) return true
    const segments = name.split(' ')
    if (segments.length >= 3) {
      const core = segments.slice(0, 3).join(' ')
      if (normalizedText.includes(core)) return true
    }
    return false
  })

  return mentioned.length > 0 ? mentioned : events
}

function buildStructuredDataFallbackText(
  locale: 'en' | 'es',
  originalQuery: string
): string {
  const query = originalQuery.toLowerCase()
  const asksForUpscale = /(upscale|exclusive|premium|vip|luxe|luxury|exclusiv|premium|más premium)/i.test(query)

  if (locale === 'es') {
    return asksForUpscale
      ? 'Aquí tienes opciones más premium para esta noche.'
      : 'Aquí tienes opciones para esta noche.'
  }

  return asksForUpscale
    ? 'Here are better upscale options for tonight.'
    : 'Here are options for tonight.'
}

function buildStreamEnvelope<T>(
  requestId: string,
  data: T,
  assistantMessageId?: string
): ChatStreamDataEnvelope<T> {
  return {
    requestId,
    assistantMessageId,
    data,
  }
}

/**
 * Get client IP from request headers
 */
function getClientIP(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    return forwarded.split(',')[0].trim()
  }
  return (
    request.headers.get('x-real-ip') ??
    request.headers.get('cf-connecting-ip') ??
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
  const resetTimeStr = resetDate.toLocaleTimeString('es-AR', {
    timeZone: BA_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
  })

  return createErrorStream(
    `You've reached the rate limit (${RATE_LIMIT_REQUESTS} requests per hour). Please try again after ${resetTimeStr}.`
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute('/api/chat' as any)({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Parse request body
        let uiMessages: UIMessage[]
        let modelMessages: Awaited<ReturnType<typeof convertToModelMessages>>
        let locale: 'en' | 'es'
        let trendingEventId: string | undefined

        try {
          const body = await request.json() as {
            messages?: UIMessage[]
            locale?: 'en' | 'es'
            trendingEventId?: string
          }

          locale = body.locale ?? 'en'
          uiMessages = Array.isArray(body.messages) ? body.messages : []
          trendingEventId = body.trendingEventId
          modelMessages = await convertToModelMessages(uiMessages)
        } catch {
          return createErrorStream('Invalid request body')
        }

        // Rate limiting
        const ip = getClientIP(request)
        const { success, reset } = await checkRateLimit(ip)
        if (!success) {
          console.log(`[RATE LIMIT] IP ${ip} exceeded rate limit, reset at ${new Date(reset).toISOString()}`)
          return createRateLimitResponse(reset)
        }

        // Get user context for authenticated actions
        const userContext = await getUserToolContext()
        console.log(`[DEBUG] User context: authenticated=${userContext.isAuthenticated}, userId=${userContext.userId?.slice(0, 8) ?? 'none'}`)

        // Inject auth state into the system prompt (replaces the old
        // get_user_context tool - static info, not worth a model step)
        const savedEventsCount = userContext.isAuthenticated
          ? ((await listSavedEventsForUser('all', userContext)).count ?? 0)
          : 0
        let systemPrompt = getSystemPrompt(locale, {
          isAuthenticated: userContext.isAuthenticated,
          savedEventsCount,
        })

        // Pin a home-screen trending event tap to that exact event. The id is
        // carried in the request body (never in the visible message text), so
        // the chat UI and persisted history stay clean.
        if (trendingEventId) {
          try {
            const pinnedEvent = await getEventWithVenue(trendingEventId)
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
              options?: Pick<ChatStreamStatusData, 'toolName' | 'stepIndex' | 'assistantMessageId'>
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

              const result = streamText({
                model: textModel,
                system: systemPrompt,
                messages: modelMessages,
                tools: createTools(userContext, locale),
                ...NO_THINKING,
                stopWhen: stepCountIs(MAX_STEPS),
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

                  // Track tool usage
                  for (const call of toolCalls) {
                    writeStatus('calling_tool', {
                      toolName: call.toolName,
                      stepIndex,
                    })
                    trackServer('agent:tool_used', userContext.userId ?? 'anonymous', {
                      tool: call.toolName,
                      success: true,
                    })
                  }
                },
              })

              // Collect all steps first, then emit exactly one final assistant message.
              const [steps, generatedText] = await Promise.all([result.steps, result.text])
              const typedSteps = steps as StepResultLike[]
              const executionTrace = buildExecutionTrace(typedSteps)

              const rawFinalText = getFinalVisibleTextFromSteps(typedSteps, generatedText)
              const nonEmptyStepTextCount = getNonEmptyStepTextCount(typedSteps)
              const accumulatedEvents = Array.from(allEvents.values())
              let finalText = sanitizeFinalAssistantText(rawFinalText, {
                hasStructuredData: accumulatedEvents.length > 0 || directionsData !== null,
              })
              if (!finalText && (accumulatedEvents.length > 0 || directionsData !== null)) {
                finalText = buildStructuredDataFallbackText(locale, lastOriginalQuery)
              }

              // Only attach cards for events the final answer actually names —
              // the model may search a broad set but recommend a single pick,
              // and showing every searched event contradicts the prose.
              const events = filterEventsMentionedInText(accumulatedEvents, finalText)

              // Topical guardrail: replace off-topic replies (code, general
              // knowledge, etc.) with a canned refusal. Fails open on error.
              if (finalText) {
                const guarded = await guardForOffTopic(finalText, locale)
                if (guarded) finalText = guarded
              }

              // Coverage guardrail: if the model asserted a coverage ceiling
              // ("furthest is X", "no events past X") while only having
              // searched a window short of the true horizon, append a grounded
              // correction. Fails open (returns text unchanged).
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

              const messageId = generateId()
              assistantMessageId = messageId
              const textBlockId = generateId()

              writeStatus('composing', {
                stepIndex: finalStepIndex,
                assistantMessageId,
              })

              writer.write({ type: 'start', messageId })
              wroteStart = true
              writer.write({ type: 'text-start', id: textBlockId })
              if (finalText.length > 0) {
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
      },
    },
  },
})
