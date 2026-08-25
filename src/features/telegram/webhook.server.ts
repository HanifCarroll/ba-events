import { createHash, timingSafeEqual } from 'node:crypto'
import { checkRateLimit } from '#features/auth/api/rate-limit.server.ts'
import { logger } from '#shared/lib/logger.ts'
import { hashTelegramIdentity } from './identity.server.ts'
import { sealTelegramEnvelope } from './envelope.server.ts'
import {
  attachTelegramUpdateConversation,
  claimTelegramUpdate,
  markTelegramUpdateCompleted,
  markTelegramUpdateFailed,
} from './delivery.server.ts'
import {
  clearExternalConversationMessages,
  getOrCreateExternalConversation,
  updateExternalConversationMetadata,
} from '#features/chat/api/external-conversations.server.ts'
import { commandReply, localeFrom } from './commands.ts'
import { telegramPlaintextPayloadSchema, type TelegramTaskPayload } from './task-payload.ts'
import { parsePromptCallback, parseTelegramText, parseTelegramUpdate } from './update.ts'

const MAX_BODY_BYTES = 64 * 1024

export interface TelegramWebhookDependencies {
  webhookSecret: string | undefined
  identitySecret: string | undefined
  claim?: typeof claimTelegramUpdate
  getOrCreateConversation?: typeof getOrCreateExternalConversation
  attachConversation?: typeof attachTelegramUpdateConversation
  markFailed?: typeof markTelegramUpdateFailed
  rateLimit?: typeof checkRateLimit
  trigger: (
    payload: TelegramTaskPayload,
    options: { idempotencyKey: string; idempotencyKeyTTL: string; concurrencyKey: string }
  ) => Promise<unknown>
  clearMessages?: typeof clearExternalConversationMessages
  updateMetadata?: typeof updateExternalConversationMetadata
  markCompleted?: typeof markTelegramUpdateCompleted
}

class TelegramBodyTooLargeError extends Error {}

function secretMatches(actual: string | null, expected: string | undefined): boolean {
  if (!actual || !expected) return false
  const actualHash = createHash('sha256').update(actual).digest()
  const expectedHash = createHash('sha256').update(expected).digest()
  return timingSafeEqual(actualHash, expectedHash)
}

function validIdentitySecret(secret: string | undefined): secret is string {
  return typeof secret === 'string' && Buffer.byteLength(secret, 'utf8') >= 32
}

function response(status = 200): Response {
  return new Response(null, { status })
}

function typingResponse(chatId: string): Response {
  return Response.json({ method: 'sendChatAction', chat_id: Number(chatId), action: 'typing' })
}

function commandResponse(chatId: string, command: Parameters<typeof commandReply>[0], locale: 'en' | 'es'): Response {
  const reply = commandReply(command, locale)
  return Response.json({
    method: 'sendMessage',
    chat_id: Number(chatId),
    text: reply.text,
    ...(reply.replyMarkup ? { reply_markup: reply.replyMarkup } : {}),
  })
}

async function readBoundedBody(request: Request): Promise<Uint8Array> {
  const reader = request.body?.getReader()
  if (!reader) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw new TelegramBodyTooLargeError()
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const body = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

export async function handleTelegramWebhook(
  request: Request,
  dependencies: TelegramWebhookDependencies
): Promise<Response> {
  if (
    !dependencies.webhookSecret ||
    !validIdentitySecret(dependencies.identitySecret) ||
    !secretMatches(
      request.headers.get('x-telegram-bot-api-secret-token'),
      dependencies.webhookSecret
    )
  ) {
    return response(
      dependencies.webhookSecret && validIdentitySecret(dependencies.identitySecret) ? 401 : 503
    )
  }

  const contentLength = request.headers.get('content-length')
  if (contentLength != null) {
    const declaredLength = Number(contentLength)
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) return response(413)
  }

  let raw: Uint8Array
  try {
    raw = await readBoundedBody(request)
  } catch (error) {
    return response(error instanceof TelegramBodyTooLargeError ? 413 : 400)
  }

  let input: unknown
  try {
    input = JSON.parse(new TextDecoder().decode(raw))
  } catch {
    return response(400)
  }
  const update = parseTelegramUpdate(input)
  if (!update) return response()

  const source = 'message' in update ? update.message : update.callback_query
  const identityHash = hashTelegramIdentity(source.from.id, dependencies.identitySecret)
  const locale = source.from.language_code?.toLowerCase().startsWith('es') ? 'es' : 'en'
  const parsedText = 'message' in update ? parseTelegramText(update.message.text) : null
  if ('message' in update && !parsedText) return response()

  let claim
  try {
    claim = await (dependencies.claim ?? claimTelegramUpdate)(update.update_id, identityHash)
  } catch {
    return response(503)
  }
  if (claim.completed) return response()

  const dispatchStarted = performance.now()
  let typingChatId: string | null = null
  try {
    const ordinaryText = 'message' in update && parsedText?.kind === 'text'
    const directCommand =
      'message' in update && parsedText?.kind === 'command' && parsedText.command !== 'delete'
        ? parsedText.command
        : null
    const promptCallback = 'callback_query' in update
      ? parsePromptCallback(update.callback_query.data)
      : null
    const shouldCheckRateLimit = Boolean(claim.checkRateLimit && (ordinaryText || promptCallback))
    const conversationPromise = (
      dependencies.getOrCreateConversation ?? getOrCreateExternalConversation
    )({
      channel: 'telegram',
      externalIdentityHash: identityHash,
      metadata: { locale },
    })
    const rateLimitPromise = shouldCheckRateLimit
      ? (dependencies.rateLimit ?? checkRateLimit)(identityHash)
      : Promise.resolve({ success: true })
    const [conversation, rateResult] = await Promise.all([conversationPromise, rateLimitPromise])
    await (dependencies.attachConversation ?? attachTelegramUpdateConversation)(
      update.update_id,
      identityHash,
      conversation.id
    )

    const rateLimited = shouldCheckRateLimit && !rateResult.success
    if ('message' in update && parsedText?.kind === 'text' && !rateLimited) {
      typingChatId = update.message.chat.id
    }
    let plaintext
    if ('message' in update) {
      plaintext = {
        identityHash,
        chatId: update.message.chat.id,
        ...(rateLimited ? { rateLimited: true } : { text: update.message.text }),
        ...(update.message.from.language_code
          ? { languageCode: update.message.from.language_code }
          : {}),
      }
    } else {
      plaintext = {
        identityHash,
        chatId: update.callback_query.message.chat.id,
        callbackId: update.callback_query.id,
        callbackData: update.callback_query.data,
        ...(rateLimited ? { rateLimited: true } : {}),
        ...(update.callback_query.from.language_code
          ? { languageCode: update.callback_query.from.language_code }
          : {}),
      }
    }

    if (directCommand && 'message' in update) {
      const directLocale = localeFrom(update.message.from.language_code, conversation.metadata?.locale)
      if (directCommand === 'new') {
        await (dependencies.clearMessages ?? clearExternalConversationMessages)({
          channel: 'telegram',
          conversationId: conversation.id,
        })
        await (dependencies.updateMetadata ?? updateExternalConversationMetadata)({
          channel: 'telegram',
          conversationId: conversation.id,
          metadataPatch: { locale: directLocale },
        })
      }
      await (dependencies.markCompleted ?? markTelegramUpdateCompleted)(update.update_id, conversation.id)
      logger.info('[telegram] webhook dispatch', {
        channel: 'telegram',
        updateId: update.update_id,
        requestId: `telegram:${update.update_id}`,
        phase: 'dispatch',
        durationMs: Math.round(performance.now() - dispatchStarted),
        outcome: 'success',
      })
      return commandResponse(update.message.chat.id, directCommand, directLocale)
    }

    const validatedPlaintext = telegramPlaintextPayloadSchema.parse(plaintext)
    const payload = {
      updateId: update.update_id,
      queueKey: conversation.id,
      sealedEnvelope: sealTelegramEnvelope(
        validatedPlaintext,
        claim.envelopeKey,
        update.update_id,
        conversation.id
      ),
    }
    await dependencies.trigger(payload, {
      idempotencyKey: `telegram-update:${update.update_id}`,
      idempotencyKeyTTL: '30d',
      concurrencyKey: conversation.id,
    })
    logger.info('[telegram] webhook dispatch', {
      channel: 'telegram',
      updateId: update.update_id,
      requestId: `telegram:${update.update_id}`,
      phase: 'dispatch',
      durationMs: Math.round(performance.now() - dispatchStarted),
      outcome: 'success',
    })
  } catch {
    logger.info('[telegram] webhook dispatch', {
      channel: 'telegram',
      updateId: update.update_id,
      requestId: `telegram:${update.update_id}`,
      phase: 'dispatch',
      durationMs: Math.round(performance.now() - dispatchStarted),
      outcome: 'error',
    })
    try {
      await (dependencies.markFailed ?? markTelegramUpdateFailed)(update.update_id, 'dispatch_failed')
    } catch {
      // Telegram retry remains the only recovery path if status marking also fails.
    }
    return response(503)
  }
  return typingChatId ? typingResponse(typingChatId) : response()
}
