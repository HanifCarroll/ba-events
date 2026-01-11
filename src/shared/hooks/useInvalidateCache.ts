import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { queryKeys } from '@/shared/lib/query'

/**
 * Hook for invalidating data caches.
 *
 * This hook invalidates BOTH:
 * - TanStack Query cache (for data fetched via useQuery hooks)
 * - TanStack Router loaders (for data fetched in route loaders)
 *
 * Events are loaded via route loaders, so router.invalidate() is required.
 * Venues are loaded via React Query, so queryClient.invalidateQueries() is required.
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
  const router = useRouter()

  /**
   * Invalidate events data.
   * Events are loaded via route loaders, so this invalidates the router.
   */
  const invalidateEvents = useCallback(async () => {
    await router.invalidate()
  }, [router])

  /**
   * Invalidate all venues queries (list, select, details)
   */
  const invalidateVenues = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.venues.all })
  }, [queryClient])

  /**
   * Invalidate both events (via router) and venues (via React Query)
   */
  const invalidateAll = useCallback(async () => {
    await Promise.all([
      router.invalidate(),
      queryClient.invalidateQueries({ queryKey: queryKeys.venues.all }),
    ])
  }, [router, queryClient])

  return {
    invalidateEvents,
    invalidateVenues,
    invalidateAll,
    queryClient, // Expose for advanced use cases
  }
}

export type UseInvalidateCacheReturn = ReturnType<typeof useInvalidateCache>
