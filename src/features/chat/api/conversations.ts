/**
 * Conversations API
 *
 * Server functions for managing chat conversations.
 * Handles CRUD operations for authenticated users.
 */

import { createServerFn } from '@tanstack/react-start'
import type {
  Conversation,
  ConversationInsert,
  ConversationUpdate,
  ConversationListItem,
  ConversationWithMessages,
  Message,
  MessageRole,
} from '@/shared/lib/types'
import {
  compareMessagesByTurnOrderAsc,
  sortMessagesByTurnOrderAsc,
} from '@/features/chat/lib/message-order'

/**
 * List all conversations for the authenticated user.
 * Returns lightweight list items ordered by most recent first.
 */
export const listConversations = createServerFn({ method: 'GET' }).validator((data: { limit?: number; offset?: number; search?: string } | undefined) => data ?? {})
  .handler(async ({ data }) => {
    const { createSupabaseServerClient } = await import('@/shared/lib/db/server')
    const supabase = createSupabaseServerClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return { conversations: [], total: 0 }
    }

    const limit = data.limit ?? 50
    const offset = data.offset ?? 0

    // Build query
    let query = supabase
      .from('conversations')
      .select('id, title, updated_at', { count: 'exact' })
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1)

    const { data: conversations, error, count } = await query

    if (error) {
      console.error('[listConversations] Error:', error)
      throw new Error('Failed to list conversations')
    }

    const conversationIds = (conversations ?? []).map((conv) => conv.id)
    const previewByConversationId = new Map<string, string>()

    if (conversationIds.length > 0) {
      const { data: messages, error: messagesError } = await supabase
        .from('messages')
        .select('conversation_id, visible_content, content, turn_index, sequence_number, role, id')
        .in('conversation_id', conversationIds)
        .order('turn_index', { ascending: false })
        .order('id', { ascending: false })

      if (messagesError) {
        console.error('[listConversations] Failed to load previews:', messagesError)
      } else {
        type PreviewRow = {
          conversation_id: string
          visible_content: string | null
          content: string | null
          turn_index: number | null
          sequence_number: number | null
          role: MessageRole
          id: string
        }

        const rows = (messages ?? []) as PreviewRow[]
        const latestByConversation = new Map<string, PreviewRow>()

        for (const row of rows) {
          const existing = latestByConversation.get(row.conversation_id)
          if (!existing) {
            latestByConversation.set(row.conversation_id, row)
            continue
          }

          if (
            compareMessagesByTurnOrderAsc(
              {
                id: existing.id,
                role: existing.role,
                turn_index: existing.turn_index,
                sequence_number: existing.sequence_number,
              },
              {
                id: row.id,
                role: row.role,
                turn_index: row.turn_index,
                sequence_number: row.sequence_number,
              }
            ) < 0
          ) {
            latestByConversation.set(row.conversation_id, row)
          }
        }

        for (const [conversationId, row] of latestByConversation) {
          const preview = (row.visible_content ?? row.content ?? '').trim()
          if (!preview) continue
          previewByConversationId.set(conversationId, preview.slice(0, 140))
        }
      }
    }

    return {
      conversations: (conversations ?? []).map((conversation) => ({
        ...(conversation as ConversationListItem),
        preview: previewByConversationId.get(conversation.id),
      })),
      total: count ?? 0,
    }
  })

/**
 * Search conversations by message content using full-text search.
 */
export const searchConversations = createServerFn({ method: 'GET' }).validator((data: { query: string; limit?: number }) => data)
  .handler(async ({ data }) => {
    const { createSupabaseServerClient } = await import('@/shared/lib/db/server')
    const supabase = createSupabaseServerClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return []
    }

    const limit = data.limit ?? 20

    // Search messages using full-text search, then get unique conversations
    const { data: messages, error } = await supabase
      .from('messages')
      .select(
        `
        conversation_id,
        visible_content,
        content,
        conversations!inner(id, title, updated_at, user_id, deleted_at)
      `
      )
      .textSearch('visible_content', data.query, { type: 'websearch' })
      .eq('conversations.user_id', user.id)
      .is('conversations.deleted_at', null)
      .limit(limit * 2) // Get more to dedupe

    if (error) {
      console.error('[searchConversations] Error:', error)
      throw new Error('Failed to search conversations')
    }

    // Dedupe by conversation_id and extract conversation info
    const seen = new Set<string>()
    const results: ConversationListItem[] = []

    for (const msg of messages ?? []) {
      if (!seen.has(msg.conversation_id) && results.length < limit) {
        seen.add(msg.conversation_id)
        const conv = msg.conversations as unknown as {
          id: string
          title: string
          updated_at: string
        }
        results.push({
          id: conv.id,
          title: conv.title,
          updated_at: conv.updated_at,
          preview: (msg.visible_content ?? msg.content).slice(0, 100),
        })
      }
    }

    return results
  })

/**
 * Get a single conversation with all its messages.
 */
export const getConversation = createServerFn({ method: 'GET' }).validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const { createSupabaseServerClient } = await import('@/shared/lib/db/server')
    const supabase = createSupabaseServerClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return null
    }

    // Get conversation
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('*')
      .eq('id', data.id)
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .single()

    if (convError || !conversation) {
      return null
    }

    // Get messages
    const { data: messages, error: msgError } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', data.id)
      .order('turn_index', { ascending: true })
      .order('id', { ascending: true })

    if (msgError) {
      console.error('[getConversation] Messages error:', msgError)
      throw new Error('Failed to get conversation messages')
    }

    return {
      ...conversation,
      messages: sortMessagesByTurnOrderAsc((messages ?? []) as Message[]),
    } as ConversationWithMessages
  })

/**
 * Create a new conversation.
 */
export const createConversation = createServerFn({ method: 'POST' }).validator((data: ConversationInsert) => data)
  .handler(async ({ data }) => {
    const { createSupabaseServerClient } = await import('@/shared/lib/db/server')
    const supabase = createSupabaseServerClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      throw new Error('Not authenticated')
    }

    const { data: conversation, error } = await supabase
      .from('conversations')
      .insert({
        user_id: user.id,
        title: data.title ?? 'New conversation',
        metadata: data.metadata ?? {},
      })
      .select()
      .single()

    if (error) {
      console.error('[createConversation] Error:', error)
      throw new Error('Failed to create conversation')
    }

    return conversation as Conversation
  })

/**
 * Update a conversation (rename, soft delete, etc.).
 */
export const updateConversation = createServerFn({ method: 'POST' }).validator((data: { id: string; updates: ConversationUpdate }) => data)
  .handler(async ({ data }) => {
    const { createSupabaseServerClient } = await import('@/shared/lib/db/server')
    const supabase = createSupabaseServerClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      throw new Error('Not authenticated')
    }

    const { data: conversation, error } = await supabase
      .from('conversations')
      .update({
        ...data.updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', data.id)
      .eq('user_id', user.id)
      .select()
      .single()

    if (error) {
      console.error('[updateConversation] Error:', error)
      throw new Error('Failed to update conversation')
    }

    return conversation as Conversation
  })

/**
 * Soft delete a conversation.
 */
export const deleteConversation = createServerFn({ method: 'POST' }).validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const { createSupabaseServerClient } = await import('@/shared/lib/db/server')
    const supabase = createSupabaseServerClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      throw new Error('Not authenticated')
    }

    const { error } = await supabase
      .from('conversations')
      .update({
        deleted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', data.id)
      .eq('user_id', user.id)

    if (error) {
      console.error('[deleteConversation] Error:', error)
      throw new Error('Failed to delete conversation')
    }

    return { success: true }
  })
