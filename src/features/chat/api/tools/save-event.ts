/**
 * save_event Tool
 *
 * Saves an event to the user's saved events list.
 * Requires user authentication.
 */

import { z } from 'zod'
import { defineTool } from './types.ts'
import { saveEventForUser } from '../user-tools.server.ts'

// ============================================================================
// INPUT SCHEMA
// ============================================================================

export const saveEventInputSchema = z.object({
  eventId: z.string().describe('The event ID to save (from a previous search result)'),
})

export type SaveEventInput = z.infer<typeof saveEventInputSchema>

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export const saveEventTool = defineTool({
  name: 'save_event',

  description: `Save an event to the user's saved events list. Use when the user expresses interest in an event ("save that", "bookmark it", "I want to go", "add to my list"). Requires the user to be logged in.`,

  inputSchema: saveEventInputSchema,

  anthropicSchema: {
    type: 'object',
    properties: {
      eventId: {
        type: 'string',
        description: 'The event ID to save (from a previous search result)',
      },
    },
    required: ['eventId'],
  },

  requiresAuth: true,

  execute: async (input, context) => {
    const result = await saveEventForUser(input.eventId, context.userContext)

    console.log(`[DEBUG] save_event: success=${result.success}, error=${result.error ?? 'none'}`)

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
