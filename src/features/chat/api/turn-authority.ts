import type { ChatTurn } from './turns.server.ts'
import { Schema } from 'effect'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const uuidV1ToV5 = Schema.String.pipe(
	Schema.refine((value): value is string => UUID_RE.test(value), {
		message: 'Expected an RFC variant UUID with version 1-5',
	})
)

const chatTurnBootstrapSchema = Schema.Struct({
	conversationId: uuidV1ToV5,
	turnId: uuidV1ToV5,
	userClientMessageId: uuidV1ToV5,
	assistantClientMessageId: uuidV1ToV5,
	content: Schema.String,
	locale: Schema.Literals(['en', 'es']),
})

export type ChatTurnBootstrapInput = {
  conversationId: string
  turnId: string
  userClientMessageId: string
  assistantClientMessageId: string
  content: string
  locale: 'en' | 'es'
}

export function parseChatTurnBootstrapInput(body: unknown): ChatTurnBootstrapInput | null {
	const parsed = Schema.decodeUnknownResult(chatTurnBootstrapSchema)(body)
	return parsed._tag === 'Success' ? parsed.success : null
}

export function applyAuthoritativeTurn(input: {
  conversationId: string | null
  userClientMessageId: string | null
  assistantClientMessageId: string | null
  originalQuery: string
  locale: 'en' | 'es'
}, turn: ChatTurn) {
  return {
    ...input,
    conversationId: turn.conversation_id,
    userClientMessageId: turn.user_client_message_id,
    assistantClientMessageId: turn.assistant_client_message_id,
    originalQuery: turn.content,
    locale: turn.locale,
  }
}

export function mayRunProvider(turn: ChatTurn, requestId: string): boolean {
  return turn.status === 'running' && turn.claim_id === requestId
}
