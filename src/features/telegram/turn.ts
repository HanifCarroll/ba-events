import type { CanonicalChatResponse, Message } from '#shared/lib/types.ts'
import { adaptStoredMessageToCanonical } from '#features/chat/lib/canonical.ts'
import { hintsFromMessages } from '#features/chat/api/agent/follow-up.ts'
import { lastSearchContextFromMessages } from '#features/chat/api/agent/search-context.ts'
import {
  normalizeChatTurn,
  runSharedChatTurn,
} from '#features/chat/api/agent/shared-turn.server.ts'
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
import { renderTelegramMessage, type TelegramRenderedMessage } from './render.ts'
import {
  telegramPlaintextPayloadSchema,
  telegramTaskPayloadSchema,
  type TelegramTaskPayload,
} from './task-payload.ts'
import { parseConsentCallback, parseTelegramText } from './update.ts'

const PRIVACY_URL = 'https://baeventos.com/privacy'

const COPY = {
  en: {
    start: 'Hi! I use AI to help find Buenos Aires events. Chats may be stored for up to 30 days. Use /delete anytime. By continuing, you agree to the privacy policy.',
    starter: 'Try one of these, or type your own:',
    starterPlaceholder: 'Choose a prompt or type your own',
    starterOptions: [
      'Anything chill tonight?',
      "What's on this weekend?",
      'Free events nearby',
      'Live music tonight',
    ],
    help: 'Ask me for events, dates, neighborhoods, venues, or directions. Commands: /new, /privacy, /delete. Saving and account linking are not available in Telegram.',
    fresh: 'Started a new conversation.',
    privacy: 'Telegram privacy details. Chats may be stored for up to 30 days. Use /delete at any time to delete your conversation data.',
    privacyButton: 'Privacy',
    legacyAccepted: 'Thanks. You can send me an event question anytime.',
    declined: 'Declined. Your Telegram conversation data was deleted.',
    deleted: 'Your Telegram conversation data was deleted.',
    rateLimited: 'Too many requests right now. Please try again later. /help, /privacy, and /delete remain available.',
    unsupported: 'I did not recognize that command. Try /help.',
  },
  es: {
    start: '¡Hola! Uso IA para ayudarte a encontrar eventos en Buenos Aires. Los chats pueden guardarse hasta 30 días. Usá /delete cuando quieras. Al continuar, aceptás la política de privacidad.',
    starter: 'Probá una de estas opciones o escribí la tuya:',
    starterPlaceholder: 'Elegí una opción o escribí la tuya',
    starterOptions: [
      '¿Algo tranqui para hoy?',
      '¿Qué hay este finde?',
      'Eventos gratis cerca',
      'Música en vivo hoy',
    ],
    help: 'Preguntame por eventos, fechas, barrios, lugares o cómo llegar. Comandos: /new, /privacy, /delete. Telegram no permite guardar eventos ni vincular cuentas.',
    fresh: 'Empezamos una conversación nueva.',
    privacy: 'Detalles de privacidad de Telegram. Los chats pueden guardarse hasta 30 días. Usá /delete en cualquier momento para borrar los datos de tu conversación.',
    privacyButton: 'Privacidad',
    legacyAccepted: 'Gracias. Podés mandarme una pregunta sobre eventos cuando quieras.',
    declined: 'Rechazado. Eliminamos los datos de tu conversación de Telegram.',
    deleted: 'Eliminamos los datos de tu conversación de Telegram.',
    rateLimited: 'Hay demasiadas solicitudes. Probá más tarde. /help, /privacy y /delete siguen disponibles.',
    unsupported: 'No reconocí ese comando. Probá /help.',
  },
} as const

const privacyKeyboard = (locale: 'en' | 'es') => ({
  inline_keyboard: [[{ text: COPY[locale].privacyButton, url: PRIVACY_URL }]],
})

const starterKeyboard = (locale: 'en' | 'es') => {
  const options = COPY[locale].starterOptions
  return {
    keyboard: [
      options.slice(0, 2).map((text) => ({ text })),
      options.slice(2).map((text) => ({ text })),
    ],
    resize_keyboard: true,
    one_time_keyboard: true,
    input_field_placeholder: COPY[locale].starterPlaceholder,
  }
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
  sendMessage: (chatId: string, message: TelegramRenderedMessage) => Promise<unknown>
  sendTyping: (chatId: string) => Promise<unknown>
  answerCallback: (callbackId: string, text?: string) => Promise<unknown>
  markCompleted: typeof markTelegramUpdateCompleted
  markFailed: typeof markTelegramUpdateFailed
}

export const defaultTelegramTurnDependencies: Omit<
  TelegramTurnDependencies,
  'sendMessage' | 'sendTyping' | 'answerCallback'
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

function localeFrom(languageCode?: string, conversation?: ExternalConversation): 'en' | 'es' {
  if (conversation?.metadata.locale === 'en' || conversation?.metadata.locale === 'es') {
    return conversation.metadata.locale
  }
  return languageCode?.toLowerCase().startsWith('es') ? 'es' : 'en'
}

function persistedCanonical(messages: Message[], clientMessageId: string): CanonicalChatResponse | null {
  const message = messages.find(
    (candidate) => candidate.role === 'assistant' && candidate.client_message_id === clientMessageId
  )
  return message ? adaptStoredMessageToCanonical(message) : null
}

async function answerCallbackBestEffort(
  callbackId: string,
  text: string,
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

export async function processTelegramTurn(
  rawPayload: TelegramTaskPayload,
  dependencies: TelegramTurnDependencies
): Promise<void> {
  const payload = telegramTaskPayloadSchema.parse(rawPayload)
  const conversationId = payload.queueKey

  try {
    const key = await dependencies.getEnvelopeKey(payload.updateId)
    if (key == null) return
    const input = telegramPlaintextPayloadSchema.parse(
      openTelegramEnvelope(payload.sealedEnvelope, key, payload.updateId, payload.queueKey)
    )
    let locale = localeFrom(input.languageCode)

    if (input.callbackId && input.callbackData) {
      const action = parseConsentCallback(input.callbackData)
      if (action === 'decline') {
        await dependencies.deleteConversation({ channel: 'telegram', conversationId })
        await dependencies.redactClaims(input.identityHash)
        await answerCallbackBestEffort(input.callbackId, COPY[locale].declined, dependencies)
        await sendMessageBestEffort(input.chatId, { text: COPY[locale].declined }, dependencies)
        return
      }

      const conversation = await dependencies.getConversation({
        channel: 'telegram',
        conversationId,
      })
      locale = localeFrom(input.languageCode, conversation)
      await answerCallbackBestEffort(input.callbackId, COPY[locale].legacyAccepted, dependencies)
      await dependencies.sendMessage(input.chatId, { text: COPY[locale].legacyAccepted })
      await dependencies.markCompleted(payload.updateId, conversationId)
      return
    }

    if (input.rateLimited) {
      await dependencies.sendMessage(input.chatId, { text: COPY[locale].rateLimited })
      await dependencies.markCompleted(payload.updateId, conversationId)
      return
    }

    const parsed = parseTelegramText(input.text ?? '')
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

    const conversation = await dependencies.getConversation({
      channel: 'telegram',
      conversationId,
    })
    locale = localeFrom(input.languageCode, conversation)

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
          text: COPY[locale].start,
          replyMarkup: privacyKeyboard(locale),
        })
        await dependencies.sendMessage(input.chatId, {
          text: COPY[locale].starter,
          replyMarkup: starterKeyboard(locale),
        })
      }
      await dependencies.markCompleted(payload.updateId, conversationId)
      return
    }

    const normalizedTurn = normalizeChatTurn(parsed.text, locale)
    locale = normalizedTurn.locale
    if (conversation.metadata.locale !== locale) {
      await dependencies.updateMetadata({
        channel: 'telegram',
        conversationId,
        metadataPatch: { locale },
      })
    }

    const messages = await dependencies.loadMessages({ channel: 'telegram', conversationId })
    const assistantClientMessageId = `telegram:${payload.updateId}:assistant`
    const existingCanonical = persistedCanonical(messages, assistantClientMessageId)
    if (existingCanonical) {
      await dependencies.sendMessage(input.chatId, dependencies.render(existingCanonical, locale))
      await dependencies.markCompleted(payload.updateId, conversationId)
      return
    }

    await dependencies.sendTyping(input.chatId)
    const userMessage = await dependencies.insertMessage({
      channel: 'telegram',
      conversationId,
      clientMessageId: `telegram:${payload.updateId}:user`,
      role: 'user',
      content: normalizedTurn.originalQuery,
    })
    const result = await dependencies.runTurn({
      requestId: `telegram:${payload.updateId}`,
      userContext: { userId: null, isAuthenticated: false },
      text: normalizedTurn.originalQuery,
      locale,
      priorHints: hintsFromMessages(messages),
      lastSearch: lastSearchContextFromMessages(messages),
    })
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
    await dependencies.markCompleted(payload.updateId, conversationId)
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
