import { QueryClient } from '@tanstack/react-query'
import type { EventListParams, EventFilterParams } from '@/shared/lib/types/pagination'
import type { DateRange } from '@/features/analytics/types'

// Create a singleton QueryClient instance
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000, // 30 seconds
      gcTime: 5 * 60 * 1000, // 5 minutes
      retry: 1,
      refetchOnWindowFocus: true,
    },
    mutations: {
      retry: 0,
    },
  },
})

// Query keys factory for type-safe, consistent key management
export const queryKeys = {
  // Events
  events: {
    all: ['events'] as const,
    list: (filters?: { status?: string; venueId?: string }) =>
      [...queryKeys.events.all, 'list', filters] as const,
    // Admin events list (lightweight, client-side filtered)
    adminList: () => [...queryKeys.events.all, 'adminList'] as const,
    adminPastList: () => [...queryKeys.events.all, 'adminPastList'] as const,
    // Paginated list with all filter params
    listPaginated: (params: EventListParams) =>
      [...queryKeys.events.all, 'listPaginated', params] as const,
    // Tab counts (needs_attention, pending_review, etc.)
    tabCounts: (filters: Omit<EventFilterParams, 'tab'>) =>
      [...queryKeys.events.all, 'tabCounts', filters] as const,
    detail: (id: string) => [...queryKeys.events.all, 'detail', id] as const,
  },

  // Venues
  venues: {
    all: ['venues'] as const,
    list: () => [...queryKeys.venues.all, 'list'] as const,
    select: () => [...queryKeys.venues.all, 'select'] as const,
    detail: (id: string) => [...queryKeys.venues.all, 'detail', id] as const,
  },

  // Categories
  categories: {
    all: ['categories'] as const,
    list: () => [...queryKeys.categories.all, 'list'] as const,
  },

  // Profile
  profile: {
    all: ['profile'] as const,
    current: () => [...queryKeys.profile.all, 'current'] as const,
  },

  // User preferences (personalization)
  preferences: {
    all: ['preferences'] as const,
    current: () => [...queryKeys.preferences.all, 'current'] as const,
    hasPreferences: () => [...queryKeys.preferences.all, 'hasPreferences'] as const,
  },

  // Saved events
  saved: {
    all: ['saved'] as const,
    list: () => [...queryKeys.saved.all, 'list'] as const,
  },

  // Import blocklist
  blocklist: {
    all: ['blocklist'] as const,
    list: () => [...queryKeys.blocklist.all, 'list'] as const,
    detail: (id: string) => [...queryKeys.blocklist.all, 'detail', id] as const,
  },

  // Analytics
  analytics: {
    all: ['analytics'] as const,
    activeUsers: (range: DateRange) => [...queryKeys.analytics.all, 'activeUsers', range] as const,
    dauTimeSeries: (range: DateRange) => [...queryKeys.analytics.all, 'dauTimeSeries', range] as const,
    wauTimeSeries: (range: DateRange) => [...queryKeys.analytics.all, 'wauTimeSeries', range] as const,
    pageviews: (range: DateRange) => [...queryKeys.analytics.all, 'pageviews', range] as const,
    topEvents: (range: DateRange) => [...queryKeys.analytics.all, 'topEvents', range] as const,
    searchTerms: (range: DateRange) => [...queryKeys.analytics.all, 'searchTerms', range] as const,
    engagement: (range: DateRange) => [...queryKeys.analytics.all, 'engagement', range] as const,
  },
} as const
