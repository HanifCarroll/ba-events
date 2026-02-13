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
import { createAnthropic } from '@ai-sdk/anthropic'
import { checkRateLimit, RATE_LIMIT_REQUESTS } from '@/features/auth/api/rate-limit'
import { getUserToolContext } from '@/features/chat/api/user-tools'
import { createTools } from '@/features/chat/api/tools-ai-sdk'
import { getSystemPrompt } from '@/features/chat/api/prompts'
import { generateSuggestions } from '@/features/chat/api/suggestions'
import {
  extractVisibleTextFromStepTexts,
  extractVisibleTextFromUIMessageParts,
} from '@/features/chat/lib/extract-visible-text'
import { CLAUDE_MODEL } from '@/shared/lib/ai/constants'
import { trackServer } from '@/lib/analytics.server'
import { BA_TIMEZONE } from '@/shared/lib/constants'
import type {
  EventWithVenue,
  DirectionsData,
  ChatStreamStatusData,
  Json,
  MessageExecutionStep,
} from '@/shared/lib/types'
import type { SearchEventsInput } from '@/features/chat/api/tools/search-events'

// Initialize Anthropic provider
const anthropic = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

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
      JSON.stringify(value, (_, inner) => {
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
  const fromSteps = extractVisibleTextFromStepTexts(steps.map((step) => step.text ?? ''))
  if (fromSteps.length > 0) return fromSteps
  return extractVisibleTextFromStepTexts([generatedText])
}

export function getNonEmptyStepTextCount(steps: StepResultLike[]): number {
  return steps.reduce((count, step) => {
    return count + ((step.text ?? '').trim().length > 0 ? 1 : 0)
  }, 0)
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

        try {
          const body = await request.json() as {
            messages?: UIMessage[]
            locale?: 'en' | 'es'
          }

          locale = body.locale ?? 'en'
          uiMessages = Array.isArray(body.messages) ? body.messages : []
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

        // Accumulate events across all tool calls
        const allEvents = new Map<string, EventWithVenue>()
        let lastSearchInput: SearchEventsInput | null = null
        let lastOriginalQuery = ''
        let directionsData: DirectionsData | null = null

        // Get the last user message for suggestions
        lastOriginalQuery = getLastUserQuery(uiMessages)

        // Create the stream with custom data support
        const stream = createUIMessageStream({
          execute: async ({ writer }) => {
            let wroteStart = false
            const requestId = generateId()
            let stepIndex = -1

            const writeStatus = (
              phase: ChatStreamStatusData['phase'],
              options?: Pick<ChatStreamStatusData, 'toolName' | 'stepIndex'>
            ) => {
              writer.write({
                type: 'data-status' as const,
                data: {
                  phase,
                  toolName: options?.toolName,
                  stepIndex: options?.stepIndex,
                  requestId,
                  timestamp: new Date().toISOString(),
                },
              })
            }

            try {
              writeStatus('thinking')

              const result = streamText({
                model: anthropic(CLAUDE_MODEL),
                system: getSystemPrompt(locale),
                messages: modelMessages,
                tools: createTools(userContext, locale),
                stopWhen: stepCountIs(MAX_STEPS),
                onStepFinish: ({ toolCalls, toolResults }) => {
                  stepIndex += 1

                  // Accumulate events from each step
                  for (const result of toolResults) {
                    const toolOutput = result.output as {
                      events?: EventWithVenue[]
                      metadata?: { toolInput?: SearchEventsInput }
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

              const finalText = getFinalVisibleTextFromSteps(typedSteps, generatedText)
              const nonEmptyStepTextCount = getNonEmptyStepTextCount(typedSteps)

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
              const textBlockId = generateId()

              writeStatus('composing', {
                stepIndex: finalStepIndex,
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
              const events = Array.from(allEvents.values())
              if (events.length > 0) {
                writer.write({
                  type: 'data-events' as const,
                  data: events,
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
                    data: suggestions,
                  })
                  console.log(`[DEBUG] Generated ${suggestions.length} suggestions`)
                }
              }

              // Send directions data if available
              if (directionsData) {
                writer.write({
                  type: 'data-directions' as const,
                  data: directionsData,
                })
                console.log(`[DEBUG] Sending directions for "${directionsData.venueName}"`)
              }

              // Send execution trace for persistence/debugging (not rendered in bubble text).
              writer.write({
                type: 'data-execution-trace' as const,
                data: executionTrace,
              })

              writeStatus('done', {
                stepIndex: finalStepIndex,
              })

              writer.write({
                type: 'finish',
                finishReason: 'stop',
              })
            } catch (error) {
              console.error('[Chat API] Error:', error)
              writeStatus('error', {
                stepIndex: stepIndex >= 0 ? stepIndex : undefined,
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
