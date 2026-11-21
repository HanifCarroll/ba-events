import { Data, Effect } from 'effect'
import type { RequestEvent } from '@sveltejs/kit'
import type {
  Conversation,
  ConversationInsert,
  ConversationUpdate,
  ConversationListItem,
  ConversationWithMessages,
} from '#shared/lib/types.ts'
import {
  compareMessagesByTurnOrderAsc,
  sortMessagesByTurnOrderAsc,
} from '#features/chat/lib/message-order.ts'
import { withReadSignal } from '#shared/lib/db/read-signal.ts'
import { requireD1 } from '#shared/lib/db/d1-binding.server.ts'
import * as d1 from './chat-d1.server.ts'

class ConversationPersistenceError extends Data.TaggedError('ConversationPersistenceError')<{
  readonly message: string
}> {}

class ConversationAuthError extends Data.TaggedError('ConversationAuthError')<{
  readonly message: string
}> {}

const persistenceFailure = (message: string) => new ConversationPersistenceError({ message })
const authFailure = (message: string) => new ConversationAuthError({ message })

function d1Effect<A>(work: (signal: AbortSignal) => Promise<A>, message: string) {
  return Effect.tryPromise({ try: work, catch: () => persistenceFailure(message) })
}

/** The newest message of each conversation, at most 140 characters. */
function previewsByConversation(rows: d1.PreviewRow[]): Map<string, string> {
  const latestByConversation = new Map<string, d1.PreviewRow>()
  for (const row of rows) {
    const existing = latestByConversation.get(row.conversation_id)
    if (!existing || compareMessagesByTurnOrderAsc(
      { id: existing.id, role: existing.role, turn_index: existing.turn_index, sequence_number: existing.sequence_number },
      { id: row.id, role: row.role, turn_index: row.turn_index, sequence_number: row.sequence_number },
    ) < 0) {
      latestByConversation.set(row.conversation_id, row)
    }
  }
  const previews = new Map<string, string>()
  for (const [conversationId, row] of latestByConversation) {
    const preview = (row.visible_content ?? row.content ?? '').trim()
    if (preview) previews.set(conversationId, preview.slice(0, 140))
  }
  return previews
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Effect-native list program. Promise adapters belong at framework roots. */
export function listConversationsEffect(
  event: RequestEvent,
  data: { limit?: number; offset?: number; search?: string } = {},
) {
  const userId = event.locals?.user?.id
  if (!userId) return Effect.succeed({ conversations: [] as ConversationListItem[], total: 0 })
  return d1Effect(async () => {
    const page = await d1.listConversations(requireD1(), userId, data.limit ?? 50, data.offset ?? 0)
    const previews = previewsByConversation(page.previews)
    return {
      conversations: page.conversations.map((conversation) => ({ ...conversation, preview: previews.get(conversation.id) })),
      total: page.total,
    }
  }, 'Failed to list conversations')
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
  const userId = event.locals?.user?.id
  if (!userId) return Effect.succeed([] as ConversationListItem[])
  const limit = data.limit ?? 20
  return d1Effect(async () => {
    const seen = new Set<string>()
    const results: ConversationListItem[] = []
    for (const row of await d1.searchConversations(requireD1(), userId, data.query, limit)) {
      if (seen.has(row.conversation_id) || results.length >= limit) continue
      seen.add(row.conversation_id)
      results.push({ id: row.conversation_id, title: row.title, updated_at: row.updated_at,
        preview: (row.visible_content ?? row.content).slice(0, 100) })
    }
    return results
  }, 'Failed to search conversations')
}

/** Search conversation previews by message content. */
export function searchConversations(event: RequestEvent, data: { query: string; limit?: number }) {
  return Effect.runPromise(searchConversationsEffect(event, data))
}

/** Effect-native conversation read program. */
export function getConversationEffect(event: RequestEvent, data: { id: string }) {
  const userId = event.locals?.user?.id
  if (!userId) return Effect.succeed(null)
  return d1Effect(async signal => {
    const conversation = await withReadSignal(() => d1.getConversation(requireD1(), userId, data.id), signal)
    return conversation
      ? { ...conversation, messages: sortMessagesByTurnOrderAsc(conversation.messages) } as ConversationWithMessages
      : null
  }, 'Failed to get conversation')
}

/** Get a conversation and its ordered messages. */
export function getConversation(event: RequestEvent, data: { id: string }) {
  return Effect.runPromise(getConversationEffect(event, data), { signal: event.request?.signal })
}

/** Effect-native conversation creation program. */
export function createConversationEffect(event: RequestEvent, data: ConversationInsert) {
  return Effect.gen(function* () {
    if (data.id && !UUID_RE.test(data.id)) return yield* persistenceFailure('Failed to create conversation')
    const userId = event.locals?.user?.id
    if (!userId) return yield* authFailure('Not authenticated')
    return yield* d1Effect(() => d1.createConversation(requireD1(), userId, data), 'Failed to create conversation')
  })
}

/** Create an authenticated conversation, retaining idempotent client ids. */
export function createConversation(event: RequestEvent, data: ConversationInsert) {
  return Effect.runPromise(createConversationEffect(event, data))
}

/** Effect-native conversation update program. */
export function updateConversationEffect(event: RequestEvent, data: { id: string; updates: ConversationUpdate }): Effect.Effect<Conversation, ConversationAuthError | ConversationPersistenceError> {
  const userId = event.locals?.user?.id
  if (!userId) return Effect.fail(authFailure('Not authenticated'))
  return d1Effect(() => d1.updateConversation(requireD1(), userId, data.id, data.updates), 'Failed to update conversation')
}

export function updateConversation(event: RequestEvent, data: { id: string; updates: ConversationUpdate }) {
  return Effect.runPromise(updateConversationEffect(event, data))
}

/** Effect-native conversation deletion program. */
export function deleteConversationEffect(event: RequestEvent, data: { id: string }): Effect.Effect<{ success: boolean }, ConversationAuthError | ConversationPersistenceError> {
  const userId = event.locals?.user?.id
  if (!userId) return Effect.fail(authFailure('Not authenticated'))
  return d1Effect(async () => { await d1.softDeleteConversation(requireD1(), userId, data.id); return { success: true } },
    'Failed to delete conversation')
}

export function deleteConversation(event: RequestEvent, data: { id: string }) {
  return Effect.runPromise(deleteConversationEffect(event, data))
}
