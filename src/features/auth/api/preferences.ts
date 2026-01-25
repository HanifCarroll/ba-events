/**
 * User Preferences API
 *
 * Server functions for managing user preferences used for personalized recommendations.
 */

import { createServerFn } from '@tanstack/react-start'
import type { UserPreferences, UserPreferencesUpdate } from '@/shared/lib/types'

/**
 * Get user preferences for the authenticated user.
 * Returns null if user is not authenticated or has no preferences.
 */
export const getUserPreferences = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { createSupabaseServerClient } = await import('@/shared/lib/db/server')
    const supabase = createSupabaseServerClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return null
    }

    const { data, error } = await supabase
      .from('user_preferences')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle()

    if (error) {
      console.error('[getUserPreferences] Error:', error)
      return null
    }

    return data as UserPreferences | null
  }
)

/**
 * Update user preferences (upsert).
 * Creates a new record if none exists, updates if it does.
 */
export const updateUserPreferences = createServerFn({ method: 'POST' })
  .inputValidator((data: UserPreferencesUpdate) => data)
  .handler(async ({ data }) => {
    const { createSupabaseServerClient } = await import('@/shared/lib/db/server')
    const supabase = createSupabaseServerClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      throw new Error('Not authenticated')
    }

    const { data: result, error } = await supabase
      .from('user_preferences')
      .upsert(
        {
          user_id: user.id,
          ...data,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'user_id',
        }
      )
      .select()
      .single()

    if (error) {
      console.error('[updateUserPreferences] Error:', error)
      throw new Error('Failed to update preferences')
    }

    return result as UserPreferences
  })

/**
 * Check if user has set up their preferences.
 * Used for showing the personalization prompt.
 */
export const hasUserPreferences = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { createSupabaseServerClient } = await import('@/shared/lib/db/server')
    const supabase = createSupabaseServerClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return false
    }

    const { data, error } = await supabase
      .from('user_preferences')
      .select('id, about_me, preferred_categories, preferred_neighborhoods')
      .eq('user_id', user.id)
      .maybeSingle()

    if (error || !data) {
      return false
    }

    // Check if any preference is actually set
    const hasAboutMe = !!data.about_me?.trim()
    const hasCategories = data.preferred_categories?.length > 0
    const hasNeighborhoods = data.preferred_neighborhoods?.length > 0

    return hasAboutMe || hasCategories || hasNeighborhoods
  }
)
