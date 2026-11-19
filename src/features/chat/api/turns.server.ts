import type { RequestEvent } from '@sveltejs/kit'
import { Data, Effect } from 'effect'
import { boundD1 } from '#shared/lib/db/d1-binding.server.ts'
import * as d1 from './chat-d1.server.ts'
import type { CanonicalChatResponse } from '#shared/lib/types.ts'

export type ChatTurn = {
  id: string
  conversation_id: string
  user_message_id: string
  assistant_message_id: string | null
  user_client_message_id: string
  assistant_client_message_id: string
  content: string
  locale: 'en' | 'es'
  status: 'pending' | 'running' | 'completed' | 'failed' | 'interrupted'
  claim_id: string | null
  claimed_until: string | null
  attempt_count: number
  last_error: string | null
}

export function effectiveTurnStatus(turn: ChatTurn, now = Date.now()): ChatTurn['status'] {
	return turn.status === 'running' && turn.claimed_until && new Date(turn.claimed_until).getTime() <= now
		? 'interrupted'
		: turn.status
}

class ChatTurnPersistenceError extends Data.TaggedError('ChatTurnPersistenceError')<{
  readonly message: string
}> {}

const turnFailure = (message: string) => new ChatTurnPersistenceError({ message })

function onD1<A>(event: RequestEvent, fallback: string, work: (db: NonNullable<ReturnType<typeof boundD1>>, userId: string) => Promise<A>) {
  const db = boundD1()
  if (!db) return Effect.fail(turnFailure(fallback))
  const userId = event.locals?.user?.id
  if (!userId) return Effect.fail(turnFailure('Not authenticated'))
  return Effect.tryPromise({
    try: () => work(db, userId),
    catch: (cause) => turnFailure(cause instanceof d1.ChatStoreError ? cause.message : fallback),
  })
}

/** Effect-native chat-turn bootstrap program. */
export function bootstrapChatTurnEffect(event: RequestEvent, input: {
  conversationId: string; turnId: string; userClientMessageId: string
  assistantClientMessageId: string; content: string; locale: 'en' | 'es'
}) {
  return onD1(event, 'Failed to bootstrap chat turn', (db, userId) => d1.bootstrapTurn(db, userId, input))
}

/** Promise compatibility adapter for SvelteKit and existing callers. */
export function bootstrapChatTurn(event: RequestEvent, input: {
  conversationId: string; turnId: string; userClientMessageId: string
  assistantClientMessageId: string; content: string; locale: 'en' | 'es'
}) {
  return Effect.runPromise(bootstrapChatTurnEffect(event, input))
}

/** Effect-native turn claim program. */
export function claimChatTurnEffect(event: RequestEvent, turnId: string, claimId: string, retry = false) {
  return onD1(event, 'Failed to claim chat turn', (db, userId) => d1.claimTurn(db, userId, turnId, claimId, retry))
}

export function claimChatTurn(event: RequestEvent, turnId: string, claimId: string, retry = false) {
  return Effect.runPromise(claimChatTurnEffect(event, turnId, claimId, retry))
}

/** Effect-native turn completion program. */
export function completeChatTurnEffect(event: RequestEvent, input: {
  turnId: string; claimId: string; assistantClientMessageId: string; content: string
  attachedData: Record<string, unknown>; executionTrace: unknown[]
}) {
  return onD1(event, 'Failed to complete chat turn', (db, userId) => d1.completeTurn(db, userId, input))
}

export function completeChatTurn(event: RequestEvent, input: {
  turnId: string; claimId: string; assistantClientMessageId: string; content: string
  attachedData: Record<string, unknown>; executionTrace: unknown[]
}) {
  return Effect.runPromise(completeChatTurnEffect(event, input))
}

/** Effect-native turn failure/update program. */
export function failChatTurnEffect(event: RequestEvent, turnId: string, claimId: string) {
  return onD1(event, 'Failed to update chat turn',
    async (db, userId) => { await d1.failTurn(db, userId, turnId, claimId, 'execution_failed') })
}

export function failChatTurn(event: RequestEvent, turnId: string, claimId: string) {
  return Effect.runPromise(failChatTurnEffect(event, turnId, claimId))
}

/** Effect-native assistant lookup; a missing assistant remains a nullable result. */
export function getTurnAssistantEffect(event: RequestEvent, turn: ChatTurn) {
  if (!turn.assistant_message_id) return Effect.succeed(null)
  return Effect.match(
    onD1(event, 'Failed to load assistant message', (db, userId) => d1.getTurnAssistantMessage(db, userId, turn)),
    {
      onFailure: () => null,
      onSuccess: (message) => {
        const canonical = (message?.attached_data as { canonical?: CanonicalChatResponse } | null)?.canonical
        return message && canonical ? { id: message.id, canonical } : null
      },
    },
  )
}

export function getTurnAssistant(event: RequestEvent, turn: ChatTurn) {
  return Effect.runPromise(getTurnAssistantEffect(event, turn))
}

/** Effect-native ordered turn lookup. */
export function getConversationTurnsEffect(event: RequestEvent, conversationId: string) {
  return Effect.map(
    onD1(event, 'Failed to load chat turns', (db, userId) => d1.listTurns(db, userId, conversationId)),
    (turns) => turns.map(turn => {
      const status = effectiveTurnStatus(turn)
      return status === turn.status ? turn : { ...turn, status }
    }),
  )
}

export function getConversationTurns(event: RequestEvent, conversationId: string) {
  return Effect.runPromise(getConversationTurnsEffect(event, conversationId))
}
