import type { SupabaseClient } from '@supabase/supabase-js'
import { Data, Effect } from 'effect'
import type {
  Conversation,
  ConversationChannel,
  Json,
  Message,
  MessageExecutionStep,
} from '#shared/lib/types.ts'
import { CHAT_CONTRACT_VERSION } from '#shared/lib/types.ts'
import { getSupabaseServiceRoleClient } from '#shared/lib/db/service.server.ts'
import { sortMessagesByTurnOrderAsc } from '#features/chat/lib/message-order.ts'
import { buildMessageRpcPayload } from './messages.server.ts'

export type ExternalConversationChannel = Exclude<ConversationChannel, 'web'>
export type ExternalConversation = Pick<
  Conversation,
  'id' | 'channel' | 'title' | 'created_at' | 'updated_at' | 'metadata'
>

const CONVERSATION_FIELDS = 'id, channel, title, created_at, updated_at, metadata'

class ExternalConversationError extends Data.TaggedError('ExternalConversationError')<{
  readonly message: string
}> {}

const externalFailure = (message: string) => new ExternalConversationError({ message })

function requireIdentityHash(hash: string): string {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid external identity hash')
  return hash
}

function findByHashEffect(
  client: SupabaseClient,
  channel: ExternalConversationChannel,
  hash: string
): Effect.Effect<ExternalConversation | null, ExternalConversationError> {
  return Effect.gen(function* () {
    const { data, error } = yield* Effect.tryPromise({
      try: () => client
        .from('conversations')
        .select(CONVERSATION_FIELDS)
        .eq('channel', channel)
        .eq('external_identity_hash', hash)
        .is('user_id', null)
        .is('deleted_at', null)
        .maybeSingle(),
      catch: () => externalFailure('Failed to get external conversation'),
    })
    if (error) return yield* Effect.fail(externalFailure('Failed to get external conversation'))
    return data as ExternalConversation | null
  })
}

function requireExternalConversationEffect(
  client: SupabaseClient,
  channel: ExternalConversationChannel,
  conversationId: string
): Effect.Effect<void, ExternalConversationError> {
  return Effect.gen(function* () {
    const { data, error } = yield* Effect.tryPromise({
      try: () => client
        .from('conversations')
        .select('id')
        .eq('id', conversationId)
        .eq('channel', channel)
        .is('user_id', null)
        .is('deleted_at', null)
        .maybeSingle(),
      catch: () => externalFailure('External conversation not found'),
    })
    if (error || !data) return yield* Effect.fail(externalFailure('External conversation not found'))
  })
}

/** Effect-native external conversation creation/idempotency program. */
export function getOrCreateExternalConversationEffect(
  input: {
    channel: ExternalConversationChannel
    externalIdentityHash: string
    title?: string
    metadata?: Record<string, Json>
  },
  client: SupabaseClient = getSupabaseServiceRoleClient()
): Effect.Effect<ExternalConversation, ExternalConversationError> {
  return Effect.gen(function* () {
    let hash: string
    try {
      hash = requireIdentityHash(input.externalIdentityHash)
    } catch {
      return yield* Effect.fail(externalFailure('Invalid external identity hash'))
    }
    const existing = yield* findByHashEffect(client, input.channel, hash)
    if (existing) return existing

    const { data, error } = yield* Effect.tryPromise({
      try: () => client
        .from('conversations')
        .insert({
          user_id: null,
          channel: input.channel,
          external_identity_hash: hash,
          title: input.title ?? 'New conversation',
          metadata: input.metadata ?? {},
        })
        .select(CONVERSATION_FIELDS)
        .single(),
      catch: () => externalFailure('Failed to create external conversation'),
    })

    if (!error && data) return data as ExternalConversation
    if (error?.code === '23505') {
      const raced = yield* findByHashEffect(client, input.channel, hash)
      if (raced) return raced
    }
    return yield* Effect.fail(externalFailure('Failed to create external conversation'))
  })
}

export function getOrCreateExternalConversation(
  input: {
    channel: ExternalConversationChannel
    externalIdentityHash: string
    title?: string
    metadata?: Record<string, Json>
  },
  client: SupabaseClient = getSupabaseServiceRoleClient(),
) {
  return Effect.runPromise(getOrCreateExternalConversationEffect(input, client))
}

/** Effect-native external conversation lookup program. */
export function getExternalConversationEffect(
  input: { channel: ExternalConversationChannel; conversationId: string },
  client: SupabaseClient = getSupabaseServiceRoleClient()
): Effect.Effect<ExternalConversation, ExternalConversationError> {
  return Effect.gen(function* () {
    const { data, error } = yield* Effect.tryPromise({
      try: () => client
        .from('conversations')
        .select(CONVERSATION_FIELDS)
        .eq('id', input.conversationId)
        .eq('channel', input.channel)
        .is('user_id', null)
        .is('deleted_at', null)
        .maybeSingle(),
      catch: () => externalFailure('External conversation not found'),
    })
    if (error || !data) return yield* Effect.fail(externalFailure('External conversation not found'))
    return data as ExternalConversation
  })
}

export function getExternalConversation(
  input: { channel: ExternalConversationChannel; conversationId: string },
  client: SupabaseClient = getSupabaseServiceRoleClient(),
) {
  return Effect.runPromise(getExternalConversationEffect(input, client))
}

/** Effect-native external conversation message read program. */
export function loadExternalConversationMessagesEffect(
  input: { channel: ExternalConversationChannel; conversationId: string },
  client: SupabaseClient = getSupabaseServiceRoleClient()
): Effect.Effect<Message[], ExternalConversationError> {
  return Effect.gen(function* () {
    const { data, error } = yield* Effect.tryPromise({
      try: () => client
        .from('messages')
        .select('*, conversations!inner(id)')
        .eq('conversation_id', input.conversationId)
        .eq('conversations.channel', input.channel)
        .is('conversations.user_id', null)
        .is('conversations.deleted_at', null)
        .order('sequence_number', { ascending: false })
        .limit(120),
      catch: () => externalFailure('Failed to load external conversation messages'),
    })
    if (error) return yield* Effect.fail(externalFailure('Failed to load external conversation messages'))
    const messages = (data ?? []).map(({ conversations: _conversations, ...message }) => message as Message)
    return sortMessagesByTurnOrderAsc(messages)
  })
}

export function loadExternalConversationMessages(
  input: { channel: ExternalConversationChannel; conversationId: string },
  client: SupabaseClient = getSupabaseServiceRoleClient(),
) {
  return Effect.runPromise(loadExternalConversationMessagesEffect(input, client))
}

/** Effect-native external message insertion program. */
export function insertExternalConversationMessageEffect(
  input: {
    channel: ExternalConversationChannel
    conversationId: string
    parentMessageId?: string | null
    clientMessageId: string
    role: 'user' | 'assistant'
    content: string
    visibleContent?: string
    executionTrace?: MessageExecutionStep[]
    attachedData?: Message['attached_data']
    responseContractVersion?: number
  },
  client: SupabaseClient = getSupabaseServiceRoleClient()
): Effect.Effect<Message, ExternalConversationError> {
  return Effect.gen(function* () {
    yield* requireExternalConversationEffect(client, input.channel, input.conversationId)
    const { data, error } = yield* Effect.tryPromise({
      try: () => client.rpc(
        'insert_message_with_turn',
        buildMessageRpcPayload({
          conversationId: input.conversationId,
          parentMessageId: input.parentMessageId,
          clientMessageId: input.clientMessageId,
          role: input.role,
          content: input.content,
          visibleContent: input.visibleContent,
          executionTrace: input.executionTrace,
          attachedData: input.attachedData,
          responseContractVersion: input.responseContractVersion ?? CHAT_CONTRACT_VERSION,
        })
      ),
      catch: () => externalFailure('Failed to insert external conversation message'),
    })
    const message = (Array.isArray(data) ? data[0] : data) as Message | null
    if (error || !message) return yield* Effect.fail(externalFailure('Failed to insert external conversation message'))
    return message
  })
}

export function insertExternalConversationMessage(
  input: {
    channel: ExternalConversationChannel
    conversationId: string
    parentMessageId?: string | null
    clientMessageId: string
    role: 'user' | 'assistant'
    content: string
    visibleContent?: string
    executionTrace?: MessageExecutionStep[]
    attachedData?: Message['attached_data']
    responseContractVersion?: number
  },
  client: SupabaseClient = getSupabaseServiceRoleClient(),
) {
  return Effect.runPromise(insertExternalConversationMessageEffect(input, client))
}

/** Effect-native external metadata update program. */
export function updateExternalConversationMetadataEffect(
  input: {
    channel: ExternalConversationChannel
    conversationId: string
    metadataPatch: Record<string, Json>
  },
  client: SupabaseClient = getSupabaseServiceRoleClient()
): Effect.Effect<ExternalConversation, ExternalConversationError> {
  return Effect.gen(function* () {
    const { data: current, error: readError } = yield* Effect.tryPromise({
      try: () => client
        .from('conversations')
        .select('metadata')
        .eq('id', input.conversationId)
        .eq('channel', input.channel)
        .is('user_id', null)
        .is('deleted_at', null)
        .single(),
      catch: () => externalFailure('Failed to update external conversation metadata'),
    })
    if (readError || !current) return yield* Effect.fail(externalFailure('Failed to update external conversation metadata'))

    const patchEntries = Object.entries(input.metadataPatch)
    if (
      patchEntries.length > 20 ||
      patchEntries.some(
        ([key]) =>
          !/^[a-z][a-zA-Z0-9_]{0,63}$/.test(key) ||
          ['__proto__', 'constructor', 'prototype'].includes(key)
      )
    ) {
      return yield* Effect.fail(externalFailure('Invalid external conversation metadata patch'))
    }
    const metadata = {
      ...((current.metadata ?? {}) as Record<string, Json>),
      ...Object.fromEntries(patchEntries),
    }

    const { data, error } = yield* Effect.tryPromise({
      try: () => client
        .from('conversations')
        .update({ metadata })
        .eq('id', input.conversationId)
        .eq('channel', input.channel)
        .is('user_id', null)
        .select(CONVERSATION_FIELDS)
        .single(),
      catch: () => externalFailure('Failed to update external conversation metadata'),
    })
    if (error || !data) return yield* Effect.fail(externalFailure('Failed to update external conversation metadata'))
    return data as ExternalConversation
  })
}

export function updateExternalConversationMetadata(
  input: {
    channel: ExternalConversationChannel
    conversationId: string
    metadataPatch: Record<string, Json>
  },
  client: SupabaseClient = getSupabaseServiceRoleClient(),
) {
  return Effect.runPromise(updateExternalConversationMetadataEffect(input, client))
}

/** Effect-native external message clearing program. */
export function clearExternalConversationMessagesEffect(
  input: { channel: ExternalConversationChannel; conversationId: string },
  client: SupabaseClient = getSupabaseServiceRoleClient()
): Effect.Effect<void, ExternalConversationError> {
  return Effect.gen(function* () {
    yield* requireExternalConversationEffect(client, input.channel, input.conversationId)
    const { error } = yield* Effect.tryPromise({
      try: () => client.from('messages').delete().eq('conversation_id', input.conversationId),
      catch: () => externalFailure('Failed to clear external conversation messages'),
    })
    if (error) return yield* Effect.fail(externalFailure('Failed to clear external conversation messages'))
  })
}

export function clearExternalConversationMessages(
  input: { channel: ExternalConversationChannel; conversationId: string },
  client: SupabaseClient = getSupabaseServiceRoleClient(),
) {
  return Effect.runPromise(clearExternalConversationMessagesEffect(input, client))
}

/** Effect-native external conversation hard-delete program. */
export function hardDeleteExternalConversationEffect(
  input: { channel: ExternalConversationChannel; conversationId: string },
  client: SupabaseClient = getSupabaseServiceRoleClient()
): Effect.Effect<void, ExternalConversationError> {
  return Effect.gen(function* () {
    const { error } = yield* Effect.tryPromise({
      try: () => client
        .from('conversations')
        .delete()
        .eq('id', input.conversationId)
        .eq('channel', input.channel)
        .is('user_id', null),
      catch: () => externalFailure('Failed to delete external conversation'),
    })
    if (error) return yield* Effect.fail(externalFailure('Failed to delete external conversation'))
  })
}

export function hardDeleteExternalConversation(
  input: { channel: ExternalConversationChannel; conversationId: string },
  client: SupabaseClient = getSupabaseServiceRoleClient(),
) {
  return Effect.runPromise(hardDeleteExternalConversationEffect(input, client))
}
