/**
 * check_event_saved Tool
 *
 * Checks if a specific event is saved in the user's list.
 * Used proactively to let users know if they've already saved something.
 */

import { z } from 'zod'
import { defineTool } from './types.ts'
import { checkEventSavedForUser } from '../user-tools.server.ts'

// ============================================================================
// INPUT SCHEMA
// ============================================================================

export const checkEventSavedInputSchema = z.object({
  eventId: z.string().describe('The event ID to check'),
})

export type CheckEventSavedInput = z.infer<typeof checkEventSavedInputSchema>

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export const checkEventSavedTool = defineTool({
  name: 'check_event_saved',

  description: `Check if a specific event is saved in the user's list. Use this proactively before mentioning an event to let the user know if they've already saved it. Returns isSaved: true/false.`,

  inputSchema: checkEventSavedInputSchema,

  anthropicSchema: {
    type: 'object',
    properties: {
      eventId: {
        type: 'string',
        description: 'The event ID to check',
      },
    },
    required: ['eventId'],
  },

  requiresAuth: true,

  execute: async (input, context) => {
    const result = await checkEventSavedForUser(input.eventId, context.userContext)

    console.log(`[DEBUG] check_event_saved: isSaved=${result.isSaved}, success=${result.success}`)

    return {
      success: result.success,
      formatted: JSON.stringify(result),
      metadata: {
        isSaved: result.isSaved,
        authenticated: context.userContext.isAuthenticated,
      },
    }
  },
})
