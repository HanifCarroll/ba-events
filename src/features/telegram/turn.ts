import { Data, Effect } from 'effect'
import type { CanonicalChatResponse, Message } from '#shared/lib/types.ts'
import { logger } from '#shared/lib/logger.ts'
import { adaptStoredMessageToCanonical } from '#features/chat/lib/canonical.ts'
import { hintsFromMessages } from '#features/chat/api/agent/follow-up.ts'
import { lastSearchContextFromMessages } from '#features/chat/api/agent/search-context.ts'
import {
  normalizeChatTurn,
  runSharedChatTurn,
  runSharedChatTurnEffect,
} from '#features/chat/api/agent/shared-turn.server.ts'
import { buildAgentHistoryFromStoredMessages } from '#features/chat/api/agent/history.ts'
import {
  clearExternalConversationMessages,
  clearExternalConversationMessagesEffect,
  getExternalConversation,
  getExternalConversationEffect,
  hardDeleteExternalConversation,
  hardDeleteExternalConversationEffect,
  insertExternalConversationMessage,
  insertExternalConversationMessageEffect,
  loadExternalConversationMessages,
  loadExternalConversationMessagesEffect,
  updateExternalConversationMetadata,
  updateExternalConversationMetadataEffect,
  type ExternalConversation,
} from '#features/chat/api/external-conversations.server.ts'
import {
  getTelegramUpdateEnvelopeKey,
  getTelegramUpdateEnvelopeKeyEffect,
  markTelegramUpdateCompleted,
  markTelegramUpdateCompletedEffect,
  markTelegramUpdateFailed,
  markTelegramUpdateFailedEffect,
  redactTelegramIdentityClaims,
  redactTelegramIdentityClaimsEffect,
} from './delivery.server.ts'
import { openTelegramEnvelope } from './envelope.server.ts'
import { telegramDraftIdFromUpdateId, type TelegramReplyMarkup } from './client.ts'
import { COPY, PRIVACY_URL, localeFrom, privacyKeyboard } from './commands.ts'
import { renderTelegramMessage, type TelegramRenderedMessage } from './render.ts'
import {
  parseTelegramPlaintextPayload,
  parseTelegramTaskPayload,
  type TelegramTaskPayload,
} from './task-payload.ts'
import { parseConsentCallback, parsePromptCallback, parseTelegramText } from './update.ts'

interface TelegramOutgoingMessage {
  text: string
  replyMarkup?: TelegramReplyMarkup
}

export interface TelegramTurnDependencies {
  getEnvelopeKey: typeof getTelegramUpdateEnvelopeKey
  getEnvelopeKeyEffect?: typeof getTelegramUpdateEnvelopeKeyEffect
  getConversation: typeof getExternalConversation
  getConversationEffect?: typeof getExternalConversationEffect
  loadMessages: typeof loadExternalConversationMessages
  loadMessagesEffect?: typeof loadExternalConversationMessagesEffect
  insertMessage: typeof insertExternalConversationMessage
  insertMessageEffect?: typeof insertExternalConversationMessageEffect
  updateMetadata: typeof updateExternalConversationMetadata
  updateMetadataEffect?: typeof updateExternalConversationMetadataEffect
  clearMessages: typeof clearExternalConversationMessages
  clearMessagesEffect?: typeof clearExternalConversationMessagesEffect
  deleteConversation: typeof hardDeleteExternalConversation
  deleteConversationEffect?: typeof hardDeleteExternalConversationEffect
  redactClaims: typeof redactTelegramIdentityClaims
  redactClaimsEffect?: typeof redactTelegramIdentityClaimsEffect
  /** Promise callback retained for the channel-neutral compatibility seam. */
  runTurn: typeof runSharedChatTurn
  runTurnEffect?: typeof runSharedChatTurnEffect
  render: typeof renderTelegramMessage
  sendMessage: (chatId: string, message: TelegramOutgoingMessage) => Promise<unknown>
  sendTyping: (chatId: string) => Promise<unknown>
  sendDraft: (chatId: string, draftId: number, text: string) => Promise<unknown>
  answerCallback: (callbackId: string, text?: string) => Promise<unknown>
  markCompleted: typeof markTelegramUpdateCompleted
  markCompletedEffect?: typeof markTelegramUpdateCompletedEffect
  markFailed: typeof markTelegramUpdateFailed
  markFailedEffect?: typeof markTelegramUpdateFailedEffect
}

export const defaultTelegramTurnDependencies: Omit<
  TelegramTurnDependencies,
  'sendMessage' | 'sendTyping' | 'sendDraft' | 'answerCallback'
> = {
  getEnvelopeKey: getTelegramUpdateEnvelopeKey,
  getEnvelopeKeyEffect: getTelegramUpdateEnvelopeKeyEffect,
  getConversation: getExternalConversation,
  getConversationEffect: getExternalConversationEffect,
  loadMessages: loadExternalConversationMessages,
  loadMessagesEffect: loadExternalConversationMessagesEffect,
  insertMessage: insertExternalConversationMessage,
  insertMessageEffect: insertExternalConversationMessageEffect,
  updateMetadata: updateExternalConversationMetadata,
  updateMetadataEffect: updateExternalConversationMetadataEffect,
  clearMessages: clearExternalConversationMessages,
  clearMessagesEffect: clearExternalConversationMessagesEffect,
  deleteConversation: hardDeleteExternalConversation,
  deleteConversationEffect: hardDeleteExternalConversationEffect,
  redactClaims: redactTelegramIdentityClaims,
  redactClaimsEffect: redactTelegramIdentityClaimsEffect,
  runTurn: runSharedChatTurn,
  runTurnEffect: runSharedChatTurnEffect,
  render: renderTelegramMessage,
  markCompleted: markTelegramUpdateCompleted,
  markCompletedEffect: markTelegramUpdateCompletedEffect,
  markFailed: markTelegramUpdateFailed,
  markFailedEffect: markTelegramUpdateFailedEffect,
}

class TelegramTurnError extends Data.TaggedError('TelegramTurnError')<{
  readonly message: string
  readonly cause?: unknown
}> {}

const turnFailure = (message: string, cause?: unknown) => new TelegramTurnError({ message, cause })

function dependencyEffect<A>(run: () => Promise<A>, fallbackMessage: string) {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => turnFailure(
      cause instanceof Error && cause.message ? cause.message : fallbackMessage,
      cause,
    ),
  })
}

function optionalEffect<A>(
  effectRun: (() => Effect.Effect<A, unknown>) | undefined,
  promiseRun: () => Promise<A>,
  fallbackMessage: string,
): Effect.Effect<A, TelegramTurnError> {
  if (effectRun) {
    return Effect.mapError(effectRun(), (cause) => turnFailure(
      cause instanceof Error && cause.message ? cause.message : fallbackMessage,
      cause,
    ))
  }
  return dependencyEffect(promiseRun, fallbackMessage)
}

function settle<A>(effect: Effect.Effect<A, TelegramTurnError>) {
  return Effect.match(effect, {
    onFailure: (error) => ({ ok: false as const, error }),
    onSuccess: (value) => ({ ok: true as const, value }),
  })
}

function persistedCanonical(messages: Message[], clientMessageId: string): CanonicalChatResponse | null {
  const message = messages.find(
    (candidate) => candidate.role === 'assistant' && candidate.client_message_id === clientMessageId
  )
  return message ? adaptStoredMessageToCanonical(message) : null
}

async function answerCallbackBestEffort(
  callbackId: string,
  text: string | undefined,
  dependencies: TelegramTurnDependencies
) {
  try {
    await dependencies.answerCallback(callbackId, text)
  } catch {
    // Telegram expires callback queries quickly; the durable action must still finish.
  }
}

async function sendMessageBestEffort(
  chatId: string,
  message: TelegramRenderedMessage,
  dependencies: TelegramTurnDependencies
) {
  try {
    await dependencies.sendMessage(chatId, message)
  } catch {
    // Erasure is complete; delivery failure must not restore identity material.
  }
}

async function sendDraftBestEffort(
  chatId: string,
  draftId: number,
  text: string,
  dependencies: TelegramTurnDependencies,
  phase: 'initial-draft' | 'found-draft',
  updateId: string,
  canSend: () => boolean = () => true
) {
  if (!canSend()) return
  const startedAt = performance.now()
  try {
    await dependencies.sendDraft(chatId, draftId, text)
    logTiming(phase, startedAt, 'success', updateId)
  } catch {
    logTiming(phase, startedAt, 'error', updateId)
    // Drafts are only a native progress hint; final delivery remains authoritative.
  }
}

function logTiming(
  phase: string,
  startedAt: number,
  status: 'success' | 'error',
  updateId?: string,
) {
  logger.info('[telegram] stage timing', {
    channel: 'telegram',
    ...(updateId ? { updateId, requestId: `telegram:${updateId}` } : {}),
    phase,
    durationMs: Math.round(performance.now() - startedAt),
    status,
  })
}

function startTypingBestEffort(
  chatId: string,
  dependencies: TelegramTurnDependencies,
  updateId: string,
): { stop: () => void } {
  let active = true
  let sending = false
  const send = async (initial = false): Promise<void> => {
    if (!active || sending) return
    sending = true
    const startedAt = initial ? performance.now() : 0
    try {
      await dependencies.sendTyping(chatId)
      if (initial) logTiming('initial-typing', startedAt, 'success', updateId)
    } catch {
      if (initial) logTiming('initial-typing', startedAt, 'error', updateId)
    } finally {
      sending = false
    }
  }
  const refresh = setInterval(() => void send(), 4_000)
  void send(true)
  return {
    stop: () => {
      active = false
      clearInterval(refresh)
    },
  }
}

/** Effect-native Telegram turn graph. Bot API callbacks remain Promise leaves. */
export function processTelegramTurnEffect(
  rawPayload: TelegramTaskPayload,
  dependencies: TelegramTurnDependencies,
): Effect.Effect<void, TelegramTurnError> {
  const payload = parseTelegramTaskPayload(rawPayload)
  if (!payload) return Effect.fail(turnFailure('Invalid Telegram payload'))
  const conversationId = payload.queueKey
  const getConversation = (input: Parameters<typeof getExternalConversation>[0]) => optionalEffect(
    dependencies.getConversationEffect
      ? () => dependencies.getConversationEffect!(input)
      : undefined,
    () => dependencies.getConversation(input),
    'Failed to get external conversation',
  )
  const insertMessage = (input: Parameters<typeof insertExternalConversationMessage>[0]) => optionalEffect(
    dependencies.insertMessageEffect
      ? () => dependencies.insertMessageEffect!(input)
      : undefined,
    () => dependencies.insertMessage(input),
    'Failed to insert external conversation message',
  )
  const updateMetadata = (input: Parameters<typeof updateExternalConversationMetadata>[0]) => optionalEffect(
    dependencies.updateMetadataEffect
      ? () => dependencies.updateMetadataEffect!(input)
      : undefined,
    () => dependencies.updateMetadata(input),
    'Failed to update external conversation metadata',
  )
  const loadMessages = (input: Parameters<typeof loadExternalConversationMessages>[0]) => optionalEffect(
    dependencies.loadMessagesEffect
      ? () => dependencies.loadMessagesEffect!(input)
      : undefined,
    () => dependencies.loadMessages(input),
    'Failed to load external conversation messages',
  )
  const clearMessages = (input: Parameters<typeof clearExternalConversationMessages>[0]) => optionalEffect(
    dependencies.clearMessagesEffect
      ? () => dependencies.clearMessagesEffect!(input)
      : undefined,
    () => dependencies.clearMessages(input),
    'Failed to clear external conversation messages',
  )
  const deleteConversation = (input: Parameters<typeof hardDeleteExternalConversation>[0]) => optionalEffect(
    dependencies.deleteConversationEffect
      ? () => dependencies.deleteConversationEffect!(input)
      : undefined,
    () => dependencies.deleteConversation(input),
    'Failed to delete external conversation',
  )
  const redactClaims = (input: string) => optionalEffect(
    dependencies.redactClaimsEffect
      ? () => dependencies.redactClaimsEffect!(input)
      : undefined,
    () => dependencies.redactClaims(input),
    'Failed to redact Telegram identity claims',
  )
  const markCompleted = (updateId: string, conversationId: string | null) => optionalEffect(
    dependencies.markCompletedEffect
      ? () => dependencies.markCompletedEffect!(updateId, conversationId)
      : undefined,
    () => dependencies.markCompleted(updateId, conversationId),
    'Failed to complete Telegram update claim',
  )
  const markFailed = (updateId: string, errorCode: string) => optionalEffect(
    dependencies.markFailedEffect
      ? () => dependencies.markFailedEffect!(updateId, errorCode)
      : undefined,
    () => dependencies.markFailed(updateId, errorCode),
    'Failed to mark Telegram update failed',
  )

  const program = Effect.gen(function* () {
    const envelopeStarted = performance.now()
    const keyResult = yield* settle(optionalEffect(
      dependencies.getEnvelopeKeyEffect
        ? () => dependencies.getEnvelopeKeyEffect!(payload.updateId)
        : undefined,
      () => dependencies.getEnvelopeKey(payload.updateId),
      'Failed to load Telegram envelope key',
    ))
    if (!keyResult.ok) {
      logTiming('envelope-key', envelopeStarted, 'error', payload.updateId)
      return yield* Effect.fail(keyResult.error)
    }
    logTiming('envelope-key', envelopeStarted, 'success', payload.updateId)
    if (keyResult.value == null) return

    const opened = yield* Effect.tryPromise({
      try: () => Promise.resolve().then(() => openTelegramEnvelope(
        payload.sealedEnvelope,
        keyResult.value!,
        payload.updateId,
        payload.queueKey,
      )),
      catch: (cause) => turnFailure('Invalid Telegram payload', cause),
    })
    const input = parseTelegramPlaintextPayload(opened)
    if (!input) return yield* Effect.fail(turnFailure('Invalid Telegram payload'))
    let locale = localeFrom(input.languageCode)

    let conversation: ExternalConversation | undefined
    let promptText: string | undefined
    if (input.callbackId && input.callbackData) {
      const action = parseConsentCallback(input.callbackData)
      const prompt = parsePromptCallback(input.callbackData)
      if (action === 'decline') {
        yield* deleteConversation({ channel: 'telegram', conversationId })
        yield* redactClaims(input.identityHash)
        yield* Effect.tryPromise({
          try: () => answerCallbackBestEffort(input.callbackId!, COPY[locale].declined, dependencies),
          catch: (cause) => turnFailure('Failed to answer Telegram callback', cause),
        })
        yield* Effect.tryPromise({
          try: () => sendMessageBestEffort(input.chatId, { text: COPY[locale].declined }, dependencies),
          catch: (cause) => turnFailure('Failed to send Telegram message', cause),
        })
        return
      }

      if (action === 'accept') {
        conversation = yield* getConversation({ channel: 'telegram', conversationId })
        locale = localeFrom(input.languageCode, conversation.metadata.locale)
        yield* Effect.tryPromise({
          try: () => answerCallbackBestEffort(input.callbackId!, COPY[locale].legacyAccepted, dependencies),
          catch: (cause) => turnFailure('Failed to answer Telegram callback', cause),
        })
        yield* dependencyEffect(
          () => dependencies.sendMessage(input.chatId, { text: COPY[locale].legacyAccepted }),
          'Failed to send Telegram message',
        )
        yield* markCompleted(payload.updateId, conversationId)
        return
      }

      if (!prompt) return yield* Effect.fail(turnFailure('Unknown Telegram prompt callback'))
      yield* Effect.tryPromise({
        try: () => answerCallbackBestEffort(
          input.callbackId!,
          input.rateLimited ? COPY[locale].rateLimited : undefined,
          dependencies,
        ),
        catch: (cause) => turnFailure('Failed to answer Telegram callback', cause),
      })
      conversation = yield* getConversation({ channel: 'telegram', conversationId })
      locale = localeFrom(input.languageCode, conversation.metadata.locale)
      if (input.rateLimited) {
        yield* dependencyEffect(
          () => dependencies.sendMessage(input.chatId, { text: COPY[locale].rateLimited }),
          'Failed to send Telegram message',
        )
        yield* markCompleted(payload.updateId, conversationId)
        return
      }
      promptText = COPY[locale].promptQueries[prompt]
    }

    if (input.rateLimited) {
      yield* dependencyEffect(
        () => dependencies.sendMessage(input.chatId, { text: COPY[locale].rateLimited }),
        'Failed to send Telegram message',
      )
      yield* markCompleted(payload.updateId, conversationId)
      return
    }

    const parsed = parseTelegramText(promptText ?? input.text ?? '')
    if (!parsed) {
      yield* dependencyEffect(
        () => dependencies.sendMessage(input.chatId, { text: COPY[locale].unsupported }),
        'Failed to send Telegram message',
      )
      yield* markCompleted(payload.updateId, conversationId)
      return
    }

    if (parsed.kind === 'command' && parsed.command === 'delete') {
      yield* deleteConversation({ channel: 'telegram', conversationId })
      yield* redactClaims(input.identityHash)
      yield* Effect.tryPromise({
        try: () => sendMessageBestEffort(input.chatId, { text: COPY[locale].deleted }, dependencies),
        catch: (cause) => turnFailure('Failed to send Telegram message', cause),
      })
      return
    }

    conversation ??= yield* getConversation({ channel: 'telegram', conversationId })
    locale = localeFrom(input.languageCode, conversation.metadata.locale)

    if (parsed.kind === 'command') {
      if (parsed.command === 'privacy') {
        yield* dependencyEffect(
          () => dependencies.sendMessage(input.chatId, {
            text: COPY[locale].privacy,
            replyMarkup: privacyKeyboard(locale),
          }),
          'Failed to send Telegram message',
        )
      } else if (parsed.command === 'help') {
        yield* dependencyEffect(
          () => dependencies.sendMessage(input.chatId, { text: COPY[locale].help }),
          'Failed to send Telegram message',
        )
      } else if (parsed.command === 'new') {
        yield* clearMessages({ channel: 'telegram', conversationId })
        yield* updateMetadata({
            channel: 'telegram',
            conversationId,
            metadataPatch: { locale },
          })
        yield* dependencyEffect(
          () => dependencies.sendMessage(input.chatId, { text: COPY[locale].fresh }),
          'Failed to send Telegram message',
        )
      } else {
        yield* dependencyEffect(
          () => dependencies.sendMessage(input.chatId, {
            text: `${COPY[locale].start}\n\n${PRIVACY_URL}`,
            replyMarkup: { remove_keyboard: true },
          }),
          'Failed to send Telegram message',
        )
      }
      yield* markCompleted(payload.updateId, conversationId)
      return
    }

    const normalizedTurn = normalizeChatTurn(parsed.text, locale)
    locale = normalizedTurn.locale
    const setupStarted = performance.now()
    const metadataEffect = conversation.metadata.locale !== locale
      ? updateMetadata({
            channel: 'telegram',
            conversationId,
            metadataPatch: { locale },
          })
      : Effect.succeed(conversation)
    const messagesEffect = loadMessages({ channel: 'telegram', conversationId })
    const [metadataResult, messagesResult] = yield* Effect.all([
      settle(metadataEffect),
      settle(messagesEffect),
    ], { concurrency: 'unbounded' })
    if (!metadataResult.ok) {
      logTiming('natural-turn-setup', setupStarted, 'error', payload.updateId)
      return yield* Effect.fail(metadataResult.error)
    }
    if (!messagesResult.ok) {
      logTiming('natural-turn-setup', setupStarted, 'error', payload.updateId)
      return yield* Effect.fail(messagesResult.error)
    }
    logTiming('natural-turn-setup', setupStarted, 'success', payload.updateId)
    const messages = messagesResult.value
    const assistantClientMessageId = `telegram:${payload.updateId}:assistant`
    const existingCanonical = persistedCanonical(messages, assistantClientMessageId)
    if (existingCanonical) {
      const rendered = yield* Effect.tryPromise({
        try: () => Promise.resolve(dependencies.render(existingCanonical, locale)),
        catch: (cause) => turnFailure('Failed to render Telegram message', cause),
      })
      yield* dependencyEffect(
        () => dependencies.sendMessage(input.chatId, rendered),
        'Failed to send Telegram message',
      )
      yield* markCompleted(payload.updateId, conversationId)
      return
    }

    const typing = startTypingBestEffort(input.chatId, dependencies, payload.updateId)
    const naturalProgram = Effect.gen(function* () {
      let draftsClosed = false
      let draftChain = Promise.resolve()
      const progressDraftId = telegramDraftIdFromUpdateId(payload.updateId)
      const queueDraft = (text: string, phase: 'initial-draft' | 'found-draft') => {
        if (draftsClosed) return
        draftChain = draftChain.then(() => sendDraftBestEffort(
          input.chatId,
          progressDraftId,
          text,
          dependencies,
          phase,
          payload.updateId,
          () => !draftsClosed,
        ))
      }
      const userInsertStarted = performance.now()
      const userMessageEffect = insertMessage({
          channel: 'telegram',
          conversationId,
          clientMessageId: `telegram:${payload.updateId}:user`,
          role: 'user',
          content: normalizedTurn.originalQuery,
        }).pipe(Effect.tap((message) => {
        logTiming('user-insert', userInsertStarted, 'success', payload.updateId)
        return Effect.succeed(message)
      }))
      const agentStarted = performance.now()
      const agentInput = {
          requestId: `telegram:${payload.updateId}`,
          userContext: { userId: null, isAuthenticated: false },
          text: normalizedTurn.originalQuery,
          locale,
          priorHints: hintsFromMessages(messages),
          lastSearch: lastSearchContextFromMessages(messages),
          recentMessages: buildAgentHistoryFromStoredMessages(messages, normalizedTurn.originalQuery),
          onSearchStart: () => queueDraft(COPY[locale].draft, 'initial-draft'),
          onTrustedSearchProgress: () => queueDraft(COPY[locale].found, 'found-draft'),
      }
      const agentEffect = optionalEffect(
        dependencies.runTurnEffect
          ? () => dependencies.runTurnEffect!(agentInput)
          : undefined,
        () => dependencies.runTurn(agentInput),
        'Failed to run Telegram chat turn',
      ).pipe(Effect.tap((result) => {
        logTiming('agent', agentStarted, 'success', payload.updateId)
        return Effect.succeed(result)
      }))
      const [userResult, agentResult] = yield* Effect.all([
        settle(userMessageEffect),
        settle(agentEffect),
      ], { concurrency: 'unbounded' })
      if (!userResult.ok) {
        yield* Effect.tryPromise({
          try: () => draftChain,
          catch: (cause) => turnFailure('Failed to finish Telegram progress drafts', cause),
        })
        draftsClosed = true
        return yield* Effect.fail(userResult.error)
      }
      if (!agentResult.ok) {
        yield* Effect.tryPromise({
          try: () => draftChain,
          catch: (cause) => turnFailure('Failed to finish Telegram progress drafts', cause),
        })
        draftsClosed = true
        return yield* Effect.fail(agentResult.error)
      }
      yield* Effect.tryPromise({
        try: () => draftChain,
        catch: (cause) => turnFailure('Failed to finish Telegram progress drafts', cause),
      })
      draftsClosed = true
      const persistSendStarted = performance.now()
      const rendered = yield* Effect.tryPromise({
        try: () => Promise.resolve(dependencies.render(agentResult.value.canonical, locale)),
        catch: (cause) => turnFailure('Failed to render Telegram message', cause),
      })
      yield* insertMessage({
          channel: 'telegram',
          conversationId,
          parentMessageId: userResult.value.id,
          clientMessageId: assistantClientMessageId,
          role: 'assistant',
          content: agentResult.value.canonical.text,
          executionTrace: agentResult.value.executionTrace,
          attachedData: { canonical: agentResult.value.canonical },
        })
      yield* dependencyEffect(
        () => dependencies.sendMessage(input.chatId, rendered),
        'Failed to send Telegram message',
      )
      logTiming('persist-send', persistSendStarted, 'success', payload.updateId)
      yield* markCompleted(payload.updateId, conversationId)
    })
    yield* Effect.ensuring(naturalProgram, Effect.sync(() => typing.stop()))
  })

  return Effect.catchEager(program, (error) => Effect.gen(function* () {
    const errorCode = error.cause instanceof Error ? error.cause.name : error.name
    yield* Effect.match(
      markFailed(payload.updateId, errorCode),
      { onFailure: () => undefined, onSuccess: () => undefined },
    )
    return yield* Effect.fail(error)
  }))
}

/** Promise compatibility adapter for the Durable Object processor/tests. */
export function processTelegramTurn(
  rawPayload: TelegramTaskPayload,
  dependencies: TelegramTurnDependencies,
) {
  return Effect.runPromise(processTelegramTurnEffect(rawPayload, dependencies))
}
