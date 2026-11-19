import { Data, Effect } from 'effect'
import type { RequestEvent } from '@sveltejs/kit'
import type { Message, MessageAttachedData, MessageExecutionStep } from '#shared/lib/types.ts'
import { sortMessagesByTurnOrderAsc } from '#features/chat/lib/message-order.ts'
import { CHAT_CONTRACT_VERSION } from '#shared/lib/types.ts'
import { requireD1 } from '#shared/lib/db/d1-binding.server.ts'
import * as d1 from './chat-d1.server.ts'

export type AddMessageInput = {
  conversationId: string
  parentMessageId?: string | null
  role: 'user' | 'assistant' | 'system'
  clientMessageId?: string
  content: string
  visibleContent?: string
  executionTrace?: MessageExecutionStep[]
  responseContractVersion?: number
  attachedData?: MessageAttachedData
}

class MessagePersistenceError extends Data.TaggedError('MessagePersistenceError')<{
  readonly message: string
}> {}

class MessageAuthError extends Data.TaggedError('MessageAuthError')<{
  readonly message: string
}> {}

const persistenceFailure = (message: string) => new MessagePersistenceError({ message })
const authFailure = (message: string) => new MessageAuthError({ message })

function d1Effect<A>(work: () => Promise<A>, message: string) {
  return Effect.tryPromise({ try: work, catch: () => persistenceFailure(message) })
}

/** Effect-native message insertion program. */
export function addMessageEffect(event: RequestEvent, data: AddMessageInput): Effect.Effect<Message, MessageAuthError | MessagePersistenceError> {
  const userId = event.locals?.user?.id
  if (!userId) return Effect.fail(authFailure('Not authenticated'))
  return d1Effect(() => d1.insertMessage(requireD1(), { userId }, {
    conversationId: data.conversationId, role: data.role, content: data.content,
    visibleContent: data.visibleContent ?? data.content, executionTrace: data.executionTrace ?? [],
    responseContractVersion: data.responseContractVersion ?? CHAT_CONTRACT_VERSION, attachedData: data.attachedData ?? {},
    clientMessageId: data.clientMessageId ?? null, parentId: data.parentMessageId ?? null,
  }), 'Failed to add message')
}

/** Add a message, preserving the Promise contract used by Svelte remotes. */
export function addMessage(event: RequestEvent, data: AddMessageInput) {
  return Effect.runPromise(addMessageEffect(event, data))
}

/** Effect-native message list program. */
export function getMessagesEffect(event: RequestEvent, data: { conversationId: string }) {
  const userId = event.locals?.user?.id
  if (!userId) return Effect.succeed([] as Message[])
  return d1Effect(async () => sortMessagesByTurnOrderAsc(await d1.getMessages(requireD1(), userId, data.conversationId)), 'Failed to get messages')
}

export function getMessages(event: RequestEvent, data: { conversationId: string }) {
  return Effect.runPromise(getMessagesEffect(event, data))
}

/** Effect-native message attachment update program. */
export function updateMessageAttachedDataEffect(
  event: RequestEvent,
  data: { messageId: string; attachedData: MessageAttachedData },
): Effect.Effect<Message, MessageAuthError | MessagePersistenceError> {
  const userId = event.locals?.user?.id
  if (!userId) return Effect.fail(authFailure('Not authenticated'))
  return d1Effect(() => d1.updateMessageAttachedData(requireD1(), userId, data.messageId, data.attachedData), 'Message not found')
}

export function updateMessageAttachedData(
  event: RequestEvent,
  data: { messageId: string; attachedData: MessageAttachedData },
) {
  return Effect.runPromise(updateMessageAttachedDataEffect(event, data))
}
