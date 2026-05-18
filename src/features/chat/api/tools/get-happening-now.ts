/**
 * get_happening_now Tool
 *
 * Gets events that are currently happening right now.
 * Returns events that have started but haven't ended yet.
 */

import { z } from 'zod'
import { defineTool } from './types'
import { getEventsHappeningNow } from '@/shared/lib/db/client'
import { ensureChatEventPayloads, formatEventsToolResult } from './utils'

// ============================================================================
// INPUT SCHEMA
// ============================================================================

export const getHappeningNowInputSchema = z.object({
  limit: z.number().optional().describe('Maximum number of events to return (default: 5)'),
})

export type GetHappeningNowInput = z.infer<typeof getHappeningNowInputSchema>

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export const getHappeningNowTool = defineTool({
  name: 'get_happening_now',

  description: `Get events that are currently happening right now. Use this when the user asks "what's happening right now?", "what's going on?", "anything happening?", or wants to find an event they can go to immediately. Returns events that have already started but haven't ended yet.`,

  inputSchema: getHappeningNowInputSchema,

  anthropicSchema: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Maximum number of events to return (default: 5)',
      },
    },
  },

  requiresAuth: false,

  execute: async (input) => {
    try {
      const events = await getEventsHappeningNow()
      const limit = input.limit ?? 5
      const limitedEvents = events.slice(0, limit)

      console.log(`[DEBUG] get_happening_now returned ${limitedEvents.length} events`)

      return {
        success: true,
        events: ensureChatEventPayloads(limitedEvents),
        formatted: formatEventsToolResult(limitedEvents),
        metadata: {
          resultCount: limitedEvents.length,
        },
      }
    } catch (error) {
      console.error('[DEBUG] get_happening_now error:', error)
      return {
        success: false,
        formatted: JSON.stringify({ error: 'Failed to get happening now events' }),
        error: 'execution_error',
      }
    }
  },
})
