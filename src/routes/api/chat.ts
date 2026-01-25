/**
 * Chat API Route
 *
 * Handles AI chat requests using Vercel AI SDK with streaming.
 * Supports tool calling for event search and user actions.
 */

import { createFileRoute } from '@tanstack/react-router'
import {
  streamText,
  stepCountIs,
  createUIMessageStream,
  createUIMessageStreamResponse,
} from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { checkRateLimit, RATE_LIMIT_REQUESTS } from '@/features/auth/api/rate-limit'
import { getUserToolContext } from '@/features/chat/api/user-tools'
import { createTools } from '@/features/chat/api/tools-ai-sdk'
import { getSystemPrompt } from '@/features/chat/api/prompts'
import { generateSuggestions } from '@/features/chat/api/suggestions'
import { CLAUDE_MODEL } from '@/shared/lib/ai/constants'
import { trackServer } from '@/lib/analytics.server'
import { BA_TIMEZONE } from '@/shared/lib/constants'
import type { EventWithVenue, DirectionsData } from '@/shared/lib/types'
import type { SearchEventsInput } from '@/features/chat/api/tools/search-events'

// Initialize Anthropic provider
const anthropic = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

// Agent loop configuration (reduced from 5 for faster responses)
const MAX_STEPS = 3

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
        let messages: Array<{ role: string; content: string }>
        let locale: 'en' | 'es'

        try {
          const body = await request.json()
          locale = body.locale ?? 'en'

          // Handle both AI SDK UIMessage format (with parts) and simple format (with content)
          const rawMessages = body.messages ?? []
          messages = rawMessages.map((m: { role: string; content?: string; parts?: Array<{ type: string; text?: string }> }) => {
            // If message has parts array (AI SDK format), extract text from text parts
            if (m.parts && Array.isArray(m.parts)) {
              const textContent = m.parts
                .filter((p: { type: string; text?: string }) => p.type === 'text' && p.text)
                .map((p: { type: string; text?: string }) => p.text)
                .join('')
              return { role: m.role, content: textContent }
            }
            // Otherwise use content directly (simple format)
            return { role: m.role, content: m.content ?? '' }
          })
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
        const lastUserMessage = messages.filter(m => m.role === 'user').pop()
        if (lastUserMessage) {
          lastOriginalQuery = lastUserMessage.content
        }

        // Create the stream with custom data support
        const stream = createUIMessageStream({
          execute: async ({ writer }) => {
            try {
              const result = streamText({
                model: anthropic(CLAUDE_MODEL),
                system: getSystemPrompt(locale),
                messages: messages.map(m => ({
                  role: m.role as 'user' | 'assistant',
                  content: m.content,
                })),
                tools: createTools(userContext, locale),
                stopWhen: stepCountIs(MAX_STEPS),
                onStepFinish: ({ toolCalls, toolResults }) => {
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
                    trackServer('agent:tool_used', userContext.userId ?? 'anonymous', {
                      tool: call.toolName,
                      success: true,
                    })
                  }
                },
              })

              // Merge the AI response stream
              writer.merge(result.toUIMessageStream())

              // Wait for the stream to complete
              await result.text

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
            } catch (error) {
              console.error('[Chat API] Error:', error)
              writer.write({
                type: 'error',
                errorText: error instanceof Error ? error.message : 'An error occurred',
              })
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
