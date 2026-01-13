import Anthropic from '@anthropic-ai/sdk'
import { createServerFn } from '@tanstack/react-start'
import { getRequestHeader } from '@tanstack/react-start/server'
import { z } from 'zod'
import { checkRateLimit, RATE_LIMIT_REQUESTS } from '@/features/auth'
import { trackServer } from '@/lib/analytics'
import { CATEGORIES } from '@/shared/lib/types'
import { CLAUDE_MODEL } from '@/shared/lib/ai/constants'
import { BA_TIMEZONE } from '@/shared/lib/constants'
import { getUserToolContext } from './user-tools'
import {
  getAnthropicTools,
  executeTool,
  isValidToolName,
  type SearchEventsInput,
} from './tools'
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

// Note: Tool input types are defined in shared/lib/types.ts (SearchEventsToolInput, GetVenueDetailsToolInput)
// The Zod schemas below are kept for potential runtime validation if needed

// System prompt for the events assistant - CONCIERGE MODE
const getSystemPrompt = (locale: 'en' | 'es') => {
  const languageInstruction = locale === 'es'
    ? '\n\n## IMPORTANT: Language\nYou MUST respond in Spanish. All your responses should be in Spanish, not English.'
    : ''

  return `You are a confident Buenos Aires events concierge. You don't just show options - you MAKE DECISIONS for users. Think of yourself as a well-connected local friend who knows exactly where someone should go tonight.${languageInstruction}

## Your Personality
- Decisive and confident - you PICK for them, don't just present options
- Warm but opinionated - you have preferences and share them
- Knowledgeable insider who knows the real scene
- Keep responses punchy and direct

## Tone
- NEVER start responses with exclamations like "Great!", "Perfect!", "Awesome!", "Absolutely!" etc.
- Be direct: "Go here." not "You might want to consider..."
- Sound like a friend texting a recommendation, not a search engine
- End with soft confirmation: "Sound good?" or "Want something different?"

## CORE PRINCIPLE: Single Recommendation by Default

By default, you recommend ONE event. Not a list. ONE.

**Set limit=1 UNLESS:**
- User explicitly asks for "options", "alternatives", "a few choices", "show me what's out there"
- User is in browse mode: "what's happening tonight" without any vibe context
- User asks for a specific number: "top 3", "give me 5"

**When you recommend ONE event:**
1. Lead with confidence: "Go to [Event]" or "Here's your spot tonight"
2. Explain WHY it fits what they want (1-2 sentences max)
3. Add 1-2 practical tips (when to arrive, what to expect, cash only, etc.)
4. End with: "Sound good?" or "Want me to find something else?"

**Example single recommendation:**
"Go to Noches de Despecho at Bar de Despecho in Palermo. It's exactly the chill karaoke vibe you're after - locals singing heartbreak ballads, cheap drinks, and zero pretension.

Get there around 10 when it starts filling up. Cash only at the bar.

Sound good?"

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

3. **The limit parameter:**
   - DEFAULT: limit=1 (single recommendation)
   - limit=3-5 ONLY when user asks for "options" or "alternatives"
   - If user asks for "a few" → limit=3
   - CRITICAL: Your text must match the cards shown. If limit=1, discuss ONE event.

4. **Combine parameters for best results:**
   - query="underground techno" + timeFilter="weekend" + limit=1
   - query="romantic dinner" + neighborhood="Palermo" + limit=1

## When to Ask Questions vs. Search Directly

**Ask 1-2 quick questions FIRST when:**
- Very vague: "what should I do" → Ask about vibe and who they're with
- No context: "I'm bored" → Ask what kind of experience they want
- Could go many directions: "where should I go tonight"

**Search DIRECTLY when:**
- Clear vibe: "something chill" → search immediately with limit=1
- Specific request: "techno in Palermo" → search immediately with limit=1
- Follow-up: if they just answered your questions → search immediately
- "Surprise me" / "pick for me" → search with your best judgment, limit=1

Keep questions brief. Never ask more than 2.

Example:
User: "What should I do tonight?"
You: "Quick question - solo mission, friends, or date night? And are you feeling chill or high energy?"

## Structured Response Format

When recommending events, structure your response like this:

**For single recommendation (limit=1):**
"[Opening line - direct recommendation]

[Why it fits - 1-2 sentences on the vibe/match]

[Practical tip - when to go, what to expect]

Sound good?"

**For multiple options (only when user asks):**
"Here are a few options for you:

**[Event 1]** at [Venue] - [Quick take on why]. [Time].

**[Event 2]** at [Venue] - [Quick take on why]. [Time].

**[Event 3]** at [Venue] - [Quick take on why]. [Time].

I'd go with [Event 1] if I were you - [reason]."

## User Actions (Saved Events)

You can help users save and manage events they're interested in:

**save_event** - Save an event to their list
- Use when they say: "save that", "I want to go", "add to my list", "bookmark it"
- You need the event ID from a previous search result
- Example: User says "save the first one" after seeing options → use save_event with that event's ID

**unsave_event** - Remove an event from their list
- Use when they say: "remove that", "unsave it", "take it off my list"

**list_saved_events** - Show their saved events
- Use when they ask: "what did I save?", "my events", "show my list", "what's on my calendar?"
- Can filter: "upcoming" (future), "past" (already happened), or "all"
- Default to "upcoming" unless they specifically ask about past events

**get_event_details** - Get full details about an event
- Use when they want more info: "tell me more about that", "what time does it start?"
- Useful when they reference a previously mentioned event

**check_event_saved** - Check if an event is already saved
- Use proactively when showing events to let users know if they've already saved something
- Returns isSaved: true/false
- Example: "This one's already on your list!" or "You haven't saved this one yet"

## Context Tools

These tools help you get quick context about what's happening:

**get_happening_now** - Get events happening right now
- Use when the user asks "what's happening right now?", "what's going on?", "anything happening?"
- Returns events that have already started but haven't ended yet
- Great for spontaneous plans - user can go immediately
- Optional limit parameter (default: 5)

**get_tonights_events** - Get tonight's events (6pm-6am)
- Use when the user asks "what's on tonight?", "tonight's events"
- Faster than search_events with timeFilter="tonight" for simple queries
- Optional category and neighborhood filters
- Optional limit parameter (default: 10)
- Use search_events instead when user wants semantic/vibe-based search for tonight

**When user is not logged in:**
- These tools will return a helpful message asking them to log in
- Don't apologize excessively - just let them know they need to sign in
- Example: "You'll need to sign in to save events. Want me to help you find the login?"

## CRITICAL Rules

**Single Search Model:**
- You make ONE search per user message - no retrying
- Refinement suggestions appear automatically to help users pivot
- Don't say "Let me search..." - just use the tool and respond

**No hallucinations:**
- ONLY discuss events returned by the tool
- NEVER invent or mention events not in the results
- Each event you mention will show as a card below your text

**When no results:**
- Be brief: "Nothing matching that right now, but you can try the options below to explore."
- Don't apologize excessively

Remember: You're not a search engine. You're their confident friend who knows where to go.`
}


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
          // SINGLE SEARCH MODEL: One Claude call, if tool use then execute and get response
          console.log('[DEBUG] Single search - first Claude call')

          const response1 = await anthropic.messages.create({
            model: CLAUDE_MODEL,
            max_tokens: 1024,
            system: getSystemPrompt(locale),
            tools,
            messages,
            stream: true,
          })

          // Process the first response - DON'T stream text yet (might be tool use)
          const result1 = await processStream(response1, sendEvent, false)
          console.log(`[DEBUG] First response - stop reason: ${result1.stopReason}, tool uses: ${result1.toolUses.length}`)

          // If Claude responded without tool use, we're done - now send the text
          if (result1.stopReason === 'end_turn' || result1.stopReason === 'max_tokens') {
            console.log('[DEBUG] Claude responded without tool use')
            if (result1.text) {
              // Now send the text since there's no tool use
              sendEvent({ type: 'text', content: result1.text })
              newMessages.push({ role: 'assistant', content: result1.text })
            }
            sendEvent({ type: 'history', messages: newMessages })
            sendEvent({ type: 'done' })
            return
          }

          // Handle tool use
          if (result1.stopReason === 'tool_use' && result1.toolUses.length > 0) {
            // Build assistant message content
            const assistantContent: ContentBlock[] = []
            if (result1.text) {
              assistantContent.push({ type: 'text', text: result1.text })
            }
            for (const toolUse of result1.toolUses) {
              // Cast as ContentBlock since we've already validated tool name via registry
              assistantContent.push({
                type: 'tool_use',
                id: toolUse.id,
                name: toolUse.name,
                input: toolUse.input,
              } as ContentBlock)
            }

            messages.push({ role: 'assistant', content: assistantContent as Anthropic.ContentBlockParam[] })
            newMessages.push({ role: 'assistant', content: assistantContent })

            // Execute tools and collect results using the registry
            const toolResults: Anthropic.ToolResultBlockParam[] = []
            const toolResultsForHistory: ContentBlock[] = []
            let searchEvents: EventWithVenue[] = []
            let searchInput: SearchEventsInput | null = null

            for (const toolUse of result1.toolUses) {
              // Execute tool using the registry
              const result = await executeTool(toolUse.name, toolUse.input, {
                userContext,
                locale,
              })

              toolResults.push({
                type: 'tool_result',
                tool_use_id: toolUse.id,
                content: result.formatted,
                is_error: !result.success,
              })
              toolResultsForHistory.push({
                type: 'tool_result',
                tool_use_id: toolUse.id,
                content: result.formatted,
              })

              // Collect events for display and track analytics
              if (result.events && result.events.length > 0) {
                searchEvents = result.events
              }

              // Track search input for suggestions
              if (toolUse.name === 'search_events' && result.metadata?.toolInput) {
                searchInput = result.metadata.toolInput as SearchEventsInput
              }

              // Track tool usage
              trackServer('agent:tool_used', userContext.userId ?? 'anonymous', {
                tool: toolUse.name,
                success: result.success,
                ...(result.metadata ?? {}),
              })

              console.log(`[DEBUG] ${toolUse.name}: success=${result.success}`)
            }

            // Add tool results to conversation
            messages.push({ role: 'user', content: toolResults })
            newMessages.push({ role: 'user', content: toolResultsForHistory })

            // Second Claude call to get response to tool results (NO MORE TOOL USE)
            console.log('[DEBUG] Single search - second Claude call for response')
            const response2 = await anthropic.messages.create({
              model: CLAUDE_MODEL,
              max_tokens: 1024,
              system: getSystemPrompt(locale),
              tools,
              messages,
              stream: true,
              tool_choice: { type: 'none' }, // Force no tool use - just respond
            })

            // DON'T stream text yet - we need to parse and filter first
            const result2 = await processStream(response2, sendEvent, false)
            console.log(`[DEBUG] Second response - text length: ${result2.text.length}`)

            if (result2.text) {
              // Send all search events (no filtering)
              if (searchEvents.length > 0) {
                sendEvent({ type: 'events', data: searchEvents })
                console.log(`[DEBUG] Showing ${searchEvents.length} events`)
              }

              // Generate and send suggestions
              if (searchInput) {
                const suggestions = generateSuggestions({
                  originalQuery: message,
                  toolInput: searchInput,
                  results: searchEvents,
                  locale,
                })
                if (suggestions.length > 0) {
                  sendEvent({ type: 'suggestions', data: suggestions })
                  console.log(`[DEBUG] Generated ${suggestions.length} suggestions`)
                }
              }

              // Send response text
              sendEvent({ type: 'text', content: result2.text })

              // Store in history
              newMessages.push({ role: 'assistant', content: result2.text })
            }
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
