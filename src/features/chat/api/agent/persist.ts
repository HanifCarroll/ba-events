/**
 * v4 server-side assistant persistence.
 *
 * The server-produced canonical response is authoritative: for authenticated
 * users the assistant message is written here (idempotently keyed by the
 * assistant clientMessageId) rather than reconstructed client-side. The client
 * retains its outbox retry path against the same idempotency key, so a failed
 * server write is recovered without ever duplicating a message.
 */

import type { RequestEvent } from '@sveltejs/kit'
import { addMessage } from '../messages.server.ts'
import { createSupabaseServerClient } from '#shared/lib/db/server-client.server.ts'
import { CHAT_CONTRACT_VERSION, type CanonicalChatResponse, type MessageExecutionStep } from '#shared/lib/types.ts'

export interface PersistAssistantInput {
  event: RequestEvent
  conversationId: string
  assistantClientMessageId: string
  userClientMessageId?: string | null
  canonical: CanonicalChatResponse
  executionTrace: MessageExecutionStep[]
}

export interface PersistAssistantResult {
  persisted: boolean
  messageId?: string
}

export async function persistAssistantMessageV4(
  input: PersistAssistantInput
): Promise<PersistAssistantResult> {
  const supabase = createSupabaseServerClient(input.event)
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { persisted: false }

  try {
    let parentMessageId: string | null = null
    if (input.userClientMessageId) {
      const { data } = await supabase
        .from('messages')
        .select('id')
        .eq('conversation_id', input.conversationId)
        .eq('client_message_id', input.userClientMessageId)
        .maybeSingle()
      if (data?.id) {
        parentMessageId = data.id as string
      } else {
        // The triggering user message could not be resolved. Inserting an
        // assistant against a stale/previous turn is worse than not inserting
        // at all — fail open and let the client outbox retry against the same
        // idempotency key once the user message lands.
        return { persisted: false }
      }
    }

    const message = await addMessage(input.event, {
      conversationId: input.conversationId,
      parentMessageId,
      role: 'assistant',
      clientMessageId: input.assistantClientMessageId,
      content: input.canonical.text,
      visibleContent: input.canonical.text,
      executionTrace: input.executionTrace,
      responseContractVersion: CHAT_CONTRACT_VERSION,
      attachedData: { canonical: input.canonical },
    })

    return { persisted: true, messageId: message.id }
  } catch (error) {
    console.error('[persist] server assistant persistence failed:', error)
    return { persisted: false }
  }
}
