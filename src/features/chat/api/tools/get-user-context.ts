/**
 * get_user_context Tool
 *
 * Gets context about the current user including saved events count,
 * authentication status, and personalization preferences.
 * Helps personalize agent recommendations.
 */

import { z } from 'zod'
import { defineTool } from './types'
import { listSavedEventsForUser } from '../user-tools'
import { logger } from '@/shared/lib/logger'

// ============================================================================
// INPUT SCHEMA
// ============================================================================

export const getUserContextInputSchema = z.object({})

export type GetUserContextInput = z.infer<typeof getUserContextInputSchema>

// ============================================================================
// HELPER: Get user preferences
// ============================================================================

async function getUserPreferences(userId: string) {
  const { createSupabaseServerClient } = await import('@/shared/lib/db/server')
  const client = createSupabaseServerClient()

  const { data, error } = await client
    .from('user_preferences')
    .select('about_me, preferred_categories, preferred_neighborhoods')
    .eq('user_id', userId)
    .maybeSingle()

  if (error || !data) {
    return null
  }

  // Only return preferences if at least one field is set
  const hasAboutMe = !!data.about_me?.trim()
  const hasCategories = data.preferred_categories?.length > 0
  const hasNeighborhoods = data.preferred_neighborhoods?.length > 0

  if (!hasAboutMe && !hasCategories && !hasNeighborhoods) {
    return null
  }

  return {
    aboutMe: data.about_me || null,
    preferredCategories: data.preferred_categories || [],
    preferredNeighborhoods: data.preferred_neighborhoods || [],
  }
}

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export const getUserContextTool = defineTool({
  name: 'get_user_context',

  description: `Get context about the current user: saved events count, authentication status, and personalization preferences.
Call at the start of a conversation when you need to personalize recommendations or check if a user is logged in.
Use when the user asks about their account, saved items, or you need to tailor suggestions.
Returns user preferences (aboutMe, preferredCategories, preferredNeighborhoods) if they have set them up.`,

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
          preferences: null,
          message: 'User is not logged in. Saved events features require authentication.',
        }),
      }
    }

    // Get saved events count for authenticated users
    const savedResult = await listSavedEventsForUser('all', context.userContext)

    // Get user preferences for personalization
    const preferences = await getUserPreferences(userId)

    const userContext = {
      isAuthenticated: true,
      savedEventsCount: savedResult.count ?? 0,
      upcomingSavedCount: savedResult.upcomingCount ?? 0,
      pastSavedCount: savedResult.pastCount ?? 0,
      preferences,
    }

    logger.info('[get_user_context] Retrieved user context', {
      userId,
      savedEventsCount: userContext.savedEventsCount,
      hasPreferences: !!preferences,
      preferencesSummary: preferences ? {
        hasAboutMe: !!preferences.aboutMe,
        categoryCount: preferences.preferredCategories.length,
        neighborhoodCount: preferences.preferredNeighborhoods.length,
      } : null,
    })

    return {
      success: true,
      formatted: JSON.stringify(userContext),
      metadata: {
        authenticated: true,
        savedCount: userContext.savedEventsCount,
        hasPreferences: !!preferences,
      },
    }
  },
})
