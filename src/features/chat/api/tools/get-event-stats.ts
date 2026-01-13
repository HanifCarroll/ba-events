/**
 * get_event_stats Tool
 *
 * Gets statistics about available events in the system.
 * Useful for giving users a sense of what's available.
 */

import { z } from 'zod'
import { addDays, setHours, startOfDay, getDay, getHours } from 'date-fns'
import { defineTool } from './types'
import { getNowInBA, baToUTC } from './utils'

// ============================================================================
// INPUT SCHEMA
// ============================================================================

export const getEventStatsInputSchema = z.object({})

export type GetEventStatsInput = z.infer<typeof getEventStatsInputSchema>

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export const getEventStatsTool = defineTool({
  name: 'get_event_stats',

  description: `Get statistics about available events: total counts, tonight's events, weekend events, free events, breakdown by category and neighborhood.
Use when user asks "what's available?", "how many events?", "what's the scene like?", or wants an overview before deciding what to search for.`,

  inputSchema: getEventStatsInputSchema,

  anthropicSchema: {
    type: 'object',
    properties: {},
  },

  requiresAuth: false,

  execute: async () => {
    try {
      const { createSupabaseServerClient } = await import('@/shared/lib/db/server')
      const client = createSupabaseServerClient()
      const now = getNowInBA()
      const currentHour = getHours(now)

      // Calculate time ranges
      const nowUTC = baToUTC(now)

      // Tonight: 6pm today to 6am tomorrow (or now to 6am if already past 6pm)
      let tonightStart: Date
      let tonightEnd: Date
      if (currentHour < 6) {
        tonightStart = now
        tonightEnd = setHours(startOfDay(now), 6)
      } else {
        tonightStart = setHours(startOfDay(now), 18)
        tonightEnd = setHours(startOfDay(addDays(now, 1)), 6)
      }

      // Weekend calculation
      const dayOfWeek = getDay(now)
      let weekendStart: Date
      let weekendEnd: Date
      if (dayOfWeek === 6 || dayOfWeek === 0) {
        // Already weekend
        const daysUntilMonday = dayOfWeek === 6 ? 2 : 1
        weekendStart = now
        weekendEnd = startOfDay(addDays(now, daysUntilMonday))
      } else {
        // Weekday - find next Saturday
        const daysUntilSaturday = 6 - dayOfWeek
        weekendStart = startOfDay(addDays(now, daysUntilSaturday))
        weekendEnd = startOfDay(addDays(weekendStart, 2))
      }

      // Total upcoming events
      const { count: totalUpcoming } = await client
        .from('events')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'scheduled')
        .gte('starts_at', nowUTC)

      // Tonight's events
      const { count: tonightCount } = await client
        .from('events')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'scheduled')
        .gte('starts_at', baToUTC(tonightStart))
        .lt('starts_at', baToUTC(tonightEnd))

      // Weekend events
      const { count: weekendCount } = await client
        .from('events')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'scheduled')
        .gte('starts_at', baToUTC(weekendStart))
        .lt('starts_at', baToUTC(weekendEnd))

      // Free events
      const { count: freeCount } = await client
        .from('events')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'scheduled')
        .gte('starts_at', nowUTC)
        .eq('is_free', true)

      // Events by category (upcoming only)
      const { data: categoryData } = await client
        .from('events')
        .select('categories')
        .eq('status', 'scheduled')
        .gte('starts_at', nowUTC)

      const byCategory: Record<string, number> = {}
      for (const event of categoryData || []) {
        const categories = event.categories || []
        for (const cat of categories) {
          byCategory[cat] = (byCategory[cat] || 0) + 1
        }
      }

      // Events by neighborhood (upcoming only, via venues)
      const { data: neighborhoodData } = await client
        .from('events_with_venues')
        .select('venue_neighborhood')
        .eq('status', 'scheduled')
        .gte('starts_at', nowUTC)

      const byNeighborhood: Record<string, number> = {}
      for (const event of neighborhoodData || []) {
        const neighborhood = event.venue_neighborhood
        if (neighborhood) {
          byNeighborhood[neighborhood] = (byNeighborhood[neighborhood] || 0) + 1
        }
      }

      // Sort by count and take top 5 neighborhoods
      const topNeighborhoods = Object.entries(byNeighborhood)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {} as Record<string, number>)

      const stats = {
        totalUpcoming: totalUpcoming ?? 0,
        tonight: tonightCount ?? 0,
        thisWeekend: weekendCount ?? 0,
        freeEvents: freeCount ?? 0,
        byCategory,
        topNeighborhoods,
      }

      console.log(`[DEBUG] get_event_stats: total=${stats.totalUpcoming}, tonight=${stats.tonight}`)

      return {
        success: true,
        formatted: JSON.stringify(stats),
        metadata: {
          totalUpcoming: stats.totalUpcoming,
          tonight: stats.tonight,
        },
      }
    } catch (error) {
      console.error('[get_event_stats] Error:', error)
      return {
        success: false,
        formatted: JSON.stringify({ error: 'Failed to get event statistics' }),
        error: 'execution_error',
      }
    }
  },
})
