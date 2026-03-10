import Dexie, { type EntityTable } from 'dexie'
import type {
  MessageAttachedData,
  MessageExecutionStep,
  MessageRole,
} from '@/shared/lib/types'

export type LocalOutboxStatus = 'pending' | 'failed'

export interface LocalOutboxItem {
  id: string
  conversation_id: string
  client_message_id: string
  parent_message_id: string | null
  role: MessageRole
  content: string
  visible_content: string
  execution_trace: MessageExecutionStep[]
  response_contract_version: number
  attached_data: MessageAttachedData
  attempt_count: number
  next_retry_at: string
  status: LocalOutboxStatus
  last_error: string | null
  created_at: string
  updated_at: string
}

class LocalOutboxDB extends Dexie {
  outbox!: EntityTable<LocalOutboxItem, 'id'>

  constructor() {
    super('ba-events-message-outbox')
    this.version(1).stores({
      outbox:
        'id, conversation_id, client_message_id, parent_message_id, [conversation_id+client_message_id], status, next_retry_at, updated_at',
    })
  }
}

let db: LocalOutboxDB | null = null

function getLocalOutboxDB(): LocalOutboxDB {
  if (!db) {
    db = new LocalOutboxDB()
  }

  return db
}

function generateUUID(): string {
  return crypto.randomUUID()
}

export async function addOutboxItem(
  item: Omit<LocalOutboxItem, 'id' | 'created_at' | 'updated_at' | 'status' | 'last_error'>
): Promise<LocalOutboxItem> {
  const database = getLocalOutboxDB()
  const now = new Date().toISOString()

  const outboxItem: LocalOutboxItem = {
    id: generateUUID(),
    status: 'pending',
    last_error: null,
    created_at: now,
    updated_at: now,
    ...item,
  }

  await database.outbox.add(outboxItem)
  return outboxItem
}

export async function listDueOutboxItems(
  nowIso: string = new Date().toISOString()
): Promise<LocalOutboxItem[]> {
  const database = getLocalOutboxDB()
  return database.outbox
    .where('next_retry_at')
    .belowOrEqual(nowIso)
    .filter((item) => item.status === 'pending')
    .sortBy('updated_at')
}

export async function updateOutboxItem(
  id: string,
  updates: Partial<Omit<LocalOutboxItem, 'id' | 'created_at'>>
): Promise<void> {
  const database = getLocalOutboxDB()
  await database.outbox.update(id, {
    ...updates,
    updated_at: new Date().toISOString(),
  })
}

export async function deleteOutboxItem(id: string): Promise<void> {
  const database = getLocalOutboxDB()
  await database.outbox.delete(id)
}

export async function getOutboxItemByClientMessageId(
  conversationId: string,
  clientMessageId: string
): Promise<LocalOutboxItem | undefined> {
  const database = getLocalOutboxDB()
  return database.outbox
    .where('[conversation_id+client_message_id]')
    .equals([conversationId, clientMessageId])
    .first()
}
