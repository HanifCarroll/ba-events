/**
 * IndexedDB storage for anonymous user conversations using Dexie.js
 *
 * This provides local persistence for users who haven't logged in yet.
 * When they sign up/login, their conversations are migrated to PostgreSQL.
 */
import Dexie, { type EntityTable } from 'dexie'
import type {
  MessageAttachedData,
  MessageExecutionStep,
  MessageRole,
  MigrationConversation,
} from '@/shared/lib/types'

// Local conversation record
interface LocalConversation {
  id: string
  title: string
  created_at: string
  updated_at: string
}

// Local message record
interface LocalMessage {
  id: string
  conversation_id: string
  role: MessageRole
  content: string
  visible_content: string
  execution_trace: MessageExecutionStep[]
  response_contract_version: number
  attached_data: MessageAttachedData
  created_at: string
  sequence_number: number
}

// Session metadata (anonymous ID, etc.)
interface LocalSession {
  key: string
  value: string
}

// Dexie database schema
class LocalConversationsDB extends Dexie {
  conversations!: EntityTable<LocalConversation, 'id'>
  messages!: EntityTable<LocalMessage, 'id'>
  session!: EntityTable<LocalSession, 'key'>

  constructor() {
    super('ba-events-conversations')
    this.version(1).stores({
      conversations: 'id, updated_at',
      messages: 'id, conversation_id, [conversation_id+sequence_number]',
      session: 'key',
    })

    this.version(2)
      .stores({
        conversations: 'id, updated_at',
        messages: 'id, conversation_id, [conversation_id+sequence_number]',
        session: 'key',
      })
      .upgrade((tx) => {
        return tx
          .table('messages')
          .toCollection()
          .modify((msg: Partial<LocalMessage> & { content?: string }) => {
            if (typeof msg.visible_content !== 'string') {
              msg.visible_content = typeof msg.content === 'string' ? msg.content : ''
            }
            if (!Array.isArray(msg.execution_trace)) {
              msg.execution_trace = []
            }
            if (typeof msg.response_contract_version !== 'number') {
              msg.response_contract_version = 1
            }
          })
      })
  }
}

// Singleton database instance
let db: LocalConversationsDB | null = null

/**
 * Get the local conversations database instance.
 * Lazy-initializes on first call.
 */
export function getLocalDB(): LocalConversationsDB {
  if (!db) {
    db = new LocalConversationsDB()
  }
  return db
}

/**
 * Generate a UUID v4
 */
function generateUUID(): string {
  return crypto.randomUUID()
}

/**
 * Get or create an anonymous user ID for this browser.
 * Used to identify conversations that should be migrated on signup.
 */
export async function getAnonymousId(): Promise<string> {
  const db = getLocalDB()
  const existing = await db.session.get('anonymous_id')

  if (existing) {
    return existing.value
  }

  const newId = generateUUID()
  await db.session.put({ key: 'anonymous_id', value: newId })
  return newId
}

/**
 * List all local conversations ordered by most recent first.
 */
export async function listLocalConversations(): Promise<LocalConversation[]> {
  const db = getLocalDB()
  return db.conversations.orderBy('updated_at').reverse().toArray()
}

/**
 * Get a single conversation by ID.
 */
export async function getLocalConversation(id: string): Promise<LocalConversation | undefined> {
  const db = getLocalDB()
  return db.conversations.get(id)
}

/**
 * Get a conversation with all its messages.
 */
export async function getLocalConversationWithMessages(
  id: string
): Promise<{ conversation: LocalConversation; messages: LocalMessage[] } | null> {
  const db = getLocalDB()
  const conversation = await db.conversations.get(id)

  if (!conversation) {
    return null
  }

  const messages = await db.messages.where('conversation_id').equals(id).sortBy('sequence_number')

  return { conversation, messages }
}

/**
 * Create a new local conversation.
 */
export async function createLocalConversation(
  title: string = 'New conversation'
): Promise<LocalConversation> {
  const db = getLocalDB()
  const now = new Date().toISOString()

  const conversation: LocalConversation = {
    id: generateUUID(),
    title,
    created_at: now,
    updated_at: now,
  }

  await db.conversations.add(conversation)
  return conversation
}

/**
 * Update a local conversation (title, updated_at).
 */
export async function updateLocalConversation(
  id: string,
  updates: Partial<Pick<LocalConversation, 'title' | 'updated_at'>>
): Promise<void> {
  const db = getLocalDB()
  await db.conversations.update(id, {
    ...updates,
    updated_at: new Date().toISOString(),
  })
}

/**
 * Delete a local conversation and all its messages.
 */
export async function deleteLocalConversation(id: string): Promise<void> {
  const db = getLocalDB()
  await db.transaction('rw', [db.conversations, db.messages], async () => {
    await db.messages.where('conversation_id').equals(id).delete()
    await db.conversations.delete(id)
  })
}

/**
 * Add a message to a local conversation.
 */
export async function addLocalMessage(
  conversationId: string,
  message: {
    role: MessageRole
    content: string
    visible_content?: string
    execution_trace?: MessageExecutionStep[]
    response_contract_version?: number
    attached_data?: MessageAttachedData
  }
): Promise<LocalMessage> {
  const db = getLocalDB()

  // Get the next sequence number for this conversation
  const lastMessage = await db.messages
    .where('conversation_id')
    .equals(conversationId)
    .reverse()
    .first()

  const sequenceNumber = lastMessage ? lastMessage.sequence_number + 1 : 0

  const newMessage: LocalMessage = {
    id: generateUUID(),
    conversation_id: conversationId,
    role: message.role,
    content: message.content,
    visible_content: message.visible_content ?? message.content,
    execution_trace: message.execution_trace ?? [],
    response_contract_version: message.response_contract_version ?? 2,
    attached_data: message.attached_data ?? {},
    created_at: new Date().toISOString(),
    sequence_number: sequenceNumber,
  }

  await db.messages.add(newMessage)

  // Update conversation's updated_at
  await db.conversations.update(conversationId, {
    updated_at: new Date().toISOString(),
  })

  return newMessage
}

/**
 * Get all messages for a conversation ordered by sequence number.
 */
export async function getLocalMessages(conversationId: string): Promise<LocalMessage[]> {
  const db = getLocalDB()
  return db.messages.where('conversation_id').equals(conversationId).sortBy('sequence_number')
}

/**
 * Search local conversations by message content.
 */
export async function searchLocalConversations(query: string): Promise<LocalConversation[]> {
  const db = getLocalDB()
  const lowerQuery = query.toLowerCase()

  // Find all messages matching the query
  const matchingMessages = await db.messages
    .filter((msg) => (msg.visible_content ?? msg.content).toLowerCase().includes(lowerQuery))
    .toArray()

  // Get unique conversation IDs
  const conversationIds = [...new Set(matchingMessages.map((m) => m.conversation_id))]

  // Fetch those conversations
  const conversations = await db.conversations.bulkGet(conversationIds)

  // Filter out undefined and sort by updated_at
  return conversations
    .filter((c): c is LocalConversation => c !== undefined)
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
}

/**
 * Get all local conversations formatted for migration to the server.
 * Returns conversations with their messages in the format expected by the migration API.
 */
export async function getConversationsForMigration(): Promise<MigrationConversation[]> {
  const db = getLocalDB()
  const conversations = await db.conversations.toArray()

  const result: MigrationConversation[] = []

  for (const conv of conversations) {
    const messages = await db.messages
      .where('conversation_id')
      .equals(conv.id)
      .sortBy('sequence_number')

    result.push({
      local_id: conv.id,
      title: conv.title,
      created_at: conv.created_at,
      updated_at: conv.updated_at,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        visible_content: m.visible_content,
        execution_trace: m.execution_trace,
        response_contract_version: m.response_contract_version,
        attached_data: m.attached_data,
        created_at: m.created_at,
        sequence_number: m.sequence_number,
      })),
    })
  }

  return result
}

/**
 * Check if there are any local conversations to migrate.
 */
export async function hasLocalConversations(): Promise<boolean> {
  const db = getLocalDB()
  const count = await db.conversations.count()
  return count > 0
}

/**
 * Clear all local conversations after successful migration.
 * Also clears the anonymous ID.
 */
export async function clearLocalConversations(): Promise<void> {
  const db = getLocalDB()
  await db.transaction('rw', [db.conversations, db.messages, db.session], async () => {
    await db.messages.clear()
    await db.conversations.clear()
    await db.session.delete('anonymous_id')
  })
}

/**
 * Get a preview (first user message) for a conversation.
 * Used for displaying in the conversation list.
 */
export async function getConversationPreview(conversationId: string): Promise<string | null> {
  const db = getLocalDB()
  const firstUserMessage = await db.messages
    .where('conversation_id')
    .equals(conversationId)
    .filter((m) => m.role === 'user')
    .first()

  if (!firstUserMessage) {
    return null
  }

  // Truncate to first 100 characters
  const preview = firstUserMessage.content.slice(0, 100)
  return preview.length < firstUserMessage.content.length ? `${preview}...` : preview
}

// Re-export types for convenience
export type { LocalConversation, LocalMessage }
