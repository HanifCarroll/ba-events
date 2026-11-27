import { Data, Effect } from 'effect'
import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types'
import type {
  Conversation,
  Json,
  Message,
  MessageExecutionStep,
} from '#shared/lib/types.ts'
import { CHAT_CONTRACT_VERSION } from '#shared/lib/types.ts'
import { sortMessagesByTurnOrderAsc } from '#features/chat/lib/message-order.ts'
import { requireD1 } from '#shared/lib/db/d1-binding.server.ts'
import * as d1 from './chat-d1.server.ts'
import type { ExternalChannel } from './channels.ts'

export type ExternalConversation = Pick<
  Conversation,
  'id' | 'channel' | 'title' | 'created_at' | 'updated_at' | 'metadata'
>

class ExternalConversationError extends Data.TaggedError('ExternalConversationError')<{
  readonly message: string
}> {}

const externalFailure = (message: string) => new ExternalConversationError({ message })

function d1Effect<A>(work: () => Promise<A>, message: string) {
  return Effect.tryPromise({ try: work, catch: () => externalFailure(message) })
}

function external(conversation: Conversation): ExternalConversation {
  const { id, channel, title, created_at, updated_at, metadata } = conversation
  return { id, channel, title, created_at, updated_at, metadata }
}

function requireIdentityHash(hash: string): string {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid external identity hash')
  return hash
}

/** Effect-native external conversation creation/idempotency program. */
export function getOrCreateExternalConversationEffect(
  input: {
    channel: ExternalChannel
    externalIdentityHash: string
    title?: string
    metadata?: Record<string, Json>
  },
): Effect.Effect<ExternalConversation, ExternalConversationError> {
  return Effect.gen(function* () {
    const hash = yield* Effect.try({
      try: () => requireIdentityHash(input.externalIdentityHash),
      catch: () => externalFailure('Invalid external identity hash'),
    })
    return external(yield* d1Effect(() => d1.getOrCreateExternalConversation(requireD1(), input.channel, hash,
      input.title ?? 'New conversation', input.metadata ?? {}), 'Failed to create external conversation'))
  })
}

export function getOrCreateExternalConversation(
  input: {
    channel: ExternalChannel
    externalIdentityHash: string
    title?: string
    metadata?: Record<string, Json>
  },
) {
  return Effect.runPromise(getOrCreateExternalConversationEffect(input))
}

/** Effect-native external conversation lookup program. */
export function getExternalConversationEffect(
  input: { channel: ExternalChannel; conversationId: string },
): Effect.Effect<ExternalConversation, ExternalConversationError> {
  return Effect.flatMap(d1Effect(() => d1.getExternalConversation(requireD1(), input.channel, input.conversationId), 'External conversation not found'),
    (conversation) => conversation ? Effect.succeed(external(conversation)) : Effect.fail(externalFailure('External conversation not found')))
}

export function getExternalConversation(
  input: { channel: ExternalChannel; conversationId: string },
) {
  return Effect.runPromise(getExternalConversationEffect(input))
}

/** Effect-native external conversation message read program. */
export function loadExternalConversationMessagesEffect(
  input: { channel: ExternalChannel; conversationId: string },
): Effect.Effect<Message[], ExternalConversationError> {
  return d1Effect(async () => sortMessagesByTurnOrderAsc(await d1.loadExternalMessages(requireD1(), input.channel, input.conversationId)),
    'Failed to load external conversation messages')
}

export function loadExternalConversationMessages(
  input: { channel: ExternalChannel; conversationId: string },
) {
  return Effect.runPromise(loadExternalConversationMessagesEffect(input))
}

/** Effect-native external message insertion program. */
export function insertExternalConversationMessageEffect(
  input: {
    channel: ExternalChannel
    conversationId: string
    parentMessageId?: string | null
    clientMessageId: string
    role: 'user' | 'assistant'
    content: string
    visibleContent?: string
    executionTrace?: MessageExecutionStep[]
    attachedData?: Message['attached_data']
    responseContractVersion?: number
  },
): Effect.Effect<Message, ExternalConversationError> {
  return d1Effect(() => d1.insertMessage(requireD1(), { channel: input.channel }, {
    conversationId: input.conversationId, role: input.role, content: input.content,
    visibleContent: input.visibleContent ?? input.content, executionTrace: input.executionTrace ?? [],
    responseContractVersion: input.responseContractVersion ?? CHAT_CONTRACT_VERSION, attachedData: input.attachedData ?? {},
    clientMessageId: input.clientMessageId, parentId: input.parentMessageId ?? null,
  }), 'Failed to insert external conversation message')
}

export function insertExternalConversationMessage(
  input: {
    channel: ExternalChannel
    conversationId: string
    parentMessageId?: string | null
    clientMessageId: string
    role: 'user' | 'assistant'
    content: string
    visibleContent?: string
    executionTrace?: MessageExecutionStep[]
    attachedData?: Message['attached_data']
    responseContractVersion?: number
  },
) {
  return Effect.runPromise(insertExternalConversationMessageEffect(input))
}

/** Effect-native external metadata update program. */
export function updateExternalConversationMetadataEffect(
  input: {
    channel: ExternalChannel
    conversationId: string
    metadataPatch: Record<string, Json>
  },
): Effect.Effect<ExternalConversation, ExternalConversationError> {
  return Effect.gen(function* () {
    const current = yield* d1Effect(() => d1.getExternalConversation(requireD1(), input.channel, input.conversationId),
      'Failed to update external conversation metadata')
    if (!current) return yield* externalFailure('Failed to update external conversation metadata')

    const patchEntries = Object.entries(input.metadataPatch)
    if (
      patchEntries.length > 20 ||
      patchEntries.some(
        ([key]) =>
          !/^[a-z][a-zA-Z0-9_]{0,63}$/.test(key) ||
          ['__proto__', 'constructor', 'prototype'].includes(key)
      )
    ) {
      return yield* externalFailure('Invalid external conversation metadata patch')
    }
    const metadata = {
      ...((current.metadata ?? {}) as Record<string, Json>),
      ...Object.fromEntries(patchEntries),
    }

    return external(yield* d1Effect(() => d1.setExternalMetadata(requireD1(), input.channel, input.conversationId, metadata),
      'Failed to update external conversation metadata'))
  })
}

export function updateExternalConversationMetadata(
  input: {
    channel: ExternalChannel
    conversationId: string
    metadataPatch: Record<string, Json>
  },
) {
  return Effect.runPromise(updateExternalConversationMetadataEffect(input))
}

/** Effect-native external message clearing program. */
export function clearExternalConversationMessagesEffect(
  input: { channel: ExternalChannel; conversationId: string },
): Effect.Effect<void, ExternalConversationError> {
  return Effect.flatMap(d1Effect(() => d1.getExternalConversation(requireD1(), input.channel, input.conversationId), 'External conversation not found'),
    (conversation) => conversation
      ? d1Effect(() => d1.clearExternalMessages(requireD1(), input.channel, input.conversationId), 'Failed to clear external conversation messages')
      : Effect.fail(externalFailure('External conversation not found')))
}

export function clearExternalConversationMessages(
  input: { channel: ExternalChannel; conversationId: string },
) {
  return Effect.runPromise(clearExternalConversationMessagesEffect(input))
}

/** Effect-native external conversation hard-delete program. */
export function hardDeleteExternalConversationEffect(
  input: { channel: ExternalChannel; conversationId: string },
): Effect.Effect<void, ExternalConversationError> {
  return d1Effect(() => d1.deleteExternalConversation(requireD1(), input.channel, input.conversationId), 'Failed to delete external conversation')
}

export function hardDeleteExternalConversation(
  input: { channel: ExternalChannel; conversationId: string },
) {
  return Effect.runPromise(hardDeleteExternalConversationEffect(input))
}

/** Purges conversations older than cutoff. Optional caller-owned statements run after the purge in the same D1 transaction. */
export async function purgeExternalConversations(
  db: D1Database,
  channel: ExternalChannel,
  cutoff: string,
  after: readonly D1PreparedStatement[] = [],
) {
  const [purge, ...afterResults] = await db.batch([d1.preparePurgeExternalConversations(db, channel, cutoff), ...after])
  // D1's meta.changes includes cascades; RETURNING counts only deleted conversations.
  return { conversations: purge.results.length, afterResults }
}
