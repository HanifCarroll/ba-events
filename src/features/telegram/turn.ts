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

export const TELEGRAM_CONSENT_VERSION = 'telegram-v1'

const PRIVACY_URL = 'https://baeventos.com/privacy'

const COPY = {
  en: {
    disclosure: `BA Eventos can use your Telegram identifier and messages to search events with AI. Supabase and Trigger.dev process and retain this pilot data for up to 30 days. No account linking or event saving. Privacy: ${PRIVACY_URL}`,
    consent: 'Do you agree? After accepting, resend your question.',
    accept: 'Accept',
    decline: 'Decline',
    accepted: 'Consent saved. Send me an event question.',
    declined: 'Declined. Your Telegram conversation data was deleted.',
    start: 'Hi! I can help you find events in Buenos Aires. Send me what you are looking for.',
    help: 'Ask me for events, dates, neighborhoods, venues, or directions. Commands: /new, /privacy, /delete. Saving and account linking are not available in Telegram.',
    fresh: 'Started a new conversation. Your privacy consent is unchanged.',
    privacy: `Telegram privacy details: ${PRIVACY_URL}\nUse /delete at any time to delete your conversation data.`,
    deleted: 'Your Telegram conversation data was deleted.',
    rateLimited: 'Too many requests right now. Please try again later. /help, /privacy, and /delete remain available.',
    unsupported: 'I did not recognize that command. Try /help.',
  },
  es: {
    disclosure: `BA Eventos puede usar tu identificador y mensajes de Telegram para buscar eventos con IA. Supabase y Trigger.dev procesan y conservan estos datos del piloto hasta 30 días. No vinculamos cuentas ni permitimos guardar eventos. Privacidad: ${PRIVACY_URL}`,
    consent: '¿Aceptás? Después de aceptar, volvé a enviar tu pregunta.',
    accept: 'Aceptar',
    decline: 'Rechazar',
    accepted: 'Consentimiento guardado. Mandame una pregunta sobre eventos.',
    declined: 'Rechazado. Eliminamos los datos de tu conversación de Telegram.',
    start: '¡Hola! Puedo ayudarte a encontrar eventos en Buenos Aires. Contame qué buscás.',
    help: 'Preguntame por eventos, fechas, barrios, lugares o cómo llegar. Comandos: /new, /privacy, /delete. Telegram no permite guardar eventos ni vincular cuentas.',
    fresh: 'Empezamos una conversación nueva. Tu consentimiento de privacidad no cambió.',
    privacy: `Detalles de privacidad de Telegram: ${PRIVACY_URL}\nUsá /delete en cualquier momento para borrar los datos de tu conversación.`,
    deleted: 'Eliminamos los datos de tu conversación de Telegram.',
    rateLimited: 'Hay demasiadas solicitudes. Probá más tarde. /help, /privacy y /delete siguen disponibles.',
    unsupported: 'No reconocí ese comando. Probá /help.',
  },
} as const

const consentKeyboard = (locale: 'en' | 'es') => ({
  inline_keyboard: [[
    { text: COPY[locale].accept, callback_data: 'consent:v1:accept' },
    { text: COPY[locale].decline, callback_data: 'consent:v1:decline' },
  ]],
})

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
  now: () => Date
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
  now: () => new Date(),
}

function localeFrom(languageCode?: string, conversation?: ExternalConversation): 'en' | 'es' {
  if (conversation?.metadata.locale === 'en' || conversation?.metadata.locale === 'es') {
    return conversation.metadata.locale
  }
  return languageCode?.toLowerCase().startsWith('es') ? 'es' : 'en'
}

function hasConsent(conversation: ExternalConversation): boolean {
  return conversation.metadata.consentVersion === TELEGRAM_CONSENT_VERSION
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

async function sendConsent(
  chatId: string,
  locale: 'en' | 'es',
  dependencies: TelegramTurnDependencies
) {
  await dependencies.sendMessage(chatId, {
    text: `${COPY[locale].disclosure}\n\n${COPY[locale].consent}`,
    replyMarkup: consentKeyboard(locale),
  })
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
      await dependencies.updateMetadata({
        channel: 'telegram',
        conversationId,
        metadataPatch: {
          consentVersion: TELEGRAM_CONSENT_VERSION,
          consentedAt: dependencies.now().toISOString(),
          locale,
        },
      })
      await answerCallbackBestEffort(input.callbackId, COPY[locale].accepted, dependencies)
      await dependencies.sendMessage(input.chatId, { text: COPY[locale].accepted })
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
        await dependencies.sendMessage(input.chatId, { text: COPY[locale].privacy })
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
      } else if (hasConsent(conversation)) {
        await dependencies.sendMessage(input.chatId, { text: COPY[locale].start })
      } else {
        await sendConsent(input.chatId, locale, dependencies)
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

    if (!hasConsent(conversation)) {
      await sendConsent(input.chatId, locale, dependencies)
      await dependencies.markCompleted(payload.updateId, conversationId)
      return
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
