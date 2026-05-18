/**
 * get_tonights_events Tool
 *
 * Gets all events happening tonight (6pm today to 6am tomorrow).
 * Supports optional category and neighborhood filters.
 */

import { z } from 'zod'
import { defineTool } from './types'
import { getTonightsEvents } from '@/shared/lib/db/client'
import { CATEGORIES, NEIGHBORHOODS } from '@/shared/lib/types'
import { ensureChatEventPayloads, formatEventsToolResult } from './utils'

// ============================================================================
// INPUT SCHEMA
// ============================================================================

export const getTonightsEventsInputSchema = z.object({
  category: z.string().optional().describe(`Optional category filter. Options: ${CATEGORIES.join(', ')}`),
  neighborhood: z.string().optional().describe('Optional Buenos Aires neighborhood filter'),
  limit: z.number().optional().describe('Maximum number of events to return (default: 10)'),
})

export type GetTonightsEventsInput = z.infer<typeof getTonightsEventsInputSchema>

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export const getTonightsEventsTool = defineTool({
  name: 'get_tonights_events',

  description: `Get all events happening tonight (6pm today to 6am tomorrow). Use this when the user asks "what's on tonight?", "tonight's events", or wants to plan their evening. More focused than search_events with timeFilter="tonight" - returns events already filtered to tonight only.`,

  inputSchema: getTonightsEventsInputSchema,

  anthropicSchema: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        description: `Optional category filter. Options: ${CATEGORIES.join(', ')}`,
      },
      neighborhood: {
        type: 'string',
        description: 'Optional Buenos Aires neighborhood filter',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of events to return (default: 10)',
      },
    },
  },

  requiresAuth: false,

  execute: async (input) => {
    try {
      let events = await getTonightsEvents()

      // Apply optional filters
      if (input.category) {
        events = events.filter(e => e.categories.includes(input.category!))
      }
      if (input.neighborhood) {
        const matchNeighborhood = NEIGHBORHOODS.find(
          n => n.toLowerCase() === input.neighborhood?.toLowerCase()
        )
        if (matchNeighborhood) {
          events = events.filter(e => e.venue_neighborhood === matchNeighborhood)
        }
      }

      const limit = input.limit ?? 10
      const limitedEvents = events.slice(0, limit)

      console.log(`[DEBUG] get_tonights_events returned ${limitedEvents.length} events`)

      return {
        success: true,
        events: ensureChatEventPayloads(limitedEvents),
        formatted: formatEventsToolResult(limitedEvents),
        metadata: {
          resultCount: limitedEvents.length,
          hasCategory: !!input.category,
          hasNeighborhood: !!input.neighborhood,
        },
      }
    } catch (error) {
      console.error('[DEBUG] get_tonights_events error:', error)
      return {
        success: false,
        formatted: JSON.stringify({ error: "Failed to get tonight's events" }),
        error: 'execution_error',
      }
    }
  },
})
