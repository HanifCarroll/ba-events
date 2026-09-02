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
import { Data, Effect } from 'effect'
import { addMessageEffect } from '../messages.server.ts'
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

class AssistantPersistenceError extends Data.TaggedError('AssistantPersistenceError')<{
  readonly message: string
}> {}

const persistenceFailure = (message: string) => new AssistantPersistenceError({ message })

/** Effect-native assistant persistence program. It deliberately fails open. */
export function persistAssistantMessageV4Effect(
  input: PersistAssistantInput
): Effect.Effect<PersistAssistantResult, AssistantPersistenceError> {
  const program = Effect.gen(function* () {
    const supabase = createSupabaseServerClient(input.event)
    const {
      data: { user },
    } = yield* Effect.tryPromise({
      try: () => supabase.auth.getUser(),
      catch: () => persistenceFailure('Failed to read authenticated user'),
    })
    if (!user) return { persisted: false } satisfies PersistAssistantResult

    let parentMessageId: string | null = null
    if (input.userClientMessageId) {
      const { data } = yield* Effect.tryPromise({
        try: () => supabase
          .from('messages')
          .select('id')
          .eq('conversation_id', input.conversationId)
          .eq('client_message_id', input.userClientMessageId)
          .maybeSingle(),
        catch: () => persistenceFailure('Failed to find triggering user message'),
      })
      if (data?.id) {
        parentMessageId = data.id as string
      } else {
        // The triggering user message could not be resolved. Inserting an
        // assistant against a stale/previous turn is worse than not inserting
        // at all — fail open and let the client outbox retry against the same
        // idempotency key once the user message lands.
        return { persisted: false } satisfies PersistAssistantResult
      }
    }

    const message = yield* addMessageEffect(input.event, {
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

    return { persisted: true, messageId: message.id } satisfies PersistAssistantResult
  })

  return Effect.match(program, {
    onFailure: (error) => {
      console.error('[persist] server assistant persistence failed:', error)
      return { persisted: false } satisfies PersistAssistantResult
    },
    onSuccess: (result) => result,
  })
}

/** Promise compatibility adapter for the SvelteKit chat route. */
export function persistAssistantMessageV4(input: PersistAssistantInput) {
  return Effect.runPromise(persistAssistantMessageV4Effect(input))
}
