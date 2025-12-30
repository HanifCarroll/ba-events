import Anthropic from '@anthropic-ai/sdk'
import { createServerFn } from '@tanstack/react-start'
import { getRequestHeader } from '@tanstack/react-start/server'
import { z } from 'zod'
import { toZonedTime, fromZonedTime } from 'date-fns-tz'
import { addDays, setHours, startOfDay, getDay, getHours, format } from 'date-fns'
import { searchEventsWithFilters, hybridEventSearch, getVenueById, searchVenuesByName } from './supabase'
import { checkRateLimit } from './rate-limit'
import { CATEGORIES, NEIGHBORHOODS } from './types'
import type { EventWithVenue, EventFilters, APIMessage, ContentBlock, Venue } from './types'

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

// Tool input schema for search_events
const searchEventsInputSchema = z.object({
  query: z.string().optional(),
  categories: z.array(z.string()).optional(),
  neighborhood: z.string().optional(),
  isFree: z.boolean().optional(),
  maxPrice: z.number().optional(),
  timeFilter: z.enum(['tonight', 'tomorrow', 'weekend', 'week']).optional(),
  limit: z.number().min(1).max(10).optional(),
})

type SearchEventsInput = z.infer<typeof searchEventsInputSchema>

// Tool input schema for get_venue_details
const getVenueDetailsInputSchema = z.object({
  venueId: z.string().optional(),
  venueName: z.string().optional(),
})

type GetVenueDetailsInput = z.infer<typeof getVenueDetailsInputSchema>

// System prompt for the events assistant
const getSystemPrompt = (locale: 'en' | 'es') => {
  const languageInstruction = locale === 'es'
    ? '\n\n## IMPORTANT: Language\nYou MUST respond in Spanish. All your responses should be in Spanish, not English.'
    : ''

  return `You are a friendly and knowledgeable Buenos Aires events assistant. You help users discover events happening in the city - from techno nights and jazz bars to tango milongas, art exhibitions, and food markets.${languageInstruction}

## Your Personality
- Warm and enthusiastic about Buenos Aires nightlife and culture
- Knowledgeable about different neighborhoods (barrios) and their vibes
- Helpful without being pushy
- Keep responses concise but informative

## Available Categories
${CATEGORIES.join(', ')}

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
   - categories: when user explicitly mentions them

3. **Use 'limit' to control how many events are returned:**
   - If user asks for "top 3 events" → set limit=3
   - If user asks for "5 recommendations" → set limit=5
   - If user asks for "a few options" → set limit=3-4
   - If user doesn't specify → default to 5-6 events
   - IMPORTANT: The limit controls how many event cards are displayed. Always match it to what the user asked for.

4. **Combine parameters for best results:**
   - query="underground techno" + timeFilter="weekend" + limit=3
   - query="romantic dinner" + neighborhood="Palermo" + limit=5

## When to Use Each Approach

- Vibe/mood requests ("something chill", "high energy") → use query parameter
- Specific filters ("free events in Palermo this weekend") → use filter parameters
- Both ("underground techno tonight") → combine query + timeFilter
- Numbered requests ("top 3", "give me 5") → always set the limit parameter to match

## Response Format

**IMPORTANT - Do NOT narrate your tool use:**
- Do NOT say things like "I'll search for events..." or "Let me look that up..."
- Just use the search_events tool silently, then respond naturally with results
- If there are no results, go straight to "I didn't find any events matching..." and offer alternatives

**When presenting results:**
- Start with a brief, friendly summary of what you found
- Events will be displayed as cards automatically - no need to list them in detail
- Offer helpful follow-up suggestions if relevant

**When there are no results:**
- Don't apologize excessively
- Immediately offer alternatives (different time period, related categories, or broader search)
- Keep it positive and helpful

Remember: You're helping people have a great time in Buenos Aires!`
}

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
        limit: {
          type: 'number',
          description: 'Maximum number of events to return and display (1-10). Use this to match the user\'s request - e.g., if they ask for "top 3 events", set limit to 3.',
        },
      },
    },
  },
  {
    name: 'get_venue_details',
    description: `Get detailed information about a specific venue, including website, Instagram, capacity, and address. Use this when users ask about a venue's website, contact info, or want more details about where an event is held.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        venueId: {
          type: 'string',
          description: 'The venue ID (if known from a previous event search)',
        },
        venueName: {
          type: 'string',
          description: 'The name of the venue to search for',
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

// Execute the get_venue_details tool
async function executeGetVenueDetails(input: GetVenueDetailsInput): Promise<Venue | null> {
  console.log('[DEBUG] Get venue details input:', JSON.stringify(input))

  // If we have a venue ID, fetch directly
  if (input.venueId) {
    try {
      const venue = await getVenueById(input.venueId)
      return venue
    } catch (error) {
      console.log('[DEBUG] Venue not found by ID:', input.venueId)
      return null
    }
  }

  // Otherwise search by name
  if (input.venueName) {
    const venues = await searchVenuesByName(input.venueName)
    if (venues.length > 0) {
      // Return the best match (first result)
      return venues[0]
    }
  }

  return null
}

// Format venue result for Claude
function formatVenueResult(venue: Venue | null): string {
  if (!venue) {
    return JSON.stringify({ found: false, message: 'Venue not found' })
  }

  return JSON.stringify({
    found: true,
    venue: {
      name: venue.name,
      neighborhood: venue.neighborhood,
      address: venue.address,
      website: venue.website,
      instagram: venue.instagram_handle,
      capacity: venue.capacity,
      type: venue.type,
    },
  })
}

// Execute the search_events tool
async function executeSearchEvents(input: SearchEventsInput): Promise<EventWithVenue[]> {
  const filters = toolInputToFilters(input)
  const limit = input.limit ?? 10 // Default to 10 if not specified
  console.log('[DEBUG] Tool input:', JSON.stringify(input))
  console.log('[DEBUG] Filters:', JSON.stringify(filters))
  console.log('[DEBUG] Limit:', limit)
  console.log('[DEBUG] Current time:', new Date().toISOString())
  console.log('[DEBUG] BA time:', getNowInBA().toISOString())

  let results: EventWithVenue[]

  // If semantic query provided, use hybrid search
  if (input.query && input.query.trim()) {
    console.log('[DEBUG] Using hybrid search with query:', input.query)
    results = await hybridEventSearch(input.query, filters, limit)
  } else {
    // Otherwise, use filter-only search
    console.log('[DEBUG] Using filter-only search')
    results = await searchEventsWithFilters(filters, limit)
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
      description: e.description_en,
      venue: e.venue_name,
      venueAddress: e.venue_address,
      neighborhood: e.venue_neighborhood,
      dateTime: formatInBA(e.starts_at),
      endsAt: e.ends_at ? formatInBA(e.ends_at) : null,
      price: e.is_free ? 'Free' : e.price ? `$${e.price} ARS` : 'TBA',
      categories: e.categories,
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
  const message = `You've reached the rate limit (10 requests per hour). Please try again after ${resetDate.toLocaleTimeString()}.`

  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message })}\n\n`))
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`))
      controller.close()
    },
  })
}

// Server function for chat with proper agentic loop
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
              system: getSystemPrompt(locale),
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
                } else if (toolUse.name === 'get_venue_details') {
                  try {
                    const input = toolUse.input as GetVenueDetailsInput
                    const venue = await executeGetVenueDetails(input)

                    const resultContent = formatVenueResult(venue)
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

                    console.log(`[DEBUG] Tool ${toolUse.name} returned venue: ${venue?.name ?? 'not found'}`)
                  } catch (toolError) {
                    console.error('Tool execution error:', toolError)
                    const errorContent = JSON.stringify({ error: 'Failed to get venue details' })
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
