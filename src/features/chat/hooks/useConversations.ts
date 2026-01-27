/**
 * React Query hooks for chat conversations.
 *
 * Provides unified interface for both authenticated (PostgreSQL) and
 * anonymous (IndexedDB) users. Automatically switches storage based on auth state.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthContext } from '@/features/auth/hooks/useAuthContext'
import {
  listConversations,
  searchConversations,
  getConversation,
  createConversation,
  updateConversation,
  deleteConversation,
} from '../api/conversations'
import { addMessage } from '../api/messages'
import { generateAndSaveTitle } from '../api/generate-title'
import {
  listLocalConversations,
  getLocalConversationWithMessages,
  createLocalConversation,
  updateLocalConversation,
  deleteLocalConversation,
  addLocalMessage,
  searchLocalConversations,
  getConversationPreview,
} from '@/shared/lib/db/local-conversations'
import { queryKeys } from '@/shared/lib/query'
import type {
  ConversationListItem,
  ConversationWithMessages,
  MessageAttachedData,
  MessageRole,
} from '@/shared/lib/types'

/**
 * List all conversations for the current user.
 * Uses server storage for authenticated users, IndexedDB for anonymous.
 */
export function useConversations(options?: { limit?: number; offset?: number }) {
  const { user } = useAuthContext()
  const isAuthenticated = !!user

  return useQuery({
    queryKey: queryKeys.conversations.list(options),
    queryFn: async (): Promise<{ conversations: ConversationListItem[]; total: number }> => {
      if (isAuthenticated) {
        return listConversations({ data: options ?? {} })
      }

      // Anonymous: use IndexedDB
      const conversations = await listLocalConversations()

      // Convert to ConversationListItem format with preview
      const items: ConversationListItem[] = await Promise.all(
        conversations.map(async (c) => ({
          id: c.id,
          title: c.title,
          updated_at: c.updated_at,
          preview: (await getConversationPreview(c.id)) ?? undefined,
        }))
      )

      // Apply limit/offset for anonymous too
      const start = options?.offset ?? 0
      const end = start + (options?.limit ?? 50)
      return {
        conversations: items.slice(start, end),
        total: conversations.length,
      }
    },
  })
}

/**
 * Search conversations by content.
 */
export function useSearchConversations(query: string) {
  const { user } = useAuthContext()
  const isAuthenticated = !!user

  return useQuery({
    queryKey: queryKeys.conversations.search(query),
    queryFn: async (): Promise<ConversationListItem[]> => {
      if (!query.trim()) return []

      if (isAuthenticated) {
        return searchConversations({ data: { query } })
      }

      // Anonymous: search local
      const conversations = await searchLocalConversations(query)
      return conversations.map((c) => ({
        id: c.id,
        title: c.title,
        updated_at: c.updated_at,
      }))
    },
    enabled: query.trim().length > 0,
  })
}

/**
 * Get a single conversation with all messages.
 */
export function useConversation(id: string | null) {
  const { user } = useAuthContext()
  const isAuthenticated = !!user

  return useQuery({
    queryKey: queryKeys.conversations.detail(id ?? 'none'),
    queryFn: async (): Promise<ConversationWithMessages | null> => {
      if (!id) return null

      if (isAuthenticated) {
        const result = await getConversation({ data: { id } })
        return result as ConversationWithMessages | null
      }

      // Anonymous: get from local
      const result = await getLocalConversationWithMessages(id)
      if (!result) return null

      return {
        id: result.conversation.id,
        user_id: null,
        title: result.conversation.title,
        created_at: result.conversation.created_at,
        updated_at: result.conversation.updated_at,
        deleted_at: null,
        metadata: {},
        messages: result.messages.map((m) => ({
          id: m.id,
          conversation_id: m.conversation_id,
          parent_id: null,
          role: m.role,
          content: m.content,
          attached_data: m.attached_data,
          created_at: m.created_at,
          sequence_number: m.sequence_number,
        })),
      }
    },
    enabled: !!id,
  })
}

/**
 * Create a new conversation.
 */
export function useCreateConversation() {
  const { user } = useAuthContext()
  const isAuthenticated = !!user
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (title?: string) => {
      if (isAuthenticated) {
        return createConversation({ data: { title } })
      }

      // Anonymous: create locally
      return createLocalConversation(title)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations.all })
    },
  })
}

/**
 * Update a conversation (rename, etc.).
 */
export function useUpdateConversation() {
  const { user } = useAuthContext()
  const isAuthenticated = !!user
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, title }: { id: string; title: string }) => {
      if (isAuthenticated) {
        return updateConversation({ data: { id, updates: { title } } })
      }

      // Anonymous: update locally
      await updateLocalConversation(id, { title })
      return { id, title }
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations.all })
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations.detail(id) })
    },
  })
}

/**
 * Delete a conversation.
 */
export function useDeleteConversation() {
  const { user } = useAuthContext()
  const isAuthenticated = !!user
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string) => {
      if (isAuthenticated) {
        return deleteConversation({ data: { id } })
      }

      // Anonymous: delete locally
      await deleteLocalConversation(id)
      return { success: true }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations.all })
    },
  })
}

/**
 * Add a message to a conversation.
 */
export function useAddMessage() {
  const { user } = useAuthContext()
  const isAuthenticated = !!user
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      conversationId,
      role,
      content,
      attachedData,
    }: {
      conversationId: string
      role: MessageRole
      content: string
      attachedData?: MessageAttachedData
    }) => {
      if (isAuthenticated) {
        return addMessage({
          data: { conversationId, role, content, attachedData },
        })
      }

      // Anonymous: add locally
      return addLocalMessage(conversationId, { role, content, attached_data: attachedData })
    },
    onSuccess: (_, { conversationId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations.detail(conversationId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations.list() })
    },
  })
}

/**
 * Generate a title for a conversation based on the first message.
 * Only works for authenticated users (anonymous conversations get local title generation).
 */
export function useGenerateTitle() {
  const { user } = useAuthContext()
  const isAuthenticated = !!user
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      conversationId,
      firstMessage,
    }: {
      conversationId: string
      firstMessage: string
    }) => {
      if (isAuthenticated) {
        return generateAndSaveTitle({ data: { conversationId, firstMessage } })
      }

      // For anonymous users, generate a simple title locally
      // (Could call Claude API directly but keeping it simple for anonymous)
      const words = firstMessage.split(' ').slice(0, 5).join(' ')
      const title = words.length > 30 ? words.slice(0, 27) + '...' : words
      await updateLocalConversation(conversationId, { title })
      return { title }
    },
    onSuccess: (_, { conversationId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations.detail(conversationId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations.list() })
    },
  })
}
