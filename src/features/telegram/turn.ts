import type { CanonicalChatResponse, Message } from '#shared/lib/types.ts'
import { logger } from '#shared/lib/logger.ts'
import { adaptStoredMessageToCanonical } from '#features/chat/lib/canonical.ts'
import { hintsFromMessages } from '#features/chat/api/agent/follow-up.ts'
import { lastSearchContextFromMessages } from '#features/chat/api/agent/search-context.ts'
import {
  normalizeChatTurn,
  runSharedChatTurn,
} from '#features/chat/api/agent/shared-turn.server.ts'
import { buildAgentHistoryFromStoredMessages } from '#features/chat/api/agent/history.ts'
import {
  clearExternalConversationMessages,
  getExternalConversation,
  hardDeleteExternalConversation,
  insertExternalConversationMessage,
  loadExternalConversationMessages,
  updateExternalConversationMetadata,
  type ExternalConversation,
} from '#features/chat/api/external-conversations.server.ts'
import {
  getTelegramUpdateEnvelopeKey,
  markTelegramUpdateCompleted,
  markTelegramUpdateFailed,
  redactTelegramIdentityClaims,
} from './delivery.server.ts'
import { openTelegramEnvelope } from './envelope.server.ts'
import { telegramDraftIdFromUpdateId, type TelegramReplyMarkup } from './client.ts'
import { COPY, PRIVACY_URL, localeFrom, privacyKeyboard } from './commands.ts'
import { renderTelegramMessage, type TelegramRenderedMessage } from './render.ts'
import {
  telegramPlaintextPayloadSchema,
  telegramTaskPayloadSchema,
  type TelegramTaskPayload,
} from './task-payload.ts'
import { parseConsentCallback, parsePromptCallback, parseTelegramText } from './update.ts'

interface TelegramOutgoingMessage {
  text: string
  replyMarkup?: TelegramReplyMarkup
}

export interface TelegramTurnDependencies {
  getEnvelopeKey: typeof getTelegramUpdateEnvelopeKey
  getConversation: typeof getExternalConversation
  loadMessages: typeof loadExternalConversationMessages
  insertMessage: typeof insertExternalConversationMessage
  updateMetadata: typeof updateExternalConversationMetadata
  clearMessages: typeof clearExternalConversationMessages
  deleteConversation: typeof hardDeleteExternalConversation
  redactClaims: typeof redactTelegramIdentityClaims
  runTurn: typeof runSharedChatTurn
  render: typeof renderTelegramMessage
  sendMessage: (chatId: string, message: TelegramOutgoingMessage) => Promise<unknown>
  sendTyping: (chatId: string) => Promise<unknown>
  sendDraft: (chatId: string, draftId: number, text: string) => Promise<unknown>
  answerCallback: (callbackId: string, text?: string) => Promise<unknown>
  markCompleted: typeof markTelegramUpdateCompleted
  markFailed: typeof markTelegramUpdateFailed
}

export const defaultTelegramTurnDependencies: Omit<
  TelegramTurnDependencies,
  'sendMessage' | 'sendTyping' | 'sendDraft' | 'answerCallback'
> = {
  getEnvelopeKey: getTelegramUpdateEnvelopeKey,
  getConversation: getExternalConversation,
  loadMessages: loadExternalConversationMessages,
  insertMessage: insertExternalConversationMessage,
  updateMetadata: updateExternalConversationMetadata,
  clearMessages: clearExternalConversationMessages,
  deleteConversation: hardDeleteExternalConversation,
  redactClaims: redactTelegramIdentityClaims,
  runTurn: runSharedChatTurn,
  render: renderTelegramMessage,
  markCompleted: markTelegramUpdateCompleted,
  markFailed: markTelegramUpdateFailed,
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

export async function processTelegramTurn(
  rawPayload: TelegramTaskPayload,
  dependencies: TelegramTurnDependencies
): Promise<void> {
  const payload = telegramTaskPayloadSchema.parse(rawPayload)
  const conversationId = payload.queueKey

  try {
    const envelopeStarted = performance.now()
    const timing = (phase: string, startedAt: number, status: 'success' | 'error') =>
      logTiming(phase, startedAt, status, payload.updateId)
    let key: string | null
    try {
      key = await dependencies.getEnvelopeKey(payload.updateId)
      timing('envelope-key', envelopeStarted, 'success')
    } catch (error) {
      timing('envelope-key', envelopeStarted, 'error')
      throw error
    }
    if (key == null) return
    const input = telegramPlaintextPayloadSchema.parse(
      openTelegramEnvelope(payload.sealedEnvelope, key, payload.updateId, payload.queueKey)
    )
    let locale = localeFrom(input.languageCode)

    let conversation: ExternalConversation | undefined
    let promptText: string | undefined
    if (input.callbackId && input.callbackData) {
      const action = parseConsentCallback(input.callbackData)
      const prompt = parsePromptCallback(input.callbackData)
      if (action === 'decline') {
        await dependencies.deleteConversation({ channel: 'telegram', conversationId })
        await dependencies.redactClaims(input.identityHash)
        await answerCallbackBestEffort(input.callbackId, COPY[locale].declined, dependencies)
        await sendMessageBestEffort(input.chatId, { text: COPY[locale].declined }, dependencies)
        return
      }

      if (action === 'accept') {
        conversation = await dependencies.getConversation({
          channel: 'telegram',
          conversationId,
        })
        locale = localeFrom(input.languageCode, conversation?.metadata.locale)
        await answerCallbackBestEffort(input.callbackId, COPY[locale].legacyAccepted, dependencies)
        await dependencies.sendMessage(input.chatId, { text: COPY[locale].legacyAccepted })
        await dependencies.markCompleted(payload.updateId, conversationId)
        return
      }

      if (!prompt) throw new Error('Unknown Telegram prompt callback')
      await answerCallbackBestEffort(
        input.callbackId,
        input.rateLimited ? COPY[locale].rateLimited : undefined,
        dependencies
      )
      conversation = await dependencies.getConversation({
        channel: 'telegram',
        conversationId,
      })
      locale = localeFrom(input.languageCode, conversation?.metadata.locale)
      if (input.rateLimited) {
        await dependencies.sendMessage(input.chatId, { text: COPY[locale].rateLimited })
        await dependencies.markCompleted(payload.updateId, conversationId)
        return
      }
      promptText = COPY[locale].promptQueries[prompt]
    }

    if (input.rateLimited) {
      await dependencies.sendMessage(input.chatId, { text: COPY[locale].rateLimited })
      await dependencies.markCompleted(payload.updateId, conversationId)
      return
    }

    const parsed = parseTelegramText(promptText ?? input.text ?? '')
    if (!parsed) {
      await dependencies.sendMessage(input.chatId, { text: COPY[locale].unsupported })
      await dependencies.markCompleted(payload.updateId, conversationId)
      return
    }

    if (parsed.kind === 'command' && parsed.command === 'delete') {
      await dependencies.deleteConversation({ channel: 'telegram', conversationId })
      await dependencies.redactClaims(input.identityHash)
      await sendMessageBestEffort(input.chatId, { text: COPY[locale].deleted }, dependencies)
      return
    }

    conversation ??= await dependencies.getConversation({
      channel: 'telegram',
      conversationId,
    })
    locale = localeFrom(input.languageCode, conversation?.metadata.locale)

    if (parsed.kind === 'command') {
      if (parsed.command === 'privacy') {
        await dependencies.sendMessage(input.chatId, {
          text: COPY[locale].privacy,
          replyMarkup: privacyKeyboard(locale),
        })
      } else if (parsed.command === 'help') {
        await dependencies.sendMessage(input.chatId, { text: COPY[locale].help })
      } else if (parsed.command === 'new') {
        await dependencies.clearMessages({ channel: 'telegram', conversationId })
        await dependencies.updateMetadata({
          channel: 'telegram',
          conversationId,
          metadataPatch: { locale },
        })
        await dependencies.sendMessage(input.chatId, { text: COPY[locale].fresh })
      } else {
        await dependencies.sendMessage(input.chatId, {
          text: `${COPY[locale].start}\n\n${PRIVACY_URL}`,
          replyMarkup: { remove_keyboard: true },
        })
      }
      await dependencies.markCompleted(payload.updateId, conversationId)
      return
    }

    const normalizedTurn = normalizeChatTurn(parsed.text, locale)
    locale = normalizedTurn.locale
    const setupStarted = performance.now()
    const metadataPromise = conversation.metadata.locale !== locale
      ? dependencies.updateMetadata({
          channel: 'telegram',
          conversationId,
          metadataPatch: { locale },
        })
      : Promise.resolve(conversation)
    const messagesPromise = dependencies.loadMessages({ channel: 'telegram', conversationId })
    let messages: Message[]
    try {
      [, messages] = await Promise.all([metadataPromise, messagesPromise])
      timing('natural-turn-setup', setupStarted, 'success')
    } catch (error) {
      timing('natural-turn-setup', setupStarted, 'error')
      throw error
    }
    const assistantClientMessageId = `telegram:${payload.updateId}:assistant`
    const existingCanonical = persistedCanonical(messages, assistantClientMessageId)
    if (existingCanonical) {
      await dependencies.sendMessage(input.chatId, dependencies.render(existingCanonical, locale))
      await dependencies.markCompleted(payload.updateId, conversationId)
      return
    }

    const typing = startTypingBestEffort(input.chatId, dependencies, payload.updateId)
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
    const userMessagePromise = dependencies.insertMessage({
      channel: 'telegram',
      conversationId,
      clientMessageId: `telegram:${payload.updateId}:user`,
      role: 'user',
      content: normalizedTurn.originalQuery,
    }).then((message) => {
      timing('user-insert', userInsertStarted, 'success')
      return message
    }, (error) => {
      timing('user-insert', userInsertStarted, 'error')
      throw error
    })
    queueDraft(COPY[locale].draft, 'initial-draft')
    const agentStarted = performance.now()
    const agentPromise = dependencies.runTurn({
      requestId: `telegram:${payload.updateId}`,
      userContext: { userId: null, isAuthenticated: false },
      text: normalizedTurn.originalQuery,
      locale,
      priorHints: hintsFromMessages(messages),
      lastSearch: lastSearchContextFromMessages(messages),
      recentMessages: buildAgentHistoryFromStoredMessages(messages, normalizedTurn.originalQuery),
      onTrustedSearchProgress: () => queueDraft(COPY[locale].found, 'found-draft'),
    }).then((result) => {
      timing('agent', agentStarted, 'success')
      return result
    }, (error) => {
      timing('agent', agentStarted, 'error')
      throw error
    })
    try {
      const userMessage = await userMessagePromise.catch(async (error) => {
        await Promise.all([agentPromise.catch(() => undefined), draftChain])
        draftsClosed = true
        throw error
      })
      const result = await agentPromise.finally(async () => {
        await draftChain
        draftsClosed = true
      })
      const persistSendStarted = performance.now()
      try {
        await dependencies.insertMessage({
          channel: 'telegram',
          conversationId,
          parentMessageId: userMessage.id,
          clientMessageId: assistantClientMessageId,
          role: 'assistant',
          content: result.canonical.text,
          executionTrace: result.executionTrace,
          attachedData: { canonical: result.canonical },
        })
        await dependencies.sendMessage(input.chatId, dependencies.render(result.canonical, locale))
        timing('persist-send', persistSendStarted, 'success')
      } catch (error) {
        timing('persist-send', persistSendStarted, 'error')
        throw error
      }
      await dependencies.markCompleted(payload.updateId, conversationId)
    } finally {
      typing.stop()
    }
  } catch (error) {
    try {
      await dependencies.markFailed(
        payload.updateId,
        error instanceof Error ? error.name : 'unknown_error'
      )
    } catch {
      // Preserve the original failure for Trigger retry handling.
    }
    throw error
  }
}
