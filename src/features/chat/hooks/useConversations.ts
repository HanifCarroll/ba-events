/**
 * React Query hooks for chat conversations.
 *
 * Provides authenticated conversation persistence for the chat flow.
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
import { addMessage, updateMessageAttachedData } from '../api/messages'
import { generateAndSaveTitle } from '../api/generate-title'
import { getFallbackConversationTitle } from '@/features/chat/lib/title'
import { queryKeys } from '@/shared/lib/query'
import type {
  ConversationListItem,
  ConversationWithMessages,
  Message,
  MessageAttachedData,
  MessageExecutionStep,
  MessageRole,
} from '@/shared/lib/types'
import { sortMessagesByTurnOrderAsc } from '@/features/chat/lib/message-order'

/**
 * List all conversations for the current user.
 * Only authenticated users get a durable conversation list.
 */
export function useConversations(options?: { limit?: number; offset?: number }) {
  const { user } = useAuthContext()
  const isAuthenticated = !!user

  return useQuery({
    queryKey: queryKeys.conversations.list(options),
    queryFn: async (): Promise<{ conversations: ConversationListItem[]; total: number }> => {
      if (!isAuthenticated) {
        return { conversations: [], total: 0 }
      }
      return listConversations({ data: options ?? {} })
    },
    enabled: isAuthenticated,
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
      if (!isAuthenticated) {
        return []
      }
      return searchConversations({ data: { query } })
    },
    enabled: isAuthenticated && query.trim().length > 0,
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
      if (!id || !isAuthenticated) return null

      const result = await getConversation({ data: { id } })
      return result as ConversationWithMessages | null
    },
    enabled: !!id && isAuthenticated,
  })
}

export function useUpdateMessageAttachedData() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      messageId,
      attachedData,
    }: {
      messageId: string
      attachedData: MessageAttachedData
    }) => {
      return updateMessageAttachedData({ data: { messageId, attachedData } })
    },
    onSuccess: (updatedMessage) => {
      queryClient.setQueryData(
        queryKeys.conversations.detail(updatedMessage.conversation_id),
        (existing: ConversationWithMessages | null | undefined) => {
          if (!existing) return existing ?? null

          const nextMessages = existing.messages.map((message) =>
            message.id === updatedMessage.id
              ? {
                  ...message,
                  attached_data: updatedMessage.attached_data ?? {},
                }
              : message
          )

          return {
            ...existing,
            messages: sortMessagesByTurnOrderAsc(nextMessages),
          }
        }
      )
    },
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
      if (!isAuthenticated) {
        throw new Error('Not authenticated')
      }
      return createConversation({ data: { title } })
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
      if (!isAuthenticated) {
        throw new Error('Not authenticated')
      }
      return updateConversation({ data: { id, updates: { title } } })
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
      if (!isAuthenticated) {
        throw new Error('Not authenticated')
      }
      return deleteConversation({ data: { id } })
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
      parentMessageId,
      role,
      clientMessageId,
      content,
      visibleContent,
      executionTrace,
      responseContractVersion,
      attachedData,
    }: {
      conversationId: string
      parentMessageId?: string | null
      role: MessageRole
      clientMessageId?: string
      content: string
      visibleContent?: string
      executionTrace?: MessageExecutionStep[]
      responseContractVersion?: number
      attachedData?: MessageAttachedData
    }) => {
      if (!isAuthenticated) {
        throw new Error('Not authenticated')
      }
      return addMessage({
        data: {
          conversationId,
          parentMessageId,
          role,
          clientMessageId,
          content,
          visibleContent,
          executionTrace,
          responseContractVersion,
          attachedData,
        },
      })
    },
    onSuccess: (savedMessage, { conversationId }) => {
      queryClient.setQueryData(
        queryKeys.conversations.detail(conversationId),
        (existing: ConversationWithMessages | null | undefined) => {
          if (!existing) return existing ?? null

          const normalizedSavedMessage: Message = {
            id: savedMessage.id,
            conversation_id: savedMessage.conversation_id,
            parent_id: savedMessage.parent_id ?? null,
            client_message_id: savedMessage.client_message_id ?? null,
            role: savedMessage.role,
            content: savedMessage.content,
            visible_content: savedMessage.visible_content ?? savedMessage.content,
            execution_trace: savedMessage.execution_trace ?? [],
            response_contract_version: savedMessage.response_contract_version ?? 2,
            attached_data: savedMessage.attached_data ?? {},
            created_at: savedMessage.created_at,
            sequence_number: savedMessage.sequence_number,
            turn_index:
              typeof savedMessage.turn_index === 'number'
                ? savedMessage.turn_index
                : savedMessage.sequence_number,
          }

          const mergedById = new Map(existing.messages.map((message) => [message.id, message]))
          mergedById.set(normalizedSavedMessage.id, normalizedSavedMessage)

          return {
            ...existing,
            updated_at: new Date().toISOString(),
            messages: sortMessagesByTurnOrderAsc(Array.from(mergedById.values())),
          }
        }
      )

      queryClient.invalidateQueries({ queryKey: queryKeys.conversations.list() })
    },
  })
}

/**
 * Generate a title for a conversation based on the first message.
 * Anonymous chat is ephemeral, so only authenticated conversations persist titles.
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
      if (!isAuthenticated) {
        return { title: getFallbackConversationTitle(firstMessage) }
      }
      return generateAndSaveTitle({ data: { conversationId, firstMessage } })
    },
    onSuccess: (_, { conversationId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations.detail(conversationId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations.list() })
    },
  })
}
