import Anthropic from '@anthropic-ai/sdk'
import { createServerFn } from '@tanstack/react-start'
import { getRequestHeader } from '@tanstack/react-start/server'
import { z } from 'zod'
import { toZonedTime, fromZonedTime } from 'date-fns-tz'
import { addDays, setHours, startOfDay, getDay, getHours, format } from 'date-fns'
import { searchEventsWithFilters, hybridEventSearch, getVenueById, searchVenuesByName } from '@/shared/lib/db/client'
import { checkRateLimit, RATE_LIMIT_REQUESTS } from '@/features/auth'
import { CATEGORIES, NEIGHBORHOODS } from '@/shared/lib/types'
import { CLAUDE_MODEL } from '@/shared/lib/ai/constants'
import { BA_TIMEZONE } from '@/shared/lib/constants'
import type {
  EventWithVenue,
  EventFilters,
  APIMessage,
  ContentBlock,
  Venue,
  RefinementSuggestion,
  StreamEvent,
  SearchEventsToolInput,
  GetVenueDetailsToolInput,
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
    description: `Get detailed information about a specific venue, including website, Instagram, and address. Use this when users ask about a venue's website, contact info, or want more details about where an event is held.`,
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
function toolInputToFilters(input: SearchEventsToolInput): EventFilters {
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
async function executeGetVenueDetails(input: GetVenueDetailsToolInput): Promise<Venue | null> {
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
    },
  })
}

// Execute the search_events tool
async function executeSearchEvents(input: SearchEventsToolInput): Promise<EventWithVenue[]> {
  const filters = toolInputToFilters(input)
  const limit = input.limit ?? 1 // Default to 1 - concierge mode makes single recommendations
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

// Format tool result for Claude
function formatToolResult(events: EventWithVenue[]): string {
  return JSON.stringify({
    count: events.length,
    events: events.slice(0, 10).map(e => ({
      id: e.id, // Include ID for filtering
      name: e.name,
      description: e.description_en,
      hasDetails: !!(e.description_en || e.description_es), // Flag for events with full info
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

// Generate refinement suggestions based on search context
interface SuggestionContext {
  originalQuery: string
  toolInput: SearchEventsToolInput
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

// Type for parsed tool use from stream - discriminated union based on tool name
interface SearchEventsToolUse {
  id: string
  name: 'search_events'
  input: SearchEventsToolInput
}

interface GetVenueDetailsToolUse {
  id: string
  name: 'get_venue_details'
  input: GetVenueDetailsToolInput
}

type ParsedToolUse = SearchEventsToolUse | GetVenueDetailsToolUse

/**
 * Type guard for search_events tool input.
 * Validates that the input has the expected shape for search_events.
 */
function isSearchEventsInput(input: unknown): input is SearchEventsToolInput {
  if (typeof input !== 'object' || input === null) {
    return false
  }
  const obj = input as Record<string, unknown>
  // All fields are optional, but if present they should have correct types
  if (obj.query !== undefined && typeof obj.query !== 'string') return false
  if (obj.categories !== undefined && !Array.isArray(obj.categories)) return false
  if (obj.vibes !== undefined && !Array.isArray(obj.vibes)) return false
  if (obj.neighborhoods !== undefined && !Array.isArray(obj.neighborhoods)) return false
  if (obj.neighborhood !== undefined && typeof obj.neighborhood !== 'string') return false
  if (obj.dateFrom !== undefined && typeof obj.dateFrom !== 'string') return false
  if (obj.dateTo !== undefined && typeof obj.dateTo !== 'string') return false
  if (obj.priceMin !== undefined && typeof obj.priceMin !== 'number') return false
  if (obj.priceMax !== undefined && typeof obj.priceMax !== 'number') return false
  if (obj.maxPrice !== undefined && typeof obj.maxPrice !== 'number') return false
  if (obj.isFree !== undefined && typeof obj.isFree !== 'boolean') return false
  if (obj.timeFilter !== undefined && !['tonight', 'tomorrow', 'weekend', 'week'].includes(obj.timeFilter as string)) return false
  if (obj.limit !== undefined && typeof obj.limit !== 'number') return false
  return true
}

/**
 * Type guard for get_venue_details tool input.
 * Validates that the input has the expected shape for get_venue_details.
 */
function isGetVenueDetailsInput(input: unknown): input is GetVenueDetailsToolInput {
  if (typeof input !== 'object' || input === null) {
    return false
  }
  const obj = input as Record<string, unknown>
  // At least one of venueId or venueName should be present
  if (obj.venueId !== undefined && typeof obj.venueId !== 'string') return false
  if (obj.venueName !== undefined && typeof obj.venueName !== 'string') return false
  return obj.venueId !== undefined || obj.venueName !== undefined
}

/**
 * Type guard for search_events tool - narrows ParsedToolUse to SearchEventsToolUse
 */
function isSearchEventsTool(toolUse: ParsedToolUse): toolUse is SearchEventsToolUse {
  return toolUse.name === 'search_events'
}

/**
 * Type guard for get_venue_details tool - narrows ParsedToolUse to GetVenueDetailsToolUse
 */
function isGetVenueDetailsTool(toolUse: ParsedToolUse): toolUse is GetVenueDetailsToolUse {
  return toolUse.name === 'get_venue_details'
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
        const rawInput: unknown = JSON.parse(currentToolUse.inputJson)

        // Use type guards to validate and type the input
        if (currentToolUse.name === 'search_events' && isSearchEventsInput(rawInput)) {
          toolUses.push({
            id: currentToolUse.id,
            name: 'search_events',
            input: rawInput,
          })
        } else if (currentToolUse.name === 'get_venue_details' && isGetVenueDetailsInput(rawInput)) {
          toolUses.push({
            id: currentToolUse.id,
            name: 'get_venue_details',
            input: rawInput,
          })
        } else {
          console.warn(`[DEBUG] Invalid tool input for ${currentToolUse.name}:`, rawInput)
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
            // Build assistant message content - ToolUseBlock already has proper discriminated union type
            const assistantContent: ContentBlock[] = []
            if (result1.text) {
              assistantContent.push({ type: 'text', text: result1.text })
            }
            for (const toolUse of result1.toolUses) {
              // Type-safe building of ToolUseBlock based on tool name
              if (isSearchEventsTool(toolUse)) {
                assistantContent.push({
                  type: 'tool_use',
                  id: toolUse.id,
                  name: 'search_events',
                  input: toolUse.input,
                })
              } else if (isGetVenueDetailsTool(toolUse)) {
                assistantContent.push({
                  type: 'tool_use',
                  id: toolUse.id,
                  name: 'get_venue_details',
                  input: toolUse.input,
                })
              }
            }

            messages.push({ role: 'assistant', content: assistantContent as Anthropic.ContentBlockParam[] })
            newMessages.push({ role: 'assistant', content: assistantContent })

            // Execute tools and collect results
            const toolResults: Anthropic.ToolResultBlockParam[] = []
            const toolResultsForHistory: ContentBlock[] = []
            let searchEvents: EventWithVenue[] = []
            let searchInput: SearchEventsToolInput | null = null

            for (const toolUse of result1.toolUses) {
              // Use type guards for proper type narrowing instead of assertions
              if (isSearchEventsTool(toolUse)) {
                try {
                  searchInput = toolUse.input
                  const events = await executeSearchEvents(toolUse.input)
                  searchEvents = events

                  // DON'T send events yet - wait for Claude to filter them

                  const resultContent = formatToolResult(events)
                  toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: resultContent })
                  toolResultsForHistory.push({ type: 'tool_result', tool_use_id: toolUse.id, content: resultContent })

                  console.log(`[DEBUG] search_events returned ${events.length} events`)
                } catch (toolError) {
                  console.error('Tool execution error:', toolError)
                  const errorContent = JSON.stringify({ error: 'Failed to search for events' })
                  toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: errorContent, is_error: true })
                  toolResultsForHistory.push({ type: 'tool_result', tool_use_id: toolUse.id, content: errorContent })
                }
              } else if (isGetVenueDetailsTool(toolUse)) {
                try {
                  const venue = await executeGetVenueDetails(toolUse.input)

                  const resultContent = formatVenueResult(venue)
                  toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: resultContent })
                  toolResultsForHistory.push({ type: 'tool_result', tool_use_id: toolUse.id, content: resultContent })

                  console.log(`[DEBUG] get_venue_details returned: ${venue?.name ?? 'not found'}`)
                } catch (toolError) {
                  console.error('Tool execution error:', toolError)
                  const errorContent = JSON.stringify({ error: 'Failed to get venue details' })
                  toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: errorContent, is_error: true })
                  toolResultsForHistory.push({ type: 'tool_result', tool_use_id: toolUse.id, content: errorContent })
                }
              }
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
