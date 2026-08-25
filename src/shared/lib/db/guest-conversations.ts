import Dexie, { type EntityTable } from 'dexie'
import { CHAT_CONTRACT_VERSION } from '#shared/lib/types.ts'
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
  response_contract_version: number
  created_at: string
}

export interface GuestConversationWithMessages {
  conversation: GuestConversation
  messages: GuestMessage[]
  turns?: GuestTurn[]
}

export interface GuestTurn {
  id: string
  conversation_id: string
  user_client_message_id: string
  assistant_client_message_id: string
  content: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'interrupted'
  claim_id: string | null
  claimed_until?: number
	last_error?: string
}

export function effectiveGuestTurnStatus(turn: GuestTurn, now = Date.now()): GuestTurn['status'] {
	return turn.status === 'running' && turn.claimed_until !== undefined && turn.claimed_until <= now
		? 'interrupted'
		: turn.status
}

class GuestConversationsDB extends Dexie {
  conversations!: EntityTable<GuestConversation, 'id'>
  messages!: EntityTable<GuestMessage, 'id'>
  turns!: EntityTable<GuestTurn, 'id'>

  constructor() {
    super('ba-events-guest-conversations')
    this.version(1).stores({
      conversations: 'id, updated_at',
      messages:
        'id, conversation_id, client_message_id, created_at, [conversation_id+created_at]',
    })
    this.version(2).stores({
      conversations: 'id, updated_at',
      messages: 'id, conversation_id, client_message_id, created_at, [conversation_id+created_at]',
      turns: 'id, conversation_id, status, [conversation_id+status]'
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

	const turns = (await getGuestConversationsDB().turns.where('conversation_id').equals(id).toArray()).map((turn) =>
		effectiveGuestTurnStatus(turn) !== turn.status
			? { ...turn, status: effectiveGuestTurnStatus(turn) }
			: turn
	)
  return { conversation, messages, turns }
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
    responseContractVersion?: number
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
    response_contract_version: message.responseContractVersion ?? CHAT_CONTRACT_VERSION,
    created_at: now,
  })
  await touchGuestConversation(conversationId)
}

export async function bootstrapGuestTurn(input: {
  conversationId: string
  turnId: string
  userClientMessageId: string
  assistantClientMessageId: string
  content: string
}): Promise<GuestTurn> {
  const database = getGuestConversationsDB()
  return database.transaction(
    'rw',
    database.conversations,
    database.messages,
    database.turns,
    async () => {
      const existing = await database.turns.get(input.turnId)
      if (existing) {
        if (
          existing.conversation_id !== input.conversationId ||
          existing.user_client_message_id !== input.userClientMessageId ||
          existing.assistant_client_message_id !== input.assistantClientMessageId ||
          existing.content !== input.content
        ) {
          throw new Error('Turn conflict')
        }
        return existing
      }

      const conflictingTurn = (await database.turns
        .where('conversation_id')
        .equals(input.conversationId)
        .toArray())
        .find(
          (turn) =>
            turn.user_client_message_id === input.userClientMessageId ||
            turn.assistant_client_message_id === input.assistantClientMessageId
        )
      if (conflictingTurn) throw new Error('Turn conflict')

      const now = new Date().toISOString()
      const conversation = await database.conversations.get(input.conversationId)
      await database.conversations.put(
        conversation ?? {
          id: input.conversationId,
          title: null,
          created_at: now,
          updated_at: now,
        }
      )
      if (conversation) {
        await database.conversations.update(input.conversationId, { updated_at: now })
      }

      const turn: GuestTurn = {
        id: input.turnId,
        conversation_id: input.conversationId,
        user_client_message_id: input.userClientMessageId,
        assistant_client_message_id: input.assistantClientMessageId,
        content: input.content,
        status: 'pending',
        claim_id: null,
        claimed_until: undefined,
      }
      await database.messages.put({
        id: input.userClientMessageId,
        conversation_id: input.conversationId,
        client_message_id: input.userClientMessageId,
        parent_message_id: null,
        role: 'user',
        content: input.content,
        visible_content: input.content,
        execution_trace: [],
        attached_data: {},
        response_contract_version: CHAT_CONTRACT_VERSION,
        created_at: now,
      })
      await database.turns.put(turn)
      return turn
    }
  )
}

export async function claimGuestTurn(turnId: string, claimId: string, retry = false): Promise<GuestTurn | null> {
  const database = getGuestConversationsDB()
  return database.transaction('rw', database.turns, async () => {
    const turn = await database.turns.get(turnId)
    if (!turn || turn.status === 'completed') return turn ?? null
    if (turn.status === 'running' && (turn.claimed_until ?? 0) > Date.now()) return turn
	if (turn.status === 'running' && !retry) {
		const interrupted = { ...turn, status: 'interrupted' as const, claimed_until: undefined }
		await database.turns.put(interrupted)
		return interrupted
    }
    if ((turn.status === 'failed' || turn.status === 'interrupted') && !retry) return turn
    const claimed = { ...turn, status: 'running' as const, claim_id: claimId, claimed_until: Date.now() + 120_000 }
    await database.turns.put(claimed)
    return claimed
  })
}

export async function completeGuestTurn(turnId: string, claimId: string): Promise<void> {
  const database = getGuestConversationsDB()
  await database.transaction('rw', database.turns, async () => {
    const turn = await database.turns.get(turnId)
    if (!turn || turn.status === 'completed') return
    if (turn.claim_id !== claimId) throw new Error('Turn claim lost')
    await database.turns.put({ ...turn, status: 'completed', claimed_until: undefined })
  })
}

export async function failGuestTurn(turnId: string, claimId: string): Promise<void> {
  const database = getGuestConversationsDB()
  await database.transaction('rw', database.turns, async () => {
    const turn = await database.turns.get(turnId)
    if (!turn || turn.status === 'completed' || turn.claim_id !== claimId) return
    await database.turns.put({ ...turn, status: 'failed', claimed_until: undefined, last_error: 'execution_failed' })
  })
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
