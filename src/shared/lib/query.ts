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
    // Upcoming events for the chat home "Happening soon" row
    trending: () => [...queryKeys.events.all, 'trending'] as const,
  },

  // Profile
  profile: {
    all: ['profile'] as const,
  },

  // Conversations (chat history)
  conversations: {
    all: ['conversations'] as const,
    list: (params?: { offset?: number; limit?: number }) =>
      [...queryKeys.conversations.all, 'list', params] as const,
    search: (query: string) => [...queryKeys.conversations.all, 'search', query] as const,
    detail: (id: string) => [...queryKeys.conversations.all, 'detail', id] as const,
    guestDetail: (id: string) =>
      [...queryKeys.conversations.all, 'guest-detail', id] as const,
  },
} as const
