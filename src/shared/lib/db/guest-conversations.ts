import Dexie, { type EntityTable } from 'dexie'
import type {
  MessageAttachedData,
  MessageExecutionStep,
  MessageRole,
} from '#shared/lib/types.ts'

/**
 * Client-side persistence for guest (not signed-in) conversations.
 *
 * Signed-in conversations live in Supabase and are resolved server-side.
 * Guests have no server record, so their chats are stored in IndexedDB and
 * keyed by a client-generated id that travels in the URL (`/chat/:id`).
 * That makes a guest chat URL resolvable on the same browser (reload,
 * back/forward, open-from-history) but not on another device.
 */

export interface GuestConversation {
  id: string
  title: string | null
  created_at: string
  updated_at: string
}

export interface GuestMessage {
  id: string
  conversation_id: string
  client_message_id: string
  parent_message_id: string | null
  role: MessageRole
  content: string
  visible_content: string
  execution_trace: MessageExecutionStep[]
  attached_data: MessageAttachedData
  created_at: string
}

export interface GuestConversationWithMessages {
  conversation: GuestConversation
  messages: GuestMessage[]
}

class GuestConversationsDB extends Dexie {
  conversations!: EntityTable<GuestConversation, 'id'>
  messages!: EntityTable<GuestMessage, 'id'>

  constructor() {
    super('ba-events-guest-conversations')
    this.version(1).stores({
      conversations: 'id, updated_at',
      messages:
        'id, conversation_id, client_message_id, created_at, [conversation_id+created_at]',
    })
  }
}

let db: GuestConversationsDB | null = null

function getGuestConversationsDB(): GuestConversationsDB {
  if (!db) {
    db = new GuestConversationsDB()
  }
  return db
}

export async function createGuestConversation(
  id: string,
  title?: string
): Promise<void> {
  const now = new Date().toISOString()
  await getGuestConversationsDB().conversations.put({
    id,
    title: title ?? null,
    created_at: now,
    updated_at: now,
  })
}

export async function getGuestConversation(
  id: string
): Promise<GuestConversation | undefined> {
  return getGuestConversationsDB().conversations.get(id)
}

export async function listGuestConversations(): Promise<GuestConversation[]> {
  return getGuestConversationsDB().conversations.orderBy('updated_at').reverse().toArray()
}

export async function getGuestConversationWithMessages(
  id: string
): Promise<GuestConversationWithMessages | null> {
  const conversation = await getGuestConversationsDB().conversations.get(id)
  if (!conversation) return null

  const messages = await getGuestConversationsDB()
    .messages.where('conversation_id')
    .equals(id)
    .sortBy('created_at')

  return { conversation, messages }
}

export async function addGuestMessage(
  conversationId: string,
  message: {
    id: string
    clientMessageId: string
    parentMessageId?: string | null
    role: MessageRole
    content: string
    visibleContent?: string
    executionTrace?: MessageExecutionStep[]
    attachedData?: MessageAttachedData
  }
): Promise<void> {
  const now = new Date().toISOString()
  await getGuestConversationsDB().messages.put({
    id: message.id,
    conversation_id: conversationId,
    client_message_id: message.clientMessageId,
    parent_message_id: message.parentMessageId ?? null,
    role: message.role,
    content: message.content,
    visible_content: message.visibleContent ?? message.content,
    execution_trace: message.executionTrace ?? [],
    attached_data: message.attachedData ?? {},
    created_at: now,
  })
  await touchGuestConversation(conversationId)
}

export async function touchGuestConversation(id: string): Promise<void> {
  await getGuestConversationsDB().conversations.update(id, {
    updated_at: new Date().toISOString(),
  })
}

export async function setGuestConversationTitle(
  id: string,
  title: string
): Promise<void> {
  await getGuestConversationsDB().conversations.update(id, {
    title,
    updated_at: new Date().toISOString(),
  })
}

export async function deleteGuestConversation(id: string): Promise<void> {
  const messageIds = await getGuestConversationsDB()
    .messages.where('conversation_id')
    .equals(id)
    .primaryKeys()
  await getGuestConversationsDB().messages.bulkDelete(messageIds)
  await getGuestConversationsDB().conversations.delete(id)
}
