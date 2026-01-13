/**
 * get_event_details Tool
 *
 * Gets complete details about a specific event.
 * Does not require authentication (events are public).
 */

import { z } from 'zod'
import { defineTool } from './types'
import { getEventDetailsForUser } from '../user-tools'
import { formatEventDetailsForClaude } from './utils'

// ============================================================================
// INPUT SCHEMA
// ============================================================================

export const getEventDetailsInputSchema = z.object({
  eventId: z.string().describe('The event ID to get details for'),
})

export type GetEventDetailsInput = z.infer<typeof getEventDetailsInputSchema>

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export const getEventDetailsTool = defineTool({
  name: 'get_event_details',

  description: `Get complete details about a specific event. Use when the user wants more information about an event you previously mentioned, or asks "tell me more about that".`,

  inputSchema: getEventDetailsInputSchema,

  anthropicSchema: {
    type: 'object',
    properties: {
      eventId: {
        type: 'string',
        description: 'The event ID to get details for',
      },
    },
    required: ['eventId'],
  },

  requiresAuth: false,

  execute: async (input) => {
    const result = await getEventDetailsForUser(input.eventId)

    console.log(`[DEBUG] get_event_details: success=${result.success}`)

    if (result.success && result.event) {
      const formattedResult = {
        success: true,
        event: formatEventDetailsForClaude(result.event),
      }

      return {
        success: true,
        events: [result.event],
        formatted: JSON.stringify(formattedResult),
        metadata: {
          found: true,
        },
      }
    }

    return {
      success: false,
      formatted: JSON.stringify({ success: false, error: 'Event not found' }),
      error: 'not_found',
      metadata: {
        found: false,
      },
    }
  },
})
