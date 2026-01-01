import { QueryClient } from '@tanstack/react-query'

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

  // Saved events
  saved: {
    all: ['saved'] as const,
    list: () => [...queryKeys.saved.all, 'list'] as const,
  },
} as const
