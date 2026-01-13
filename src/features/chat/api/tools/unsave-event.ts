/**
 * unsave_event Tool
 *
 * Removes an event from the user's saved events list.
 * Requires user authentication.
 */

import { z } from 'zod'
import { defineTool } from './types'
import { unsaveEventForUser } from '../user-tools'

// ============================================================================
// INPUT SCHEMA
// ============================================================================

export const unsaveEventInputSchema = z.object({
  eventId: z.string().describe('The event ID to remove from saved events'),
})

export type UnsaveEventInput = z.infer<typeof unsaveEventInputSchema>

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export const unsaveEventTool = defineTool({
  name: 'unsave_event',

  description: `Remove an event from the user's saved events list. Use when the user wants to remove a saved event ("remove that", "unsave it", "take it off my list").`,

  inputSchema: unsaveEventInputSchema,

  anthropicSchema: {
    type: 'object',
    properties: {
      eventId: {
        type: 'string',
        description: 'The event ID to remove from saved events',
      },
    },
    required: ['eventId'],
  },

  requiresAuth: true,

  execute: async (input, context) => {
    const result = await unsaveEventForUser(input.eventId, context.userContext)

    console.log(`[DEBUG] unsave_event: success=${result.success}, error=${result.error ?? 'none'}`)

    return {
      success: result.success,
      formatted: JSON.stringify(result),
      error: result.error,
      metadata: {
        authenticated: context.userContext.isAuthenticated,
      },
    }
  },
})
