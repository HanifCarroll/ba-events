import type { SupabaseClient } from '@supabase/supabase-js'
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

function requireIdentityHash(hash: string): string {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid external identity hash')
  return hash
}

async function findByHash(
  client: SupabaseClient,
  channel: ExternalConversationChannel,
  hash: string
): Promise<ExternalConversation | null> {
  const { data, error } = await client
    .from('conversations')
    .select(CONVERSATION_FIELDS)
    .eq('channel', channel)
    .eq('external_identity_hash', hash)
    .is('user_id', null)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw new Error('Failed to get external conversation')
  return data as ExternalConversation | null
}

async function requireExternalConversation(
  client: SupabaseClient,
  channel: ExternalConversationChannel,
  conversationId: string
) {
  const { data, error } = await client
    .from('conversations')
    .select('id')
    .eq('id', conversationId)
    .eq('channel', channel)
    .is('user_id', null)
    .is('deleted_at', null)
    .maybeSingle()
  if (error || !data) throw new Error('External conversation not found')
}

export async function getOrCreateExternalConversation(
  input: {
    channel: ExternalConversationChannel
    externalIdentityHash: string
    title?: string
    metadata?: Record<string, Json>
  },
  client: SupabaseClient = getSupabaseServiceRoleClient()
): Promise<ExternalConversation> {
  const hash = requireIdentityHash(input.externalIdentityHash)
  const existing = await findByHash(client, input.channel, hash)
  if (existing) return existing

  const { data, error } = await client
    .from('conversations')
    .insert({
      user_id: null,
      channel: input.channel,
      external_identity_hash: hash,
      title: input.title ?? 'New conversation',
      metadata: input.metadata ?? {},
    })
    .select(CONVERSATION_FIELDS)
    .single()

  if (!error && data) return data as ExternalConversation
  if (error?.code === '23505') {
    const raced = await findByHash(client, input.channel, hash)
    if (raced) return raced
  }
  throw new Error('Failed to create external conversation')
}

export async function getExternalConversation(
  input: { channel: ExternalConversationChannel; conversationId: string },
  client: SupabaseClient = getSupabaseServiceRoleClient()
): Promise<ExternalConversation> {
  const { data, error } = await client
    .from('conversations')
    .select(CONVERSATION_FIELDS)
    .eq('id', input.conversationId)
    .eq('channel', input.channel)
    .is('user_id', null)
    .is('deleted_at', null)
    .maybeSingle()
  if (error || !data) throw new Error('External conversation not found')
  return data as ExternalConversation
}

export async function loadExternalConversationMessages(
  input: { channel: ExternalConversationChannel; conversationId: string },
  client: SupabaseClient = getSupabaseServiceRoleClient()
): Promise<Message[]> {
  await requireExternalConversation(client, input.channel, input.conversationId)
  const { data, error } = await client
    .from('messages')
    .select('*')
    .eq('conversation_id', input.conversationId)
    .order('sequence_number', { ascending: false })
    .limit(120)
  if (error) throw new Error('Failed to load external conversation messages')
  return sortMessagesByTurnOrderAsc((data ?? []) as Message[])
}

export async function insertExternalConversationMessage(
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
): Promise<Message> {
  await requireExternalConversation(client, input.channel, input.conversationId)
  const { data, error } = await client.rpc(
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
  )
  const message = (Array.isArray(data) ? data[0] : data) as Message | null
  if (error || !message) throw new Error('Failed to insert external conversation message')
  return message
}

export async function updateExternalConversationMetadata(
  input: {
    channel: ExternalConversationChannel
    conversationId: string
    metadataPatch: Record<string, Json>
  },
  client: SupabaseClient = getSupabaseServiceRoleClient()
): Promise<ExternalConversation> {
  const { data: current, error: readError } = await client
    .from('conversations')
    .select('metadata')
    .eq('id', input.conversationId)
    .eq('channel', input.channel)
    .is('user_id', null)
    .is('deleted_at', null)
    .single()
  if (readError || !current) throw new Error('Failed to update external conversation metadata')

  const patchEntries = Object.entries(input.metadataPatch)
  if (
    patchEntries.length > 20 ||
    patchEntries.some(
      ([key]) =>
        !/^[a-z][a-zA-Z0-9_]{0,63}$/.test(key) ||
        ['__proto__', 'constructor', 'prototype'].includes(key)
    )
  ) {
    throw new Error('Invalid external conversation metadata patch')
  }
  const metadata = {
    ...((current.metadata ?? {}) as Record<string, Json>),
    ...Object.fromEntries(patchEntries),
  }

  const { data, error } = await client
    .from('conversations')
    .update({ metadata })
    .eq('id', input.conversationId)
    .eq('channel', input.channel)
    .is('user_id', null)
    .select(CONVERSATION_FIELDS)
    .single()
  if (error || !data) throw new Error('Failed to update external conversation metadata')
  return data as ExternalConversation
}

export async function clearExternalConversationMessages(
  input: { channel: ExternalConversationChannel; conversationId: string },
  client: SupabaseClient = getSupabaseServiceRoleClient()
): Promise<void> {
  await requireExternalConversation(client, input.channel, input.conversationId)
  const { error } = await client.from('messages').delete().eq('conversation_id', input.conversationId)
  if (error) throw new Error('Failed to clear external conversation messages')
}

export async function hardDeleteExternalConversation(
  input: { channel: ExternalConversationChannel; conversationId: string },
  client: SupabaseClient = getSupabaseServiceRoleClient()
): Promise<void> {
  const { error } = await client
    .from('conversations')
    .delete()
    .eq('id', input.conversationId)
    .eq('channel', input.channel)
    .is('user_id', null)
  if (error) throw new Error('Failed to delete external conversation')
}
