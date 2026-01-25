/**
 * React Query hooks for user preferences.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getUserPreferences,
  updateUserPreferences,
  hasUserPreferences,
} from '../api/preferences'
import { queryKeys } from '@/shared/lib/query'
import type { UserPreferencesUpdate } from '@/shared/lib/types'

/**
 * Fetch the current user's preferences.
 */
export function usePreferences() {
  return useQuery({
    queryKey: queryKeys.preferences.current(),
    queryFn: () => getUserPreferences(),
  })
}

/**
 * Update user preferences with optimistic updates.
 */
export function useUpdatePreferences() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: UserPreferencesUpdate) =>
      updateUserPreferences({ data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.preferences.all })
    },
  })
}

/**
 * Check if the user has set up their preferences.
 * Used for showing the personalization prompt.
 */
export function useHasPreferences() {
  return useQuery({
    queryKey: queryKeys.preferences.hasPreferences(),
    queryFn: () => hasUserPreferences(),
    staleTime: 5 * 60 * 1000, // 5 minutes - don't re-check too often
  })
}
