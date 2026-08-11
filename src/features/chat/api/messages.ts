/**
 * Messages API
 *
 * Server functions for managing chat messages within conversations.
 */

import { createServerFn } from '@tanstack/react-start'
import type { Message, MessageAttachedData, MessageExecutionStep } from '@/shared/lib/types'
import { sortMessagesByTurnOrderAsc } from '@/features/chat/lib/message-order'

type AddMessageInput = {
  conversationId: string
  parentMessageId?: string | null
  role: 'user' | 'assistant' | 'system'
  clientMessageId?: string
  content: string
  visibleContent?: string
  executionTrace?: MessageExecutionStep[]
  responseContractVersion?: number
  attachedData?: MessageAttachedData
}

function buildMessageRpcPayload(data: AddMessageInput) {
  return {
    p_conversation_id: data.conversationId,
    p_parent_id: data.parentMessageId ?? null,
    p_client_message_id: data.clientMessageId ?? null,
    p_role: data.role,
    p_content: data.content,
    p_visible_content: data.visibleContent ?? data.content,
    p_execution_trace: data.executionTrace ?? [],
    p_response_contract_version: data.responseContractVersion ?? 2,
    p_attached_data: data.attachedData ?? {},
  }
}

/**
 * Add a message to a conversation.
 * Automatically sets sequence_number and updates conversation.updated_at.
 */
export const addMessage = createServerFn({ method: 'POST' }).validator((data: AddMessageInput) => data)
  .handler(async ({ data }) => {
    const { createSupabaseServerClient } = await import('@/shared/lib/db/server')
    const supabase = createSupabaseServerClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      throw new Error('Not authenticated')
    }

    // Verify user owns the conversation
    const { data: conv } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', data.conversationId)
      .eq('user_id', user.id)
      .single()

    if (!conv) {
      throw new Error('Conversation not found')
    }

    // Idempotency for retry/outbox flows: if this client message already exists,
    // return it instead of inserting a duplicate.
    if (data.clientMessageId) {
      const { data: existingMessage, error: existingError } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', data.conversationId)
        .eq('client_message_id', data.clientMessageId)
        .maybeSingle()

      if (existingError) {
        console.error('[addMessage] Existing message lookup error:', existingError)
        throw new Error('Failed to add message')
      }

      if (existingMessage) {
        return existingMessage as Message
      }
    }

    // Insert via transactional RPC so turn assignment is deterministic.
    const { data: rpcResult, error } = await supabase.rpc(
      'insert_message_with_turn',
      buildMessageRpcPayload(data)
    )

    const message = (Array.isArray(rpcResult) ? rpcResult[0] : rpcResult) as Message | null

    if (error || !message) {
      console.error('[addMessage] Error:', error)
      throw new Error('Failed to add message')
    }

    return message as Message
  })

/**
 * Get all messages for a conversation.
 */
export const getMessages = createServerFn({ method: 'GET' }).validator((data: { conversationId: string }) => data)
  .handler(async ({ data }) => {
    const { createSupabaseServerClient } = await import('@/shared/lib/db/server')
    const supabase = createSupabaseServerClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return []
    }

    // Verify user owns the conversation
    const { data: conv } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', data.conversationId)
      .eq('user_id', user.id)
      .single()

    if (!conv) {
      return []
    }

    const { data: rows, error } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', data.conversationId)
      .order('turn_index', { ascending: true })
      .order('id', { ascending: true })

    if (error) {
      console.error('[getMessages] Error:', error)
      throw new Error('Failed to get messages')
    }

    return sortMessagesByTurnOrderAsc((rows ?? []) as Message[])
  })

/**
 * Update a message's attached data.
 * Used to add events, suggestions, directions after assistant response.
 */
export const updateMessageAttachedData = createServerFn({ method: 'POST' }).validator((data: { messageId: string; attachedData: MessageAttachedData }) => data)
  .handler(async ({ data }) => {
    const { createSupabaseServerClient } = await import('@/shared/lib/db/server')
    const supabase = createSupabaseServerClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      throw new Error('Not authenticated')
    }

    // Get message and verify ownership through conversation
    const { data: message } = await supabase
      .from('messages')
      .select('id, conversation_id, conversations!inner(user_id)')
      .eq('id', data.messageId)
      .single()

    if (
      !message ||
      (message.conversations as unknown as { user_id: string }).user_id !== user.id
    ) {
      throw new Error('Message not found')
    }

    const { data: updated, error } = await supabase
      .from('messages')
      .update({ attached_data: data.attachedData })
      .eq('id', data.messageId)
      .select()
      .single()

    if (error) {
      console.error('[updateMessageAttachedData] Error:', error)
      throw new Error('Failed to update message')
    }

    return updated as Message
  })
