import Anthropic from '@anthropic-ai/sdk'
import { createServerFn } from '@tanstack/react-start'
import { getRequestHeader } from '@tanstack/react-start/server'
import { z } from 'zod'
import { checkRateLimit, RATE_LIMIT_REQUESTS } from '@/features/auth'
import { trackServer } from '@/lib/analytics.server'
import { CLAUDE_MODEL } from '@/shared/lib/ai/constants'
import { BA_TIMEZONE } from '@/shared/lib/constants'
import { getUserToolContext } from './user-tools'
import {
  getAnthropicTools,
  executeTool,
  isValidToolName,
  type SearchEventsInput,
} from './tools'
import { getSystemPrompt } from './prompts'
import type {
  EventWithVenue,
  APIMessage,
  ContentBlock,
  RefinementSuggestion,
  StreamEvent,
} from '@/shared/lib/types'

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

// Content block schemas for proper API message format
const textBlockSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
})

const toolUseBlockSchema = z.object({
  type: z.literal('tool_use'),
  id: z.string(),
  name: z.string(),
  input: z.record(z.string(), z.unknown()),
})

const toolResultBlockSchema = z.object({
  type: z.literal('tool_result'),
  tool_use_id: z.string(),
  content: z.string(),
})

const contentBlockSchema = z.union([textBlockSchema, toolUseBlockSchema, toolResultBlockSchema])

// Message schema for conversation history - supports both string and ContentBlock[] content
const apiMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.union([z.string(), z.array(contentBlockSchema)]),
})

const chatRequestSchema = z.object({
  message: z.string(),
  history: z.array(apiMessageSchema).default([]),
  locale: z.enum(['en', 'es']).default('en'),
})

// Get tools from registry
const tools = getAnthropicTools()



// Generate refinement suggestions based on search context
interface SuggestionContext {
  originalQuery: string
  toolInput: SearchEventsInput
  results: EventWithVenue[]
  locale: 'en' | 'es'
}

function generateSuggestions(context: SuggestionContext): RefinementSuggestion[] {
  const { originalQuery, toolInput, results, locale } = context
  const suggestions: RefinementSuggestion[] = []
  const hasResults = results.length > 0
  const isSingleRecommendation = results.length === 1

  if (hasResults) {
    // CONCIERGE MODE: Single recommendation = contextual refinements based on the event
    if (isSingleRecommendation) {
      const event = results[0]

      // Vibe-based refinements based on event categories
      const isHighEnergy = event.categories.some(c => ['music', 'festival'].includes(c))
      const isChill = event.categories.some(c => ['arts', 'food'].includes(c))

      if (isHighEnergy) {
        suggestions.push({
          id: 'more-chill',
          label: locale === 'es' ? 'Algo más tranquilo' : 'Something more chill',
          prompt: locale === 'es' ? 'algo más tranquilo y relajado' : 'something more chill and relaxed',
          icon: 'moon',
          type: 'broader',
        })
      }
      if (isChill) {
        suggestions.push({
          id: 'more-energy',
          label: locale === 'es' ? 'Más energía' : 'Higher energy',
          prompt: locale === 'es' ? 'algo con más energía y movimiento' : 'something with more energy and dancing',
          icon: 'sparkles',
          type: 'broader',
        })
      }

      // Neighborhood refinement
      if (event.venue_neighborhood) {
        suggestions.push({
          id: 'different-area',
          label: locale === 'es' ? 'Otra zona' : 'Different area',
          prompt: locale === 'es'
            ? `algo similar pero no en ${event.venue_neighborhood}`
            : `something similar but not in ${event.venue_neighborhood}`,
          icon: 'map-pin',
          type: 'neighborhood',
        })
      }

      // Price refinement
      if (event.price && event.price > 5000) {
        suggestions.push({
          id: 'more-budget',
          label: locale === 'es' ? 'Más económico' : 'More budget-friendly',
          prompt: locale === 'es' ? 'algo más económico' : 'something more affordable',
          icon: 'ticket',
          type: 'price',
        })
      } else if (event.is_free) {
        suggestions.push({
          id: 'more-upscale',
          label: locale === 'es' ? 'Más premium' : 'More upscale',
          prompt: locale === 'es' ? 'algo más exclusivo o premium' : 'something more upscale or exclusive',
          icon: 'sparkles',
          type: 'price',
        })
      }

      // Always include "show alternatives"
      suggestions.push({
        id: 'show-alternatives',
        label: locale === 'es' ? 'Ver alternativas' : 'Show alternatives',
        prompt: locale === 'es' ? 'muéstrame algunas opciones alternativas' : 'show me a few alternative options',
        icon: 'list',
        type: 'broader',
      })

    } else {
      // MULTI-RESULT MODE: Standard refinements

      // Time suggestions (if no time filter was used)
      if (!toolInput.timeFilter) {
        suggestions.push({
          id: 'tonight',
          label: locale === 'es' ? 'Esta noche' : 'Tonight',
          prompt: `${originalQuery} tonight`,
          icon: 'moon',
          type: 'time',
        })
        suggestions.push({
          id: 'weekend',
          label: locale === 'es' ? 'Este finde' : 'This weekend',
          prompt: `${originalQuery} this weekend`,
          icon: 'calendar',
          type: 'time',
        })
      }

      // Price suggestion (if results have paid events and not already filtering free)
      const hasPaidEvents = results.some(e => !e.is_free)
      if (hasPaidEvents && !toolInput.isFree) {
        suggestions.push({
          id: 'free',
          label: locale === 'es' ? 'Solo gratis' : 'Free only',
          prompt: `free ${originalQuery}`,
          icon: 'ticket',
          type: 'price',
        })
      }

      // Neighborhood suggestion (from most common in results)
      const neighborhoodCounts = new Map<string, number>()
      results.forEach(e => {
        if (e.venue_neighborhood) {
          neighborhoodCounts.set(e.venue_neighborhood, (neighborhoodCounts.get(e.venue_neighborhood) || 0) + 1)
        }
      })
      if (neighborhoodCounts.size > 0 && !toolInput.neighborhood) {
        const topNeighborhood = [...neighborhoodCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]
        suggestions.push({
          id: `neighborhood-${topNeighborhood}`,
          label: locale === 'es' ? `En ${topNeighborhood}` : `In ${topNeighborhood}`,
          prompt: `${originalQuery} in ${topNeighborhood}`,
          icon: 'map-pin',
          type: 'neighborhood',
        })
      }
    }
  } else {
    // REPLACE MODE: pivot to new search (escape hatches)
    suggestions.push({
      id: 'tonight',
      label: locale === 'es' ? "¿Qué hay esta noche?" : "What's tonight?",
      prompt: locale === 'es' ? "qué hay esta noche" : "what's happening tonight",
      icon: 'moon',
      type: 'broader',
    })
    suggestions.push({
      id: 'browse-all',
      label: locale === 'es' ? 'Ver todos' : 'Browse all',
      prompt: locale === 'es' ? 'eventos esta semana' : 'events this week',
      icon: 'calendar',
      type: 'broader',
    })

    // Suggest some categories
    const categoriesToSuggest = ['music', 'food', 'arts'] as const
    const categoryLabels: Record<string, { en: string; es: string }> = {
      music: { en: 'Live music', es: 'Música en vivo' },
      food: { en: 'Food & dining', es: 'Gastronomía' },
      arts: { en: 'Arts & culture', es: 'Arte y cultura' },
    }

    for (const cat of categoriesToSuggest.slice(0, 2)) {
      suggestions.push({
        id: `category-${cat}`,
        label: locale === 'es' ? categoryLabels[cat].es : categoryLabels[cat].en,
        prompt: locale === 'es' ? `${categoryLabels[cat].es} esta semana` : `${categoryLabels[cat].en} this week`,
        icon: 'sparkles',
        type: 'category',
      })
    }
  }

  // Return max 4 suggestions
  return suggestions.slice(0, 4)
}

// Type for parsed tool use from stream - now uses ToolName from registry
interface ParsedToolUse {
  id: string
  name: string
  input: unknown
}

// Process stream and collect response data
interface StreamResult {
  text: string
  toolUses: ParsedToolUse[]
  stopReason: string | null
}

async function processStream(
  response: AsyncIterable<Anthropic.MessageStreamEvent>,
  sendEvent: (event: StreamEvent) => void,
  streamText: boolean = true // Only stream text if true (false for first call with potential tool use)
): Promise<StreamResult> {
  let text = ''
  const toolUses: ParsedToolUse[] = []
  let currentToolUse: { id: string; name: string; inputJson: string } | null = null
  let stopReason: string | null = null

  for await (const event of response) {
    if (event.type === 'content_block_start') {
      if (event.content_block.type === 'tool_use') {
        currentToolUse = {
          id: event.content_block.id,
          name: event.content_block.name,
          inputJson: '',
        }
      }
    } else if (event.type === 'content_block_delta') {
      if (event.delta.type === 'text_delta') {
        text += event.delta.text
        if (streamText) {
          sendEvent({ type: 'text', content: event.delta.text })
        }
      } else if (event.delta.type === 'input_json_delta' && currentToolUse) {
        currentToolUse.inputJson += event.delta.partial_json
      }
    } else if (event.type === 'content_block_stop') {
      if (currentToolUse) {
        try {
          const rawInput: unknown = JSON.parse(currentToolUse.inputJson)

          // Validate tool name is known, then push - Zod validation happens in executeTool
          if (isValidToolName(currentToolUse.name)) {
            toolUses.push({
              id: currentToolUse.id,
              name: currentToolUse.name,
              input: rawInput,
            })
          } else {
            console.warn(`[DEBUG] Unknown tool name: ${currentToolUse.name}`)
          }
        } catch (parseError) {
          console.error(`[DEBUG] Failed to parse tool input for ${currentToolUse.name}:`, parseError)
        }
        currentToolUse = null
      }
    } else if (event.type === 'message_delta') {
      stopReason = event.delta.stop_reason
    }
  }

  return { text, toolUses, stopReason }
}

// Helper to extract client IP from request headers
function getClientIP(): string {
  try {
    // Netlify/proxies set x-forwarded-for header
    const forwarded = getRequestHeader('x-forwarded-for')
    if (forwarded) {
      return forwarded.split(',')[0].trim()
    }
    // Fallback headers
    return (
      getRequestHeader('x-real-ip') ??
      getRequestHeader('cf-connecting-ip') ?? // Cloudflare
      'unknown'
    )
  } catch {
    return 'unknown'
  }
}

// Create error stream for rate limiting
function createRateLimitErrorStream(resetTimestamp: number): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const resetDate = new Date(resetTimestamp)
  // Format time in Buenos Aires timezone since this is a BA-focused app
  const resetTimeStr = resetDate.toLocaleTimeString('es-AR', {
    timeZone: BA_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
  })
  const message = `You've reached the rate limit (${RATE_LIMIT_REQUESTS} requests per hour). Please try again after ${resetTimeStr}.`

  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message })}\n\n`))
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`))
      controller.close()
    },
  })
}

// Agent loop configuration
const MAX_ITERATIONS = 5 // Maximum tool use iterations to prevent infinite loops
const MAX_TOKENS_PER_TURN = 1024

// Server function for chat with true agentic loop
export const chat = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => chatRequestSchema.parse(data))
  .handler(async ({ data }): Promise<ReadableStream<Uint8Array>> => {
    const { message, history, locale } = data
    const encoder = new TextEncoder()

    // Check rate limit
    const ip = getClientIP()
    const { success, reset } = await checkRateLimit(ip)
    if (!success) {
      console.log(`[RATE LIMIT] IP ${ip} exceeded rate limit, reset at ${new Date(reset).toISOString()}`)
      return createRateLimitErrorStream(reset)
    }

    // Get user context for authenticated actions (save events, etc.)
    // User identity comes from server-side session cookies - never from client input
    const userContext = await getUserToolContext()
    console.log(`[DEBUG] User context: authenticated=${userContext.isAuthenticated}, userId=${userContext.userId?.slice(0, 8) ?? 'none'}`)

    // Build messages from history (already in proper APIMessage format)
    const messages: Anthropic.MessageParam[] = [
      ...history.map(msg => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content as string | Anthropic.ContentBlockParam[],
      })),
      { role: 'user' as const, content: message },
    ]

    // Track new messages added during this exchange for history event
    const newMessages: APIMessage[] = []

    return new ReadableStream({
      async start(controller) {
        const sendEvent = (event: StreamEvent) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        }

        try {
          // TRUE AGENT LOOP: Continue until Claude stops using tools or max iterations reached
          // Events are accumulated across all iterations and only sent at the end
          let iteration = 0
          let done = false
          let finalText = ''

          // Accumulate events across ALL iterations (keyed by ID to avoid duplicates)
          const allEvents = new Map<string, EventWithVenue>()
          let lastSearchInput: SearchEventsInput | null = null

          console.log('[DEBUG] Starting agent loop')

          while (!done && iteration < MAX_ITERATIONS) {
            iteration++
            console.log(`[DEBUG] Agent loop iteration ${iteration}/${MAX_ITERATIONS}`)

            const response = await anthropic.messages.create({
              model: CLAUDE_MODEL,
              max_tokens: MAX_TOKENS_PER_TURN,
              system: getSystemPrompt(locale),
              tools,
              messages,
              stream: true,
            })

            // Process response - DON'T stream text yet (we accumulate it)
            const result = await processStream(response, sendEvent, false)
            console.log(`[DEBUG] Iteration ${iteration} - stop reason: ${result.stopReason}, tool uses: ${result.toolUses.length}`)

            // If Claude responded without tool use, we're done
            if (result.stopReason === 'end_turn' || result.stopReason === 'max_tokens') {
              console.log(`[DEBUG] Agent loop complete after ${iteration} iteration(s) - ${result.stopReason}`)
              finalText = result.text
              done = true

              // Add final response to history
              if (result.text) {
                newMessages.push({ role: 'assistant', content: result.text })
              }
              break
            }

            // Handle tool use
            if (result.stopReason === 'tool_use' && result.toolUses.length > 0) {
              // Build assistant message content
              const assistantContent: ContentBlock[] = []
              if (result.text) {
                assistantContent.push({ type: 'text', text: result.text })
              }
              for (const toolUse of result.toolUses) {
                assistantContent.push({
                  type: 'tool_use',
                  id: toolUse.id,
                  name: toolUse.name,
                  input: toolUse.input,
                } as ContentBlock)
              }

              messages.push({ role: 'assistant', content: assistantContent as Anthropic.ContentBlockParam[] })
              newMessages.push({ role: 'assistant', content: assistantContent })

              // Execute tools and collect results
              const toolResults: Anthropic.ToolResultBlockParam[] = []
              const toolResultsForHistory: ContentBlock[] = []

              for (const toolUse of result.toolUses) {
                const toolResult = await executeTool(toolUse.name, toolUse.input, {
                  userContext,
                  locale,
                })

                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: toolUse.id,
                  content: toolResult.formatted,
                  is_error: !toolResult.success,
                })
                toolResultsForHistory.push({
                  type: 'tool_result',
                  tool_use_id: toolUse.id,
                  content: toolResult.formatted,
                })

                // ACCUMULATE events across iterations (keyed by ID to dedupe)
                if (toolResult.events && toolResult.events.length > 0) {
                  for (const event of toolResult.events) {
                    allEvents.set(event.id, event)
                  }
                  console.log(`[DEBUG] Accumulated ${toolResult.events.length} events, total unique: ${allEvents.size}`)
                }

                // Track last search input for suggestions
                if (toolUse.name === 'search_events' && toolResult.metadata?.toolInput) {
                  lastSearchInput = toolResult.metadata.toolInput as SearchEventsInput
                }

                // Track tool usage
                trackServer('agent:tool_used', userContext.userId ?? 'anonymous', {
                  tool: toolUse.name,
                  success: toolResult.success,
                  iteration,
                  ...(toolResult.metadata ?? {}),
                })

                console.log(`[DEBUG] ${toolUse.name}: success=${toolResult.success}`)
              }

              // Add tool results to conversation for next iteration
              messages.push({ role: 'user', content: toolResults })
              newMessages.push({ role: 'user', content: toolResultsForHistory })
            }
          }

          // Safety: If we hit max iterations without natural completion, force a response
          if (!done) {
            console.log(`[DEBUG] Hit max iterations (${MAX_ITERATIONS}), forcing final response`)

            const finalResponse = await anthropic.messages.create({
              model: CLAUDE_MODEL,
              max_tokens: MAX_TOKENS_PER_TURN,
              system: getSystemPrompt(locale),
              tools,
              messages,
              stream: true,
              tool_choice: { type: 'none' }, // Force text response
            })

            const finalResult = await processStream(finalResponse, sendEvent, false)
            finalText = finalResult.text
            if (finalText) {
              newMessages.push({ role: 'assistant', content: finalText })
            }
          }

          // NOW send accumulated events (only at the very end)
          const eventsToSend = Array.from(allEvents.values())
          if (eventsToSend.length > 0) {
            sendEvent({ type: 'events', data: eventsToSend })
            console.log(`[DEBUG] Sending ${eventsToSend.length} accumulated events`)
          }

          // Generate and send suggestions based on last search
          if (lastSearchInput) {
            const suggestions = generateSuggestions({
              originalQuery: message,
              toolInput: lastSearchInput,
              results: eventsToSend,
              locale,
            })
            if (suggestions.length > 0) {
              sendEvent({ type: 'suggestions', data: suggestions })
              console.log(`[DEBUG] Generated ${suggestions.length} suggestions`)
            }
          }

          // Send response text
          if (finalText) {
            sendEvent({ type: 'text', content: finalText })
          }

          // Send history and done
          sendEvent({ type: 'history', messages: newMessages })
          sendEvent({ type: 'done' })
        } catch (error) {
          console.error('Chat error:', error)
          sendEvent({
            type: 'error',
            message: error instanceof Error ? error.message : 'An error occurred',
          })
          sendEvent({ type: 'done' })
        } finally {
          controller.close()
        }
      },
    })
  })
