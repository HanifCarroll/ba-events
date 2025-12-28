import Anthropic from '@anthropic-ai/sdk'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { toZonedTime, fromZonedTime } from 'date-fns-tz'
import { addDays, setHours, startOfDay, getDay, getHours, format } from 'date-fns'
import { searchEventsWithFilters, hybridEventSearch } from './supabase'
import { CATEGORIES, VIBES, NEIGHBORHOODS } from './types'
import type { EventWithVenue, EventFilters, APIMessage, ContentBlock } from './types'

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
})

// Tool input schema for search_events
const searchEventsInputSchema = z.object({
  query: z.string().optional(),
  categories: z.array(z.string()).optional(),
  vibes: z.array(z.string()).optional(),
  neighborhood: z.string().optional(),
  isFree: z.boolean().optional(),
  maxPrice: z.number().optional(),
  timeFilter: z.enum(['tonight', 'tomorrow', 'weekend', 'week']).optional(),
})

type SearchEventsInput = z.infer<typeof searchEventsInputSchema>

// System prompt for the events assistant
const SYSTEM_PROMPT = `You are a friendly and knowledgeable Buenos Aires events assistant. You help users discover events happening in the city - from techno nights and jazz bars to tango milongas, art exhibitions, and food markets.

## Your Personality
- Warm and enthusiastic about Buenos Aires nightlife and culture
- Knowledgeable about different neighborhoods (barrios) and their vibes
- Helpful without being pushy
- Keep responses concise but informative

## Available Categories
${CATEGORIES.join(', ')}

## Available Vibes
${VIBES.join(', ')}

## Neighborhoods
You know all 48 official CABA neighborhoods, including popular ones like Palermo, San Telmo, Recoleta, La Boca, and Villa Crespo.

## How to Search for Events

Use the search_events tool with these parameters:

1. **Use 'query' for natural language/vibe-based searches:**
   - "romantic evening with live music"
   - "underground techno party"
   - "chill outdoor activity"
   - "high energy dance night"
   The semantic search understands moods and vibes beyond exact category matches.

2. **Use filters for specific requirements:**
   - timeFilter: tonight, tomorrow, weekend, week
   - neighborhood: specific barrio
   - isFree: only free events
   - maxPrice: budget limit
   - categories/vibes: when user explicitly mentions them

3. **Combine both for best results:**
   - query="underground techno" + timeFilter="weekend"
   - query="romantic dinner" + neighborhood="Palermo"

## When to Use Each Approach

- Vibe/mood requests ("something chill", "high energy") → use query parameter
- Specific filters ("free events in Palermo this weekend") → use filter parameters
- Both ("underground techno tonight") → combine query + timeFilter

## Response Format
- Start with a brief, friendly intro
- Present the events (they will be displayed as cards automatically)
- Offer helpful follow-up suggestions if relevant

Remember: You're helping people have a great time in Buenos Aires!`

// Tool definition for Claude
const tools: Anthropic.Tool[] = [
  {
    name: 'search_events',
    description: `Search for events in Buenos Aires using semantic search and/or filters.
Use the 'query' parameter for natural language searches describing the desired experience
(e.g., "romantic jazz night", "underground techno party", "chill outdoor activities").
Use other parameters for specific requirements. Combine both for best results.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: `Natural language search query for semantic matching. Use for vibe-based
or descriptive searches like "romantic date spot", "high energy dance party",
"relaxed afternoon activity", "underground warehouse vibes".`,
        },
        categories: {
          type: 'array',
          items: { type: 'string' },
          description: `Event categories to filter by. Options: ${CATEGORIES.join(', ')}`,
        },
        vibes: {
          type: 'array',
          items: { type: 'string' },
          description: `Event vibes/atmosphere. Options: ${VIBES.join(', ')}`,
        },
        neighborhood: {
          type: 'string',
          description: 'Buenos Aires neighborhood to filter by',
        },
        isFree: {
          type: 'boolean',
          description: 'Set to true to only show free events',
        },
        maxPrice: {
          type: 'number',
          description: 'Maximum price in ARS',
        },
        timeFilter: {
          type: 'string',
          enum: ['tonight', 'tomorrow', 'weekend', 'week'],
          description: 'Time period filter. tonight = today evening, tomorrow = next day, weekend = Saturday/Sunday, week = next 7 days',
        },
      },
    },
  },
]

const BA_TIMEZONE = 'America/Argentina/Buenos_Aires'

// Get current time in Buenos Aires
function getNowInBA(): Date {
  return toZonedTime(new Date(), BA_TIMEZONE)
}

// Convert a BA local time to UTC ISO string
function baToUTC(baDate: Date): string {
  return fromZonedTime(baDate, BA_TIMEZONE).toISOString()
}

// Format a UTC date as BA local time string
function formatInBA(utcDateStr: string): string {
  const utcDate = new Date(utcDateStr)
  const baDate = toZonedTime(utcDate, BA_TIMEZONE)
  return format(baDate, "EEEE, MMM d 'at' h:mm a") // e.g., "Sunday, Dec 28 at 4:00 PM"
}

// Convert tool input to EventFilters
function toolInputToFilters(input: SearchEventsInput): EventFilters {
  const filters: EventFilters = {}
  const now = getNowInBA()
  const currentHour = getHours(now)

  // Time filter
  if (input.timeFilter === 'tonight') {
    // If it's between midnight and 6am, "tonight" means the current ongoing night
    // Otherwise, "tonight" means starting from 6pm today
    let tonight: Date
    let tomorrowMorning: Date

    if (currentHour < 6) {
      // It's late night/early morning - "tonight" is already happening
      tonight = now
      tomorrowMorning = setHours(startOfDay(now), 6)
    } else {
      // It's daytime - tonight starts at 6pm
      tonight = setHours(startOfDay(now), 18)
      tomorrowMorning = setHours(startOfDay(addDays(now, 1)), 6)
    }
    filters.startsAfter = baToUTC(tonight)
    filters.startsBefore = baToUTC(tomorrowMorning)
  } else if (input.timeFilter === 'tomorrow') {
    const tomorrow = startOfDay(addDays(now, 1))
    const dayAfter = startOfDay(addDays(now, 2))
    filters.startsAfter = baToUTC(tomorrow)
    filters.startsBefore = baToUTC(dayAfter)
  } else if (input.timeFilter === 'weekend') {
    const dayOfWeek = getDay(now)

    if (dayOfWeek === 6 || dayOfWeek === 0) {
      // Already weekend - start from now, end Monday midnight
      const daysUntilMonday = dayOfWeek === 6 ? 2 : 1
      const monday = startOfDay(addDays(now, daysUntilMonday))
      filters.startsAfter = baToUTC(now)
      filters.startsBefore = baToUTC(monday)
    } else {
      // Weekday - find next Saturday
      const daysUntilSaturday = 6 - dayOfWeek
      const saturday = startOfDay(addDays(now, daysUntilSaturday))
      const monday = startOfDay(addDays(saturday, 2))
      filters.startsAfter = baToUTC(saturday)
      filters.startsBefore = baToUTC(monday)
    }
  } else if (input.timeFilter === 'week') {
    const nextWeek = addDays(now, 7)
    filters.startsAfter = baToUTC(now)
    filters.startsBefore = baToUTC(nextWeek)
  } else {
    // Default: upcoming events
    filters.startsAfter = baToUTC(now)
  }

  // Other filters
  if (input.categories?.length) {
    filters.categories = input.categories
  }
  if (input.vibes?.length) {
    filters.vibes = input.vibes
  }
  if (input.neighborhood) {
    // Try to match neighborhood (case-insensitive)
    const match = NEIGHBORHOODS.find(
      n => n.toLowerCase() === input.neighborhood?.toLowerCase()
    )
    if (match) {
      filters.neighborhood = match
    }
  }
  if (input.isFree) {
    filters.isFree = true
  }
  if (input.maxPrice !== undefined) {
    filters.maxPrice = input.maxPrice
  }

  return filters
}

// Execute the search_events tool
async function executeSearchEvents(input: SearchEventsInput): Promise<EventWithVenue[]> {
  const filters = toolInputToFilters(input)
  console.log('[DEBUG] Tool input:', JSON.stringify(input))
  console.log('[DEBUG] Filters:', JSON.stringify(filters))
  console.log('[DEBUG] Current time:', new Date().toISOString())
  console.log('[DEBUG] BA time:', getNowInBA().toISOString())

  let results: EventWithVenue[]

  // If semantic query provided, use hybrid search
  if (input.query && input.query.trim()) {
    console.log('[DEBUG] Using hybrid search with query:', input.query)
    results = await hybridEventSearch(input.query, filters, 10)
  } else {
    // Otherwise, use filter-only search
    console.log('[DEBUG] Using filter-only search')
    results = await searchEventsWithFilters(filters)
  }

  console.log('[DEBUG] Results count:', results.length)
  return results
}

// Stream event types - includes history for client to store full conversation
export type StreamEvent =
  | { type: 'text'; content: string }
  | { type: 'events'; data: EventWithVenue[] }
  | { type: 'history'; messages: APIMessage[] }
  | { type: 'error'; message: string }
  | { type: 'done' }

// Format tool result for Claude
function formatToolResult(events: EventWithVenue[]): string {
  return JSON.stringify({
    count: events.length,
    events: events.slice(0, 10).map(e => ({
      name: e.name,
      description: e.description,
      venue: e.venue_name,
      venueAddress: e.venue_address,
      neighborhood: e.venue_neighborhood,
      dateTime: formatInBA(e.starts_at),
      endsAt: e.ends_at ? formatInBA(e.ends_at) : null,
      price: e.is_free ? 'Free' : e.price ? `$${e.price} ARS` : 'TBA',
      categories: e.categories,
      vibes: e.vibes,
      minAge: e.min_age,
      ticketUrl: e.ticket_url,
    })),
  })
}

// Process stream and collect response data
interface StreamResult {
  text: string
  toolUses: Array<{ id: string; name: string; input: Record<string, unknown> }>
  stopReason: string | null
}

async function processStream(
  response: AsyncIterable<Anthropic.MessageStreamEvent>,
  sendEvent: (event: StreamEvent) => void
): Promise<StreamResult> {
  let text = ''
  const toolUses: Array<{ id: string; name: string; input: Record<string, unknown> }> = []
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
        sendEvent({ type: 'text', content: event.delta.text })
      } else if (event.delta.type === 'input_json_delta' && currentToolUse) {
        currentToolUse.inputJson += event.delta.partial_json
      }
    } else if (event.type === 'content_block_stop') {
      if (currentToolUse) {
        toolUses.push({
          id: currentToolUse.id,
          name: currentToolUse.name,
          input: JSON.parse(currentToolUse.inputJson) as Record<string, unknown>,
        })
        currentToolUse = null
      }
    } else if (event.type === 'message_delta') {
      stopReason = event.delta.stop_reason
    }
  }

  return { text, toolUses, stopReason }
}

// Server function for chat with proper agentic loop
export const chat = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => chatRequestSchema.parse(data))
  .handler(async ({ data }): Promise<ReadableStream<Uint8Array>> => {
    const { message, history } = data
    const encoder = new TextEncoder()

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

        const MAX_ITERATIONS = 5
        let iterations = 0

        try {
          // Agentic loop - continues until Claude responds without tool use or max iterations
          while (iterations < MAX_ITERATIONS) {
            iterations++
            console.log(`[DEBUG] Agentic loop iteration ${iterations}`)

            const response = await anthropic.messages.create({
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 1024,
              system: SYSTEM_PROMPT,
              tools,
              messages,
              stream: true,
            })

            // Process the stream
            const { text, toolUses, stopReason } = await processStream(response, sendEvent)
            console.log(`[DEBUG] Stop reason: ${stopReason}, tool uses: ${toolUses.length}`)

            // Check stop reason to determine next action
            if (stopReason === 'end_turn' || stopReason === 'max_tokens') {
              // Claude is done - no more tool calls needed
              console.log('[DEBUG] Claude finished (end_turn or max_tokens)')

              // Record assistant's final text response
              if (text) {
                newMessages.push({
                  role: 'assistant',
                  content: text,
                })
              }
              break
            }

            if (stopReason === 'tool_use' && toolUses.length > 0) {
              // Build assistant message content with text (if any) and tool uses
              const assistantContent: ContentBlock[] = []
              if (text) {
                assistantContent.push({ type: 'text', text })
              }
              for (const toolUse of toolUses) {
                assistantContent.push({
                  type: 'tool_use',
                  id: toolUse.id,
                  name: toolUse.name,
                  input: toolUse.input,
                })
              }

              // Add assistant message to conversation
              messages.push({
                role: 'assistant',
                content: assistantContent as Anthropic.ContentBlockParam[],
              })
              newMessages.push({
                role: 'assistant',
                content: assistantContent,
              })

              // Execute each tool and collect results
              const toolResults: Anthropic.ToolResultBlockParam[] = []
              const toolResultsForHistory: ContentBlock[] = []

              for (const toolUse of toolUses) {
                if (toolUse.name === 'search_events') {
                  try {
                    const input = toolUse.input as SearchEventsInput
                    const events = await executeSearchEvents(input)

                    // Send events to client for display
                    sendEvent({ type: 'events', data: events })

                    const resultContent = formatToolResult(events)
                    toolResults.push({
                      type: 'tool_result',
                      tool_use_id: toolUse.id,
                      content: resultContent,
                    })
                    toolResultsForHistory.push({
                      type: 'tool_result',
                      tool_use_id: toolUse.id,
                      content: resultContent,
                    })

                    console.log(`[DEBUG] Tool ${toolUse.name} returned ${events.length} events`)
                  } catch (toolError) {
                    console.error('Tool execution error:', toolError)
                    const errorContent = JSON.stringify({ error: 'Failed to search for events' })
                    toolResults.push({
                      type: 'tool_result',
                      tool_use_id: toolUse.id,
                      content: errorContent,
                      is_error: true,
                    })
                    toolResultsForHistory.push({
                      type: 'tool_result',
                      tool_use_id: toolUse.id,
                      content: errorContent,
                    })
                  }
                }
              }

              // Add tool results as user message (per Anthropic format)
              messages.push({
                role: 'user',
                content: toolResults,
              })
              newMessages.push({
                role: 'user',
                content: toolResultsForHistory,
              })

              // Add visual separator before Claude's response to tool results
              if (text) {
                sendEvent({ type: 'text', content: '\n\n' })
              }

              // Continue loop - Claude will process tool results
              continue
            }

            // Unexpected stop reason - break to avoid infinite loop
            console.log(`[DEBUG] Unexpected stop reason: ${stopReason}`)
            break
          }

          if (iterations >= MAX_ITERATIONS) {
            console.log('[DEBUG] Max iterations reached')
            sendEvent({
              type: 'text',
              content:
                '\n\nI apologize, but I need to stop here to avoid getting stuck in a loop. Please try rephrasing your question.',
            })
          }

          // Send history event so client can store full conversation for follow-ups
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
