import type { RequestEvent } from '@sveltejs/kit'
import { Data, Effect } from 'effect'
import { createSupabaseServerClient } from '#shared/lib/db/server-client.server.ts'
import type { CanonicalChatResponse, Message } from '#shared/lib/types.ts'

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

function client(event: RequestEvent) { return createSupabaseServerClient(event) }

class ChatTurnPersistenceError extends Data.TaggedError('ChatTurnPersistenceError')<{
  readonly message: string
}> {}

const turnFailure = (message: string) => new ChatTurnPersistenceError({ message })

function rpcResult<T>(value: T | T[] | null): T | null {
  return (Array.isArray(value) ? value[0] : value) as T | null
}

/** Effect-native chat-turn bootstrap program. */
export function bootstrapChatTurnEffect(event: RequestEvent, input: {
  conversationId: string; turnId: string; userClientMessageId: string
  assistantClientMessageId: string; content: string; locale: 'en' | 'es'
}) {
  return Effect.gen(function* () {
    const { data, error } = yield* Effect.tryPromise({
      try: () => client(event).rpc('bootstrap_chat_turn', {
        p_conversation_id: input.conversationId, p_turn_id: input.turnId,
        p_user_client_message_id: input.userClientMessageId,
        p_assistant_client_message_id: input.assistantClientMessageId,
        p_content: input.content, p_locale: input.locale
      }),
      catch: () => turnFailure('Failed to bootstrap chat turn'),
    })
    const turn = rpcResult<ChatTurn>(data)
    if (error || !turn) return yield* Effect.fail(turnFailure(error?.message ?? 'Failed to bootstrap chat turn'))
    return turn
  })
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
  return Effect.gen(function* () {
    const { data, error } = yield* Effect.tryPromise({
      try: () => client(event).rpc('claim_chat_turn', {
        p_turn_id: turnId, p_claim_id: claimId, p_retry: retry
      }),
      catch: () => turnFailure('Failed to claim chat turn'),
    })
    const turn = rpcResult<ChatTurn>(data)
    if (error || !turn) return yield* Effect.fail(turnFailure(error?.message ?? 'Failed to claim chat turn'))
    return turn
  })
}

export function claimChatTurn(event: RequestEvent, turnId: string, claimId: string, retry = false) {
  return Effect.runPromise(claimChatTurnEffect(event, turnId, claimId, retry))
}

/** Effect-native turn completion program. */
export function completeChatTurnEffect(event: RequestEvent, input: {
  turnId: string; claimId: string; assistantClientMessageId: string; content: string
  attachedData: Record<string, unknown>; executionTrace: unknown[]
}) {
  return Effect.gen(function* () {
    const { data, error } = yield* Effect.tryPromise({
      try: () => client(event).rpc('complete_chat_turn', {
        p_turn_id: input.turnId, p_claim_id: input.claimId,
        p_assistant_client_message_id: input.assistantClientMessageId,
        p_content: input.content, p_attached_data: input.attachedData,
        p_execution_trace: input.executionTrace
      }),
      catch: () => turnFailure('Failed to complete chat turn'),
    })
    const turn = rpcResult<ChatTurn>(data)
    if (error || !turn) return yield* Effect.fail(turnFailure(error?.message ?? 'Failed to complete chat turn'))
    return turn
  })
}

export function completeChatTurn(event: RequestEvent, input: {
  turnId: string; claimId: string; assistantClientMessageId: string; content: string
  attachedData: Record<string, unknown>; executionTrace: unknown[]
}) {
  return Effect.runPromise(completeChatTurnEffect(event, input))
}

/** Effect-native turn failure/update program. */
export function failChatTurnEffect(event: RequestEvent, turnId: string, claimId: string) {
  return Effect.gen(function* () {
    const { error } = yield* Effect.tryPromise({
      try: () => client(event).rpc('fail_chat_turn', {
        p_turn_id: turnId, p_claim_id: claimId, p_error_code: 'execution_failed'
      }),
      catch: () => turnFailure('Failed to update chat turn'),
    })
    if (error) return yield* Effect.fail(turnFailure('Failed to update chat turn'))
  })
}

export function failChatTurn(event: RequestEvent, turnId: string, claimId: string) {
  return Effect.runPromise(failChatTurnEffect(event, turnId, claimId))
}

/** Effect-native assistant lookup; a missing assistant remains a nullable result. */
export function getTurnAssistantEffect(event: RequestEvent, turn: ChatTurn) {
  if (!turn.assistant_message_id) return Effect.succeed(null)
  return Effect.match(
    Effect.tryPromise({
      try: () => client(event).from('messages').select('*')
        .eq('id', turn.assistant_message_id).eq('conversation_id', turn.conversation_id).single(),
      catch: () => turnFailure('Failed to load assistant message'),
    }),
    {
      onFailure: () => null,
      onSuccess: ({ data, error }) => {
        if (error || !data) return null
        const message = data as Message
        const canonical = (message.attached_data as { canonical?: CanonicalChatResponse } | null)?.canonical
        return canonical ? { id: message.id, canonical } : null
      },
    },
  )
}

export function getTurnAssistant(event: RequestEvent, turn: ChatTurn) {
  return Effect.runPromise(getTurnAssistantEffect(event, turn))
}

/** Effect-native ordered turn lookup. */
export function getConversationTurnsEffect(event: RequestEvent, conversationId: string) {
  return Effect.gen(function* () {
    const { data, error } = yield* Effect.tryPromise({
      try: () => client(event).from('chat_turns').select('*')
        .eq('conversation_id', conversationId).order('created_at', { ascending: true }),
      catch: () => turnFailure('Failed to load chat turns'),
    })
    if (error) return yield* Effect.fail(turnFailure('Failed to load chat turns'))
    const turns = (data ?? []) as ChatTurn[]
    return turns.map((turn) =>
      effectiveTurnStatus(turn) !== turn.status
        ? { ...turn, status: effectiveTurnStatus(turn) }
        : turn
    )
  })
}

export function getConversationTurns(event: RequestEvent, conversationId: string) {
  return Effect.runPromise(getConversationTurnsEffect(event, conversationId))
}
