import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/shared/lib/query'
import {
  getActiveUsers,
  getPageviews,
  getTopEvents,
  getSearchTerms,
  getEventEngagement,
} from '../api/posthog'
import type { DateRange } from '../types'

// 5-minute stale time to match server cache
const STALE_TIME = 5 * 60 * 1000

/**
 * Hook for active users data (DAU/WAU/MAU)
 */
export function useActiveUsers(range: DateRange) {
  return useQuery({
    queryKey: queryKeys.analytics.activeUsers(range),
    queryFn: () => getActiveUsers({ data: range }),
    staleTime: STALE_TIME,
  })
}

/**
 * Hook for pageviews time series
 */
export function usePageviews(range: DateRange) {
  return useQuery({
    queryKey: queryKeys.analytics.pageviews(range),
    queryFn: () => getPageviews({ data: range }),
    staleTime: STALE_TIME,
  })
}

/**
 * Hook for top events by engagement
 */
export function useTopEvents(range: DateRange) {
  return useQuery({
    queryKey: queryKeys.analytics.topEvents(range),
    queryFn: () => getTopEvents({ data: range }),
    staleTime: STALE_TIME,
  })
}

/**
 * Hook for popular search terms
 */
export function useSearchTerms(range: DateRange) {
  return useQuery({
    queryKey: queryKeys.analytics.searchTerms(range),
    queryFn: () => getSearchTerms({ data: range }),
    staleTime: STALE_TIME,
  })
}

/**
 * Hook for event engagement totals
 */
export function useEventEngagement(range: DateRange) {
  return useQuery({
    queryKey: queryKeys.analytics.engagement(range),
    queryFn: () => getEventEngagement({ data: range }),
    staleTime: STALE_TIME,
  })
}
