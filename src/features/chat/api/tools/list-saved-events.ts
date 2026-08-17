/**
 * list_saved_events Tool
 *
 * Gets the user's saved events with optional filtering.
 * Requires user authentication.
 */

import { z } from 'zod'
import { defineTool } from './types.ts'
import { listSavedEventsForUser } from '../user-tools.server.ts'
import { ensureChatEventPayloads, formatSavedEventsForClaude } from './utils.ts'

// ============================================================================
// INPUT SCHEMA
// ============================================================================

export const listSavedEventsInputSchema = z.object({
  filter: z
    .enum(['all', 'upcoming', 'past'])
    .optional()
    .describe('Filter saved events: "upcoming" for future events, "past" for past events, "all" for everything'),
})

export type ListSavedEventsInput = z.infer<typeof listSavedEventsInputSchema>

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export const listSavedEventsTool = defineTool({
  name: 'list_saved_events',

  description: `Get the user's saved events. Use when the user asks about their saved events ("what did I save?", "my events", "my list", "what's on my calendar?"). Can filter by upcoming or past events.`,

  inputSchema: listSavedEventsInputSchema,

  anthropicSchema: {
    type: 'object',
    properties: {
      filter: {
        type: 'string',
        enum: ['all', 'upcoming', 'past'],
        description: 'Filter saved events: "upcoming" for future events, "past" for past events, "all" for everything',
      },
    },
  },

  requiresAuth: true,

  execute: async (input, context) => {
    const filter = input.filter ?? 'all'
    const result = await listSavedEventsForUser(filter, context.userContext)

    const events = ensureChatEventPayloads(result.events ?? [])

    // Format the result for Claude
    const formattedResult = {
      success: result.success,
      error: result.error,
      count: result.count ?? 0,
      upcomingCount: result.upcomingCount ?? 0,
      pastCount: result.pastCount ?? 0,
      events: formatSavedEventsForClaude(events),
    }

    console.log(`[DEBUG] list_saved_events: count=${result.count ?? 0}, filter=${filter}`)

    return {
      success: result.success,
      events,
      formatted: JSON.stringify(formattedResult),
      error: result.error,
      metadata: {
        authenticated: context.userContext.isAuthenticated,
        filter,
        count: result.count ?? 0,
      },
    }
  },
})
