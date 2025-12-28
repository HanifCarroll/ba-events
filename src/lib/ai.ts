import Anthropic from '@anthropic-ai/sdk'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { toZonedTime, fromZonedTime } from 'date-fns-tz'
import { addDays, setHours, startOfDay, getDay, getHours, format } from 'date-fns'
import { searchEventsWithFilters } from './supabase'
import { CATEGORIES, VIBES, NEIGHBORHOODS } from './types'
import type { EventWithVenue, EventFilters } from './types'

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

// Message schema for conversation history
const messageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
})

const chatRequestSchema = z.object({
  message: z.string(),
  history: z.array(messageSchema).default([]),
})

// Tool input schema for search_events
const searchEventsInputSchema = z.object({
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

## How to Help Users
1. When users ask about events, use the search_events tool to find relevant options
2. Interpret natural language queries: "tonight" = today evening, "this weekend" = Saturday/Sunday
3. Suggest filters based on context (e.g., if they mention "underground" → add that vibe)
4. After showing events, offer to refine the search if they want something different

## Response Format
- Start with a brief, friendly intro
- Present the events (they will be displayed as cards automatically)
- Offer helpful follow-up suggestions if relevant

Remember: You're helping people have a great time in Buenos Aires!`

// Tool definition for Claude
const tools: Anthropic.Tool[] = [
  {
    name: 'search_events',
    description: 'Search for events in Buenos Aires. Use this whenever users ask about events, what to do, or activities in the city.',
    input_schema: {
      type: 'object' as const,
      properties: {
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
  const results = await searchEventsWithFilters(filters)
  console.log('[DEBUG] Results count:', results.length)
  return results
}

// Stream event types
export type StreamEvent =
  | { type: 'text'; content: string }
  | { type: 'events'; data: EventWithVenue[] }
  | { type: 'error'; message: string }
  | { type: 'done' }

// Server function for chat
export const chat = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => chatRequestSchema.parse(data))
  .handler(async ({ data }): Promise<ReadableStream<Uint8Array>> => {
    const { message, history } = data
    const encoder = new TextEncoder()

    // Convert history to Anthropic format
    const messages: Anthropic.MessageParam[] = [
      ...history.map(msg => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      })),
      { role: 'user' as const, content: message },
    ]

    return new ReadableStream({
      async start(controller) {
        const sendEvent = (event: StreamEvent) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        }

        try {
          // First API call - may result in tool use
          let response = await anthropic.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 1024,
            system: SYSTEM_PROMPT,
            tools,
            messages,
            stream: true,
          })

          let fullText = ''
          let toolUseBlock: { id: string; name: string; input: string } | null = null
          let currentToolInput = ''

          // Process the stream
          for await (const event of response) {
            if (event.type === 'content_block_start') {
              if (event.content_block.type === 'tool_use') {
                toolUseBlock = {
                  id: event.content_block.id,
                  name: event.content_block.name,
                  input: '',
                }
              }
            } else if (event.type === 'content_block_delta') {
              if (event.delta.type === 'text_delta') {
                fullText += event.delta.text
                sendEvent({ type: 'text', content: event.delta.text })
              } else if (event.delta.type === 'input_json_delta') {
                currentToolInput += event.delta.partial_json
              }
            } else if (event.type === 'content_block_stop') {
              if (toolUseBlock) {
                toolUseBlock.input = currentToolInput
              }
            } else if (event.type === 'message_stop') {
              // Check if we need to handle tool use
              if (toolUseBlock && toolUseBlock.name === 'search_events') {
                try {
                  const input = JSON.parse(toolUseBlock.input) as SearchEventsInput
                  const events = await executeSearchEvents(input)

                  // Send events to client
                  sendEvent({ type: 'events', data: events })

                  // Continue conversation with tool result
                  const continuationMessages: Anthropic.MessageParam[] = [
                    ...messages,
                    {
                      role: 'assistant' as const,
                      content: [
                        ...(fullText ? [{ type: 'text' as const, text: fullText }] : []),
                        {
                          type: 'tool_use' as const,
                          id: toolUseBlock.id,
                          name: toolUseBlock.name,
                          input: JSON.parse(toolUseBlock.input),
                        },
                      ],
                    },
                    {
                      role: 'user' as const,
                      content: [
                        {
                          type: 'tool_result' as const,
                          tool_use_id: toolUseBlock.id,
                          content: JSON.stringify({
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
                          }),
                        },
                      ],
                    },
                  ]

                  // Get Claude's response after seeing the events
                  const continuationResponse = await anthropic.messages.create({
                    model: 'claude-haiku-4-5-20251001',
                    max_tokens: 1024,
                    system: SYSTEM_PROMPT,
                    tools,
                    messages: continuationMessages,
                    stream: true,
                  })

                  for await (const contEvent of continuationResponse) {
                    if (contEvent.type === 'content_block_delta') {
                      if (contEvent.delta.type === 'text_delta') {
                        sendEvent({ type: 'text', content: contEvent.delta.text })
                      }
                    }
                  }
                } catch (toolError) {
                  console.error('Tool execution error:', toolError)
                  sendEvent({
                    type: 'error',
                    message: 'Failed to search for events. Please try again.',
                  })
                }
              }
            }
          }

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
