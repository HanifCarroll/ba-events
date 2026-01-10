import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/shared/lib/query'

/**
 * Hook for invalidating TanStack Query cache.
 *
 * Use this instead of `router.invalidate()` when you need to refresh data
 * that's fetched via TanStack Query (useQuery hooks).
 *
 * `router.invalidate()` only refreshes TanStack Router loaders, not Query cache.
 *
 * @example
 * const { invalidateEvents, invalidateVenues } = useInvalidateCache()
 *
 * // After updating an event
 * await invalidateEvents()
 *
 * // After updating a venue
 * await invalidateVenues()
 *
 * // After updating both
 * await invalidateAll()
 */
export function useInvalidateCache() {
  const queryClient = useQueryClient()

  /**
   * Invalidate all events queries (list, paginated, tab counts, details)
   */
  const invalidateEvents = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.events.all })
  }, [queryClient])

  /**
   * Invalidate all venues queries (list, select, details)
   */
  const invalidateVenues = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.venues.all })
  }, [queryClient])

  /**
   * Invalidate both events and venues queries
   */
  const invalidateAll = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.events.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.venues.all }),
    ])
  }, [queryClient])

  return {
    invalidateEvents,
    invalidateVenues,
    invalidateAll,
    queryClient, // Expose for advanced use cases
  }
}

export type UseInvalidateCacheReturn = ReturnType<typeof useInvalidateCache>
