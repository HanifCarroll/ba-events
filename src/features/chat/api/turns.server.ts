import type { RequestEvent } from '@sveltejs/kit'
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

export async function bootstrapChatTurn(event: RequestEvent, input: {
  conversationId: string; turnId: string; userClientMessageId: string
  assistantClientMessageId: string; content: string; locale: 'en' | 'es'
}) {
  const { data, error } = await client(event).rpc('bootstrap_chat_turn', {
    p_conversation_id: input.conversationId, p_turn_id: input.turnId,
    p_user_client_message_id: input.userClientMessageId,
    p_assistant_client_message_id: input.assistantClientMessageId,
    p_content: input.content, p_locale: input.locale
  })
  if (error || !data) throw new Error(error?.message ?? 'Failed to bootstrap chat turn')
  return (Array.isArray(data) ? data[0] : data) as ChatTurn
}

export async function claimChatTurn(event: RequestEvent, turnId: string, claimId: string, retry = false) {
  const { data, error } = await client(event).rpc('claim_chat_turn', {
    p_turn_id: turnId, p_claim_id: claimId, p_retry: retry
  })
  if (error || !data) throw new Error(error?.message ?? 'Failed to claim chat turn')
  return (Array.isArray(data) ? data[0] : data) as ChatTurn
}

export async function completeChatTurn(event: RequestEvent, input: {
  turnId: string; claimId: string; assistantClientMessageId: string; content: string
  attachedData: Record<string, unknown>; executionTrace: unknown[]
}) {
  const { data, error } = await client(event).rpc('complete_chat_turn', {
    p_turn_id: input.turnId, p_claim_id: input.claimId,
    p_assistant_client_message_id: input.assistantClientMessageId,
    p_content: input.content, p_attached_data: input.attachedData,
    p_execution_trace: input.executionTrace
  })
  if (error || !data) throw new Error(error?.message ?? 'Failed to complete chat turn')
  return (Array.isArray(data) ? data[0] : data) as ChatTurn
}

export async function failChatTurn(event: RequestEvent, turnId: string, claimId: string) {
  const { error } = await client(event).rpc('fail_chat_turn', {
    p_turn_id: turnId, p_claim_id: claimId, p_error_code: 'execution_failed'
  })
  if (error) throw new Error('Failed to update chat turn')
}

export async function getTurnAssistant(event: RequestEvent, turn: ChatTurn) {
  if (!turn.assistant_message_id) return null
  const { data, error } = await client(event).from('messages').select('*')
    .eq('id', turn.assistant_message_id).eq('conversation_id', turn.conversation_id).single()
  if (error || !data) return null
  const message = data as Message
  const canonical = (message.attached_data as { canonical?: CanonicalChatResponse } | null)?.canonical
  return canonical ? { id: message.id, canonical } : null
}

export async function getConversationTurns(event: RequestEvent, conversationId: string) {
  const { data, error } = await client(event).from('chat_turns').select('*')
    .eq('conversation_id', conversationId).order('created_at', { ascending: true })
  if (error) throw new Error('Failed to load chat turns')
  const turns = (data ?? []) as ChatTurn[]
	return turns.map((turn) =>
		effectiveTurnStatus(turn) !== turn.status
			? { ...turn, status: effectiveTurnStatus(turn) }
			: turn
	)
}
