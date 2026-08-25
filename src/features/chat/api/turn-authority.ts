import type { ChatTurn } from './turns.server.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type ChatTurnBootstrapInput = {
  conversationId: string
  turnId: string
  userClientMessageId: string
  assistantClientMessageId: string
  content: string
  locale: 'en' | 'es'
}

export function parseChatTurnBootstrapInput(body: unknown): ChatTurnBootstrapInput | null {
  if (!body || typeof body !== 'object') return null
  const input = body as Record<string, unknown>
  if (
    !UUID_RE.test(String(input.conversationId ?? '')) ||
    !UUID_RE.test(String(input.turnId ?? '')) ||
    !UUID_RE.test(String(input.userClientMessageId ?? '')) ||
    !UUID_RE.test(String(input.assistantClientMessageId ?? '')) ||
    typeof input.content !== 'string' ||
    (input.locale !== 'en' && input.locale !== 'es')
  ) {
    return null
  }
  return input as ChatTurnBootstrapInput
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
