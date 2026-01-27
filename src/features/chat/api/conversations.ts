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
  MigrationConversation,
} from '@/shared/lib/types'

/**
 * List all conversations for the authenticated user.
 * Returns lightweight list items ordered by most recent first.
 */
export const listConversations = createServerFn({ method: 'GET' })
  .inputValidator(
    (data: { limit?: number; offset?: number; search?: string } | undefined) => data ?? {}
  )
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

    return {
      conversations: (conversations ?? []) as ConversationListItem[],
      total: count ?? 0,
    }
  })

/**
 * Search conversations by message content using full-text search.
 */
export const searchConversations = createServerFn({ method: 'GET' })
  .inputValidator((data: { query: string; limit?: number }) => data)
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
        content,
        conversations!inner(id, title, updated_at, user_id, deleted_at)
      `
      )
      .textSearch('content', data.query, { type: 'websearch' })
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
          preview: msg.content.slice(0, 100),
        })
      }
    }

    return results
  })

/**
 * Get a single conversation with all its messages.
 */
export const getConversation = createServerFn({ method: 'GET' })
  .inputValidator((data: { id: string }) => data)
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
      .order('sequence_number', { ascending: true })

    if (msgError) {
      console.error('[getConversation] Messages error:', msgError)
      throw new Error('Failed to get conversation messages')
    }

    return {
      ...conversation,
      messages: messages ?? [],
    } as ConversationWithMessages
  })

/**
 * Create a new conversation.
 */
export const createConversation = createServerFn({ method: 'POST' })
  .inputValidator((data: ConversationInsert) => data)
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
export const updateConversation = createServerFn({ method: 'POST' })
  .inputValidator((data: { id: string; updates: ConversationUpdate }) => data)
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
export const deleteConversation = createServerFn({ method: 'POST' })
  .inputValidator((data: { id: string }) => data)
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

/**
 * Migrate anonymous conversations to the authenticated user.
 * Called after signup/login if local conversations exist.
 */
export const migrateConversations = createServerFn({ method: 'POST' })
  .inputValidator((data: { conversations: MigrationConversation[] }) => data)
  .handler(async ({ data }) => {
    const { createSupabaseServerClient } = await import('@/shared/lib/db/server')
    const supabase = createSupabaseServerClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      throw new Error('Not authenticated')
    }

    let imported = 0

    for (const conv of data.conversations) {
      // Create the conversation
      const { data: newConv, error: convError } = await supabase
        .from('conversations')
        .insert({
          user_id: user.id,
          title: conv.title,
          created_at: conv.created_at,
          updated_at: conv.updated_at,
          metadata: { migrated_from_local: conv.local_id },
        })
        .select()
        .single()

      if (convError || !newConv) {
        console.error('[migrateConversations] Failed to create conversation:', convError)
        continue
      }

      // Insert all messages
      if (conv.messages.length > 0) {
        const messagesWithConvId = conv.messages.map((m) => ({
          conversation_id: newConv.id,
          role: m.role,
          content: m.content,
          attached_data: m.attached_data ?? {},
          created_at: m.created_at,
          sequence_number: m.sequence_number,
        }))

        const { error: msgError } = await supabase.from('messages').insert(messagesWithConvId)

        if (msgError) {
          console.error('[migrateConversations] Failed to insert messages:', msgError)
          // Don't fail the whole migration for one conversation
        }
      }

      imported++
    }

    return { imported, total: data.conversations.length }
  })
