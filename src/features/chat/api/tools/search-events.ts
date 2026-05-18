/**
 * search_events Tool
 *
 * The main event search tool with semantic and filter-based search.
 * Supports natural language queries, time filters, categories, neighborhoods, and price filters.
 * Automatically applies user preferences as defaults when no explicit filters are provided.
 */

import { z } from 'zod'
import { addDays, setHours, startOfDay, getDay, getHours } from 'date-fns'
import { defineTool } from './types'
import { searchEventsWithFilters, hybridEventSearch } from '@/shared/lib/db/client'
import { CATEGORIES, NEIGHBORHOODS } from '@/shared/lib/types'
import type { EventFilters, Neighborhood } from '@/shared/lib/types'
import { getNowInBA, baToUTC, formatEventsToolResult, serializeEventsForChatPayload } from './utils'
import { logger } from '@/shared/lib/logger'

// ============================================================================
// HELPER: Get user preferences for search defaults
// ============================================================================

interface UserPreferencesForSearch {
  preferredCategories: string[]
  preferredNeighborhoods: string[]
}

async function getUserPreferencesForSearch(userId: string | null): Promise<UserPreferencesForSearch | null> {
  if (!userId) return null

  try {
    const { createSupabaseServerClient } = await import('@/shared/lib/db/server')
    const client = createSupabaseServerClient()

    const { data, error } = await client
      .from('user_preferences')
      .select('preferred_categories, preferred_neighborhoods')
      .eq('user_id', userId)
      .maybeSingle()

    if (error || !data) {
      return null
    }

    return {
      preferredCategories: data.preferred_categories || [],
      preferredNeighborhoods: data.preferred_neighborhoods || [],
    }
  } catch (err) {
    logger.error('[search_events] Error fetching user preferences', { error: String(err) })
    return null
  }
}

// ============================================================================
// INPUT SCHEMA
// ============================================================================

export const searchEventsInputSchema = z.object({
  query: z.string().optional().describe(
    `Natural language search query for semantic matching. Use for vibe-based or descriptive searches like "romantic date spot", "high energy dance party", "relaxed afternoon activity", "underground warehouse vibes".`
  ),
  categories: z.array(z.string()).optional().describe(
    `Event categories to filter by. Options: ${CATEGORIES.join(', ')}`
  ),
  neighborhood: z.string().optional().describe('Buenos Aires neighborhood to filter by'),
  isFree: z.boolean().optional().describe('Set to true to only show free events'),
  maxPrice: z.number().optional().describe('Maximum price in ARS'),
  timeFilter: z
    .enum(['tonight', 'tomorrow', 'weekend', 'week'])
    .optional()
    .describe('Time period filter. tonight = today evening, tomorrow = next day, weekend = Saturday/Sunday, week = next 7 days'),
  limit: z.number().optional().describe(
    'Maximum number of events to return and display (1-10). Use this to match the user\'s request - e.g., if they ask for "top 3 events", set limit to 3.'
  ),
})

export type SearchEventsInput = z.infer<typeof searchEventsInputSchema>

// ============================================================================
// HELPER: Convert input to EventFilters
// ============================================================================

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

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export const searchEventsTool = defineTool({
  name: 'search_events',

  description: `Search for events in Buenos Aires using semantic search and/or filters.
Use the 'query' parameter for natural language searches describing the desired experience
(e.g., "romantic jazz night", "underground techno party", "chill outdoor activities").
Use other parameters for specific requirements. Combine both for best results.`,

  inputSchema: searchEventsInputSchema,

  anthropicSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: `Natural language search query for semantic matching. Use for vibe-based or descriptive searches like "romantic date spot", "high energy dance party", "relaxed afternoon activity", "underground warehouse vibes".`,
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

  requiresAuth: false,

  execute: async (input, context) => {
    try {
      const filters = toolInputToFilters(input)
      const limit = input.limit ?? 1 // Default to 1 - concierge mode makes single recommendations

      // Apply user preferences as defaults when no explicit filters provided
      let appliedPreferences = false
      if (context.userContext.isAuthenticated && context.userContext.userId) {
        const preferences = await getUserPreferencesForSearch(context.userContext.userId)

        if (preferences) {
          // Apply preferred categories if user didn't specify any
          if (!input.categories?.length && preferences.preferredCategories.length > 0) {
            filters.categories = preferences.preferredCategories
            appliedPreferences = true
            logger.info('[search_events] Applied user preferred categories', {
              categories: preferences.preferredCategories,
              userId: context.userContext.userId,
            })
          }

          // Apply first preferred neighborhood if user didn't specify one
          // Only apply if no semantic query (to avoid over-constraining vibe searches)
          if (!input.neighborhood && !input.query && preferences.preferredNeighborhoods.length > 0) {
            const preferredNeighborhood = preferences.preferredNeighborhoods[0]
            const match = NEIGHBORHOODS.find(
              n => n.toLowerCase() === preferredNeighborhood.toLowerCase()
            ) as Neighborhood | undefined

            if (match) {
              filters.neighborhood = match
              appliedPreferences = true
              logger.info('[search_events] Applied user preferred neighborhood', {
                neighborhood: match,
                userId: context.userContext.userId,
              })
            }
          }
        }
      }

      logger.debug('[search_events] Search parameters', {
        input,
        filters,
        limit,
        appliedPreferences,
        currentTime: new Date().toISOString(),
        baTime: getNowInBA().toISOString(),
      })

      let results

      // If semantic query provided, use hybrid search
      if (input.query && input.query.trim()) {
        logger.debug('[search_events] Using hybrid search', { query: input.query })
        results = await hybridEventSearch(input.query, filters, limit)
      } else {
        // Otherwise, use filter-only search
        logger.debug('[search_events] Using filter-only search')
        results = await searchEventsWithFilters(filters, limit)
      }

      logger.info('[search_events] Search completed', {
        resultCount: results.length,
        appliedPreferences,
        hasQuery: !!input.query,
      })

      return {
        success: true,
        events: serializeEventsForChatPayload(results),
        formatted: formatEventsToolResult(results),
        metadata: {
          resultCount: results.length,
          hasQuery: !!input.query,
          hasFilters: !!(input.categories || input.neighborhood || input.timeFilter),
          appliedPreferences,
          // Include input for refinement suggestion generation
          toolInput: input,
        },
      }
    } catch (error) {
      logger.error('[search_events] Search failed', { error: String(error) })
      return {
        success: false,
        formatted: JSON.stringify({ error: 'Failed to search for events' }),
        error: 'execution_error',
      }
    }
  },
})
