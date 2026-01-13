/**
 * get_user_context Tool
 *
 * Gets context about the current user including saved events count,
 * and authentication status. Helps personalize agent recommendations.
 */

import { z } from 'zod'
import { defineTool } from './types'
import { listSavedEventsForUser } from '../user-tools'

// ============================================================================
// INPUT SCHEMA
// ============================================================================

export const getUserContextInputSchema = z.object({})

export type GetUserContextInput = z.infer<typeof getUserContextInputSchema>

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export const getUserContextTool = defineTool({
  name: 'get_user_context',

  description: `Get context about the current user: saved events count, authentication status, and upcoming events.
Call at the start of a conversation when you need to personalize recommendations or check if a user is logged in.
Use when the user asks about their account, saved items, or you need to tailor suggestions.`,

  inputSchema: getUserContextInputSchema,

  anthropicSchema: {
    type: 'object',
    properties: {},
  },

  requiresAuth: false, // Can be called without auth, returns different info based on auth state

  execute: async (_input, context) => {
    const { userId, isAuthenticated } = context.userContext

    // Base context for unauthenticated users
    if (!isAuthenticated || !userId) {
      return {
        success: true,
        formatted: JSON.stringify({
          isAuthenticated: false,
          savedEventsCount: 0,
          upcomingSavedCount: 0,
          pastSavedCount: 0,
          message: 'User is not logged in. Saved events features require authentication.',
        }),
      }
    }

    // Get saved events count for authenticated users
    const savedResult = await listSavedEventsForUser('all', context.userContext)

    const userContext = {
      isAuthenticated: true,
      savedEventsCount: savedResult.count ?? 0,
      upcomingSavedCount: savedResult.upcomingCount ?? 0,
      pastSavedCount: savedResult.pastCount ?? 0,
    }

    console.log(`[DEBUG] get_user_context: authenticated=${isAuthenticated}, savedCount=${userContext.savedEventsCount}`)

    return {
      success: true,
      formatted: JSON.stringify(userContext),
      metadata: {
        authenticated: true,
        savedCount: userContext.savedEventsCount,
      },
    }
  },
})
