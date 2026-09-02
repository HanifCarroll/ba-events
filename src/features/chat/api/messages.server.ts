/**
 * Messages API. Supabase remains the persistence adapter; authorization,
 * idempotency, and error classification are expressed in Effect programs.
 */

import { Data, Effect } from 'effect'
import type { RequestEvent } from '@sveltejs/kit'
import type { Message, MessageAttachedData, MessageExecutionStep } from '#shared/lib/types.ts'
import { sortMessagesByTurnOrderAsc } from '#features/chat/lib/message-order.ts'
import { createSupabaseServerClient } from '#shared/lib/db/server-client.server.ts'
import { CHAT_CONTRACT_VERSION } from '#shared/lib/types.ts'

export type AddMessageInput = {
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

export function buildMessageRpcPayload(data: AddMessageInput) {
  return {
    p_conversation_id: data.conversationId,
    p_parent_id: data.parentMessageId ?? null,
    p_client_message_id: data.clientMessageId ?? null,
    p_role: data.role,
    p_content: data.content,
    p_visible_content: data.visibleContent ?? data.content,
    p_execution_trace: data.executionTrace ?? [],
    p_response_contract_version: data.responseContractVersion ?? CHAT_CONTRACT_VERSION,
    p_attached_data: data.attachedData ?? {},
  }
}

class MessagePersistenceError extends Data.TaggedError('MessagePersistenceError')<{
  readonly message: string
}> {}

class MessageAuthError extends Data.TaggedError('MessageAuthError')<{
  readonly message: string
}> {}

const persistenceFailure = (message: string) => new MessagePersistenceError({ message })
const authFailure = (message: string) => new MessageAuthError({ message })

function getUserEffect(supabase: ReturnType<typeof createSupabaseServerClient>) {
  return Effect.tryPromise({
    try: () => supabase.auth.getUser(),
    catch: () => persistenceFailure('Failed to read authenticated user'),
  })
}

/** Effect-native message insertion program. */
export function addMessageEffect(event: RequestEvent, data: AddMessageInput) {
  return Effect.gen(function* () {
    const supabase = createSupabaseServerClient(event)
    const { data: { user } } = yield* getUserEffect(supabase)
    if (!user) return yield* Effect.fail(authFailure('Not authenticated'))

    const conversationQuery = supabase.from('conversations').select('id').eq('id', data.conversationId).eq('user_id', user.id).single()
    const { data: conversation } = yield* Effect.tryPromise({
      try: () => conversationQuery,
      catch: () => persistenceFailure('Failed to add message'),
    })
    if (!conversation) return yield* Effect.fail(persistenceFailure('Conversation not found'))

    if (data.clientMessageId) {
      const existingQuery = supabase.from('messages').select('*')
        .eq('conversation_id', data.conversationId).eq('client_message_id', data.clientMessageId).maybeSingle()
      const { data: existingMessage, error: existingError } = yield* Effect.tryPromise({
        try: () => existingQuery,
        catch: () => persistenceFailure('Failed to add message'),
      })
      if (existingError) {
        console.error('[addMessage] Existing message lookup error:', existingError)
        return yield* Effect.fail(persistenceFailure('Failed to add message'))
      }
      if (existingMessage) return existingMessage as Message
    }

    const rpcQuery = supabase.rpc('insert_message_with_turn', buildMessageRpcPayload(data))
    const { data: rpcResult, error } = yield* Effect.tryPromise({
      try: () => rpcQuery,
      catch: () => persistenceFailure('Failed to add message'),
    })
    const message = (Array.isArray(rpcResult) ? rpcResult[0] : rpcResult) as Message | null
    if (error || !message) {
      console.error('[addMessage] Error:', error)
      return yield* Effect.fail(persistenceFailure('Failed to add message'))
    }
    return message
  })
}

/** Add a message, preserving the Promise contract used by Svelte remotes. */
export function addMessage(event: RequestEvent, data: AddMessageInput) {
  return Effect.runPromise(addMessageEffect(event, data))
}

/** Effect-native message list program. */
export function getMessagesEffect(event: RequestEvent, data: { conversationId: string }) {
  return Effect.gen(function* () {
    const supabase = createSupabaseServerClient(event)
    const { data: { user } } = yield* getUserEffect(supabase)
    if (!user) return []
    const conversationQuery = supabase.from('conversations').select('id').eq('id', data.conversationId).eq('user_id', user.id).single()
    const { data: conversation } = yield* Effect.tryPromise({
      try: () => conversationQuery,
      catch: () => persistenceFailure('Failed to get messages'),
    })
    if (!conversation) return []
    const query = supabase.from('messages').select('*').eq('conversation_id', data.conversationId)
      .order('turn_index', { ascending: true }).order('id', { ascending: true })
    const { data: rows, error } = yield* Effect.tryPromise({
      try: () => query,
      catch: () => persistenceFailure('Failed to get messages'),
    })
    if (error) {
      console.error('[getMessages] Error:', error)
      return yield* Effect.fail(persistenceFailure('Failed to get messages'))
    }
    return sortMessagesByTurnOrderAsc((rows ?? []) as Message[])
  })
}

export function getMessages(event: RequestEvent, data: { conversationId: string }) {
  return Effect.runPromise(getMessagesEffect(event, data))
}

/** Effect-native message attachment update program. */
export function updateMessageAttachedDataEffect(
  event: RequestEvent,
  data: { messageId: string; attachedData: MessageAttachedData },
) {
  return Effect.gen(function* () {
    const supabase = createSupabaseServerClient(event)
    const { data: { user } } = yield* getUserEffect(supabase)
    if (!user) return yield* Effect.fail(authFailure('Not authenticated'))
    const messageQuery = supabase.from('messages').select('id, conversation_id, conversations!inner(user_id)').eq('id', data.messageId).single()
    const { data: message } = yield* Effect.tryPromise({
      try: () => messageQuery,
      catch: () => persistenceFailure('Failed to update message'),
    })
    if (!message || (message.conversations as unknown as { user_id: string }).user_id !== user.id) {
      return yield* Effect.fail(persistenceFailure('Message not found'))
    }
    const query = supabase.from('messages').update({ attached_data: data.attachedData }).eq('id', data.messageId).select().single()
    const { data: updated, error } = yield* Effect.tryPromise({
      try: () => query,
      catch: () => persistenceFailure('Failed to update message'),
    })
    if (error) {
      console.error('[updateMessageAttachedData] Error:', error)
      return yield* Effect.fail(persistenceFailure('Failed to update message'))
    }
    return updated as Message
  })
}

export function updateMessageAttachedData(
  event: RequestEvent,
  data: { messageId: string; attachedData: MessageAttachedData },
) {
  return Effect.runPromise(updateMessageAttachedDataEffect(event, data))
}
