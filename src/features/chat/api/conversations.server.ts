/**
 * Conversations API
 *
 * Server functions for managing chat conversations. Supabase calls are leaf
 * adapters; the ownership/auth/idempotency decisions stay in Effect programs.
 */

import { Data, Effect } from 'effect'
import type { RequestEvent } from '@sveltejs/kit'
import type {
  Conversation,
  ConversationInsert,
  ConversationUpdate,
  ConversationListItem,
  ConversationWithMessages,
  Message,
  MessageRole,
} from '#shared/lib/types.ts'
import {
  compareMessagesByTurnOrderAsc,
  sortMessagesByTurnOrderAsc,
} from '#features/chat/lib/message-order.ts'
import { createSupabaseServerClient } from '#shared/lib/db/server-client.server.ts'
import { withReadSignal } from '#shared/lib/db/read-signal.ts'

class ConversationPersistenceError extends Data.TaggedError('ConversationPersistenceError')<{
  readonly message: string
}> {}

class ConversationAuthError extends Data.TaggedError('ConversationAuthError')<{
  readonly message: string
}> {}

const persistenceFailure = (message: string) => new ConversationPersistenceError({ message })
const authFailure = (message: string) => new ConversationAuthError({ message })

function getUserEffect(supabase: ReturnType<typeof createSupabaseServerClient>) {
  return Effect.tryPromise({
    try: () => supabase.auth.getUser(),
    catch: () => persistenceFailure('Failed to read authenticated user'),
  })
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Effect-native list program. Promise adapters belong at framework roots. */
export function listConversationsEffect(
  event: RequestEvent,
  data: { limit?: number; offset?: number; search?: string } = {},
) {
  return Effect.gen(function* () {
    const supabase = createSupabaseServerClient(event)
    const { data: { user } } = yield* getUserEffect(supabase)
    if (!user) return { conversations: [], total: 0 }

    const limit = data.limit ?? 50
    const offset = data.offset ?? 0
    const query = supabase
      .from('conversations')
      .select('id, title, updated_at', { count: 'exact' })
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1)
    const { data: conversations, error, count } = yield* Effect.tryPromise({
      try: () => query,
      catch: () => persistenceFailure('Failed to list conversations'),
    })
    if (error) {
      console.error('[listConversations] Error:', error)
      return yield* Effect.fail(persistenceFailure('Failed to list conversations'))
    }

    const conversationIds = (conversations ?? []).map((conv) => conv.id)
    const previewByConversationId = new Map<string, string>()

    if (conversationIds.length > 0) {
      const previewQuery = supabase
        .from('messages')
        .select('conversation_id, visible_content, content, turn_index, sequence_number, role, id')
        .in('conversation_id', conversationIds)
        .order('turn_index', { ascending: false })
        .order('id', { ascending: false })
      type PreviewRow = {
        conversation_id: string
        visible_content: string | null
        content: string | null
        turn_index: number | null
        sequence_number: number | null
        role: MessageRole
        id: string
      }
      const previews = yield* Effect.match(
        Effect.tryPromise({
          try: () => previewQuery,
          catch: () => persistenceFailure('Failed to load conversation previews'),
        }),
        {
          onFailure: (error) => {
            console.error('[listConversations] Failed to load previews:', error)
            return null
          },
          onSuccess: (value) => value,
        },
      )

      if (previews && !previews.error) {
        const rows = (previews.data ?? []) as PreviewRow[]
        const latestByConversation = new Map<string, PreviewRow>()
        for (const row of rows) {
          const existing = latestByConversation.get(row.conversation_id)
          if (!existing || compareMessagesByTurnOrderAsc(
            { id: existing.id, role: existing.role, turn_index: existing.turn_index, sequence_number: existing.sequence_number },
            { id: row.id, role: row.role, turn_index: row.turn_index, sequence_number: row.sequence_number },
          ) < 0) {
            latestByConversation.set(row.conversation_id, row)
          }
        }
        for (const [conversationId, row] of latestByConversation) {
          const preview = (row.visible_content ?? row.content ?? '').trim()
          if (preview) previewByConversationId.set(conversationId, preview.slice(0, 140))
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
}

/** List lightweight conversations for the authenticated user. */
export function listConversations(
  event: RequestEvent,
  data: { limit?: number; offset?: number; search?: string } = {},
) {
  return Effect.runPromise(listConversationsEffect(event, data))
}

/** Effect-native search program. */
export function searchConversationsEffect(
  event: RequestEvent,
  data: { query: string; limit?: number },
) {
  return Effect.gen(function* () {
    const supabase = createSupabaseServerClient(event)
    const { data: { user } } = yield* getUserEffect(supabase)
    if (!user) return []
    const limit = data.limit ?? 20
    const query = supabase
      .from('messages')
      .select(`
        conversation_id,
        visible_content,
        content,
        conversations!inner(id, title, updated_at, user_id, deleted_at)
      `)
      .textSearch('visible_content', data.query, { type: 'websearch' })
      .eq('conversations.user_id', user.id)
      .is('conversations.deleted_at', null)
      .limit(limit * 2)
    const { data: messages, error } = yield* Effect.tryPromise({
      try: () => query,
      catch: () => persistenceFailure('Failed to search conversations'),
    })
    if (error) {
      console.error('[searchConversations] Error:', error)
      return yield* Effect.fail(persistenceFailure('Failed to search conversations'))
    }
    const seen = new Set<string>()
    const results: ConversationListItem[] = []
    for (const msg of messages ?? []) {
      if (seen.has(msg.conversation_id) || results.length >= limit) continue
      seen.add(msg.conversation_id)
      const conv = msg.conversations as unknown as { id: string; title: string; updated_at: string }
      results.push({
        id: conv.id,
        title: conv.title,
        updated_at: conv.updated_at,
        preview: (msg.visible_content ?? msg.content).slice(0, 100),
      })
    }
    return results
  })
}

/** Search conversation previews by message content. */
export function searchConversations(event: RequestEvent, data: { query: string; limit?: number }) {
  return Effect.runPromise(searchConversationsEffect(event, data))
}

/** Effect-native conversation read program. */
export function getConversationEffect(event: RequestEvent, data: { id: string }) {
  return Effect.gen(function* () {
    const supabase = createSupabaseServerClient(event)
    const user = event.locals.user
    if (!user) return null
    const conversationQuery = supabase
      .from('conversations').select('*').eq('id', data.id).eq('user_id', user.id).is('deleted_at', null)
    const { data: conversation, error: convError } = yield* Effect.tryPromise({
      try: (signal) => withReadSignal(conversationQuery, signal).single(),
      catch: () => persistenceFailure('Failed to get conversation'),
    })
    if (convError || !conversation) return null
    const messageQuery = supabase
      .from('messages').select('*').eq('conversation_id', data.id)
      .order('turn_index', { ascending: true }).order('id', { ascending: true })
    const { data: messages, error: msgError } = yield* Effect.tryPromise({
      try: (signal) => withReadSignal(messageQuery, signal),
      catch: () => persistenceFailure('Failed to get conversation messages'),
    })
    if (msgError) {
      console.error('[getConversation] Messages error:', msgError)
      return yield* Effect.fail(persistenceFailure('Failed to get conversation messages'))
    }
    return { ...conversation, messages: sortMessagesByTurnOrderAsc((messages ?? []) as Message[]) } as ConversationWithMessages
  })
}

/** Get a conversation and its ordered messages. */
export function getConversation(event: RequestEvent, data: { id: string }) {
  return Effect.runPromise(getConversationEffect(event, data), { signal: event.request?.signal })
}

/** Effect-native conversation creation program. */
export function createConversationEffect(event: RequestEvent, data: ConversationInsert) {
  return Effect.gen(function* () {
    if (data.id && !UUID_RE.test(data.id)) return yield* Effect.fail(persistenceFailure('Failed to create conversation'))
    const supabase = createSupabaseServerClient(event)
    const { data: { user } } = yield* getUserEffect(supabase)
    if (!user) return yield* Effect.fail(authFailure('Not authenticated'))
    const insertQuery = supabase.from('conversations').insert({
      ...(data.id ? { id: data.id } : {}),
      user_id: user.id,
      title: data.title ?? 'New conversation',
      metadata: data.metadata ?? {},
    }).select().single()
    const { data: conversation, error } = yield* Effect.tryPromise({
      try: () => insertQuery,
      catch: () => persistenceFailure('Failed to create conversation'),
    })
    if (error) {
      if (data.id && error.code === '23505') {
        const existingQuery = supabase.from('conversations').select('*').eq('id', data.id).eq('user_id', user.id).maybeSingle()
        const { data: existingConversation } = yield* Effect.tryPromise({
          try: () => existingQuery,
          catch: () => persistenceFailure('Failed to create conversation'),
        })
        if (existingConversation) return existingConversation as Conversation
      }
      console.error('[createConversation] Error:', error)
      return yield* Effect.fail(persistenceFailure('Failed to create conversation'))
    }
    return conversation as Conversation
  })
}

/** Create an authenticated conversation, retaining idempotent client ids. */
export function createConversation(event: RequestEvent, data: ConversationInsert) {
  return Effect.runPromise(createConversationEffect(event, data))
}

/** Effect-native conversation update program. */
export function updateConversationEffect(event: RequestEvent, data: { id: string; updates: ConversationUpdate }) {
  return Effect.gen(function* () {
    const supabase = createSupabaseServerClient(event)
    const { data: { user } } = yield* getUserEffect(supabase)
    if (!user) return yield* Effect.fail(authFailure('Not authenticated'))
    const query = supabase.from('conversations').update({
      ...data.updates,
      updated_at: new Date().toISOString(),
    }).eq('id', data.id).eq('user_id', user.id).select().single()
    const { data: conversation, error } = yield* Effect.tryPromise({
      try: () => query,
      catch: () => persistenceFailure('Failed to update conversation'),
    })
    if (error) {
      console.error('[updateConversation] Error:', error)
      return yield* Effect.fail(persistenceFailure('Failed to update conversation'))
    }
    return conversation as Conversation
  })
}

export function updateConversation(event: RequestEvent, data: { id: string; updates: ConversationUpdate }) {
  return Effect.runPromise(updateConversationEffect(event, data))
}

/** Effect-native conversation deletion program. */
export function deleteConversationEffect(event: RequestEvent, data: { id: string }) {
  return Effect.gen(function* () {
    const supabase = createSupabaseServerClient(event)
    const { data: { user } } = yield* getUserEffect(supabase)
    if (!user) return yield* Effect.fail(authFailure('Not authenticated'))
    const now = new Date().toISOString()
    const query = supabase.from('conversations').update({ deleted_at: now, updated_at: now }).eq('id', data.id).eq('user_id', user.id)
    const { error } = yield* Effect.tryPromise({
      try: () => query,
      catch: () => persistenceFailure('Failed to delete conversation'),
    })
    if (error) {
      console.error('[deleteConversation] Error:', error)
      return yield* Effect.fail(persistenceFailure('Failed to delete conversation'))
    }
    return { success: true }
  })
}

export function deleteConversation(event: RequestEvent, data: { id: string }) {
  return Effect.runPromise(deleteConversationEffect(event, data))
}
