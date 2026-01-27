/**
 * Messages API
 *
 * Server functions for managing chat messages within conversations.
 */

import { createServerFn } from '@tanstack/react-start'
import type { Message, MessageAttachedData } from '@/shared/lib/types'

/**
 * Add a message to a conversation.
 * Automatically sets sequence_number and updates conversation.updated_at.
 */
export const addMessage = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: {
      conversationId: string
      role: 'user' | 'assistant' | 'system'
      content: string
      attachedData?: MessageAttachedData
    }) => data
  )
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

    // Get the next sequence number
    const { data: lastMsg } = await supabase
      .from('messages')
      .select('sequence_number')
      .eq('conversation_id', data.conversationId)
      .order('sequence_number', { ascending: false })
      .limit(1)
      .maybeSingle()

    const sequenceNumber = lastMsg ? lastMsg.sequence_number + 1 : 0

    // Insert the message
    const { data: message, error } = await supabase
      .from('messages')
      .insert({
        conversation_id: data.conversationId,
        role: data.role,
        content: data.content,
        attached_data: data.attachedData ?? {},
        sequence_number: sequenceNumber,
      })
      .select()
      .single()

    if (error) {
      console.error('[addMessage] Error:', error)
      throw new Error('Failed to add message')
    }

    // Update conversation's updated_at
    await supabase
      .from('conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', data.conversationId)

    return message as Message
  })

/**
 * Get all messages for a conversation.
 */
export const getMessages = createServerFn({ method: 'GET' })
  .inputValidator((data: { conversationId: string }) => data)
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

    const { data: messages, error } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', data.conversationId)
      .order('sequence_number', { ascending: true })

    if (error) {
      console.error('[getMessages] Error:', error)
      throw new Error('Failed to get messages')
    }

    return (messages ?? []) as Message[]
  })

/**
 * Update a message's attached data.
 * Used to add events, suggestions, directions after assistant response.
 */
export const updateMessageAttachedData = createServerFn({ method: 'POST' })
  .inputValidator((data: { messageId: string; attachedData: MessageAttachedData }) => data)
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
