/**
 * list_neighborhoods_with_events Tool
 *
 * Gets neighborhoods that have events, with event counts.
 * Use when user asks "where's the action?" or needs help choosing an area.
 */

import { z } from 'zod'
import { addDays, setHours, startOfDay, getDay, getHours } from 'date-fns'
import { defineTool } from './types'
import { getNowInBA, baToUTC } from './utils'

// ============================================================================
// INPUT SCHEMA
// ============================================================================

export const listNeighborhoodsInputSchema = z.object({
  timeFilter: z
    .enum(['tonight', 'tomorrow', 'weekend', 'week'])
    .optional()
    .describe('Time period to check. Defaults to all upcoming events if not specified.'),
})

export type ListNeighborhoodsInput = z.infer<typeof listNeighborhoodsInputSchema>

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

export const listNeighborhoodsWithEventsTool = defineTool({
  name: 'list_neighborhoods_with_events',

  description: `Get neighborhoods that have events, with event counts.
Use when the user asks "where's the action?", "which areas have stuff going on?", "where should I go?", or needs help choosing a neighborhood.
Returns neighborhoods sorted by event count.`,

  inputSchema: listNeighborhoodsInputSchema,

  anthropicSchema: {
    type: 'object',
    properties: {
      timeFilter: {
        type: 'string',
        enum: ['tonight', 'tomorrow', 'weekend', 'week'],
        description: 'Time period to check. Defaults to all upcoming events if not specified.',
      },
    },
  },

  requiresAuth: false,

  execute: async (input) => {
    try {
      const { createSupabaseServerClient } = await import('@/shared/lib/db/server')
      const client = createSupabaseServerClient()

      const { startsAfter, startsBefore } = getTimeRange(input.timeFilter)

      // Query events with venues to get neighborhood data
      let query = client
        .from('events_with_venues')
        .select('venue_neighborhood')
        .eq('status', 'scheduled')
        .gte('starts_at', baToUTC(startsAfter))

      if (startsBefore) {
        query = query.lt('starts_at', baToUTC(startsBefore))
      }

      const { data, error } = await query

      if (error) {
        console.error('[list_neighborhoods_with_events] Error:', error)
        return {
          success: false,
          formatted: JSON.stringify({ error: 'Failed to get neighborhoods' }),
          error: 'execution_error',
        }
      }

      // Count events by neighborhood
      const counts: Record<string, number> = {}
      for (const event of data || []) {
        const neighborhood = event.venue_neighborhood
        if (neighborhood) {
          counts[neighborhood] = (counts[neighborhood] || 0) + 1
        }
      }

      // Sort by count (descending)
      const sorted = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .map(([neighborhood, count]) => ({ neighborhood, eventCount: count }))

      const result = {
        timeFilter: input.timeFilter ?? 'upcoming',
        totalNeighborhoods: sorted.length,
        neighborhoods: sorted,
      }

      console.log(`[DEBUG] list_neighborhoods_with_events: found ${sorted.length} neighborhoods, filter=${input.timeFilter ?? 'upcoming'}`)

      return {
        success: true,
        formatted: JSON.stringify(result),
        metadata: {
          neighborhoodCount: sorted.length,
          timeFilter: input.timeFilter,
        },
      }
    } catch (error) {
      console.error('[list_neighborhoods_with_events] Error:', error)
      return {
        success: false,
        formatted: JSON.stringify({ error: 'Failed to get neighborhoods' }),
        error: 'execution_error',
      }
    }
  },
})
