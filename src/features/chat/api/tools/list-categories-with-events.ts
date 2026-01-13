/**
 * list_categories_with_events Tool
 *
 * Gets event categories that have events, with counts.
 * Use when user is undecided or exploring options.
 */

import { z } from 'zod'
import { addDays, setHours, startOfDay, getDay, getHours } from 'date-fns'
import { defineTool } from './types'
import { getNowInBA, baToUTC } from './utils'
import { NEIGHBORHOODS } from '@/shared/lib/types'

// ============================================================================
// INPUT SCHEMA
// ============================================================================

export const listCategoriesInputSchema = z.object({
  timeFilter: z
    .enum(['tonight', 'tomorrow', 'weekend', 'week'])
    .optional()
    .describe('Time period to check. Defaults to all upcoming events if not specified.'),
  neighborhood: z
    .string()
    .optional()
    .describe('Filter by neighborhood to see what categories are available in a specific area.'),
})

export type ListCategoriesInput = z.infer<typeof listCategoriesInputSchema>

// ============================================================================
// HELPER: Calculate time range
// ============================================================================

function getTimeRange(timeFilter?: string) {
  const now = getNowInBA()
  const currentHour = getHours(now)

  let startsAfter = now
  let startsBefore: Date | undefined

  if (timeFilter === 'tonight') {
    if (currentHour < 6) {
      startsAfter = now
      startsBefore = setHours(startOfDay(now), 6)
    } else {
      startsAfter = setHours(startOfDay(now), 18)
      startsBefore = setHours(startOfDay(addDays(now, 1)), 6)
    }
  } else if (timeFilter === 'tomorrow') {
    startsAfter = startOfDay(addDays(now, 1))
    startsBefore = startOfDay(addDays(now, 2))
  } else if (timeFilter === 'weekend') {
    const dayOfWeek = getDay(now)
    if (dayOfWeek === 6 || dayOfWeek === 0) {
      const daysUntilMonday = dayOfWeek === 6 ? 2 : 1
      startsAfter = now
      startsBefore = startOfDay(addDays(now, daysUntilMonday))
    } else {
      const daysUntilSaturday = 6 - dayOfWeek
      startsAfter = startOfDay(addDays(now, daysUntilSaturday))
      startsBefore = startOfDay(addDays(startsAfter, 2))
    }
  } else if (timeFilter === 'week') {
    startsAfter = now
    startsBefore = addDays(now, 7)
  }

  return { startsAfter, startsBefore }
}

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export const listCategoriesWithEventsTool = defineTool({
  name: 'list_categories_with_events',

  description: `Get event categories that have events, with counts.
Use when the user asks "what kinds of events are there?", "what can I do?", is undecided, or wants to explore options before committing to a search.
Can filter by time period and neighborhood.`,

  inputSchema: listCategoriesInputSchema,

  anthropicSchema: {
    type: 'object',
    properties: {
      timeFilter: {
        type: 'string',
        enum: ['tonight', 'tomorrow', 'weekend', 'week'],
        description: 'Time period to check. Defaults to all upcoming events if not specified.',
      },
      neighborhood: {
        type: 'string',
        description: 'Filter by neighborhood to see what categories are available in a specific area.',
      },
    },
  },

  requiresAuth: false,

  execute: async (input) => {
    try {
      const { createSupabaseServerClient } = await import('@/shared/lib/db/server')
      const client = createSupabaseServerClient()

      const { startsAfter, startsBefore } = getTimeRange(input.timeFilter)

      // Build query - use events_with_venues if neighborhood filter is provided
      let data: { categories: string[] | null }[] | null

      if (input.neighborhood) {
        // Match neighborhood case-insensitively
        const match = NEIGHBORHOODS.find(
          n => n.toLowerCase() === input.neighborhood?.toLowerCase()
        )

        let query = client
          .from('events_with_venues')
          .select('categories')
          .eq('status', 'scheduled')
          .gte('starts_at', baToUTC(startsAfter))

        if (match) {
          query = query.eq('venue_neighborhood', match)
        }

        if (startsBefore) {
          query = query.lt('starts_at', baToUTC(startsBefore))
        }

        const result = await query
        data = result.data
      } else {
        let query = client
          .from('events')
          .select('categories')
          .eq('status', 'scheduled')
          .gte('starts_at', baToUTC(startsAfter))

        if (startsBefore) {
          query = query.lt('starts_at', baToUTC(startsBefore))
        }

        const result = await query
        data = result.data
      }

      // Count events by category
      const counts: Record<string, number> = {}
      for (const event of data || []) {
        const categories = event.categories || []
        for (const cat of categories) {
          counts[cat] = (counts[cat] || 0) + 1
        }
      }

      // Sort by count (descending)
      const sorted = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .map(([category, count]) => ({ category, eventCount: count }))

      const result = {
        timeFilter: input.timeFilter ?? 'upcoming',
        neighborhood: input.neighborhood ?? null,
        totalCategories: sorted.length,
        categories: sorted,
      }

      console.log(`[DEBUG] list_categories_with_events: found ${sorted.length} categories, filter=${input.timeFilter ?? 'upcoming'}`)

      return {
        success: true,
        formatted: JSON.stringify(result),
        metadata: {
          categoryCount: sorted.length,
          timeFilter: input.timeFilter,
          neighborhood: input.neighborhood,
        },
      }
    } catch (error) {
      console.error('[list_categories_with_events] Error:', error)
      return {
        success: false,
        formatted: JSON.stringify({ error: 'Failed to get categories' }),
        error: 'execution_error',
      }
    }
  },
})
