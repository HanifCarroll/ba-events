import { createHash, timingSafeEqual } from 'node:crypto'
import { Data, Effect } from 'effect'
import { checkRateLimit } from '#features/auth/api/rate-limit.server.ts'
import { logger } from '#shared/lib/logger.ts'
import { hashTelegramIdentity } from './identity.server.ts'
import { sealTelegramEnvelope } from './envelope.server.ts'
import {
  attachTelegramUpdateConversation,
  claimTelegramUpdate,
  markTelegramUpdateFailed,
} from './delivery.server.ts'
import { getOrCreateExternalConversation } from '#features/chat/api/external-conversations.server.ts'

import { parseTelegramPlaintextPayload, type TelegramTaskPayload } from './task-payload.ts'
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
  /** Trigger.dev dispatch is a framework callback and remains Promise-facing. */
  trigger: (
    payload: TelegramTaskPayload,
    options: { idempotencyKey: string; idempotencyKeyTTL: string; concurrencyKey: string }
  ) => Promise<unknown>
}

class TelegramBodyTooLargeError extends Error {}
class TelegramWebhookError extends Data.TaggedError('TelegramWebhookError')<{
  readonly message: string
  readonly cause?: unknown
}> {}

const webhookFailure = (message: string, cause?: unknown) => new TelegramWebhookError({ message, cause })

function promiseEffect<A>(run: () => Promise<A>, fallbackMessage: string) {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => webhookFailure(
      cause instanceof Error && cause.message ? cause.message : fallbackMessage,
      cause,
    ),
  })
}

function settle<A>(effect: Effect.Effect<A, TelegramWebhookError>) {
  return Effect.match(effect, {
    onFailure: (error) => ({ ok: false as const, error }),
    onSuccess: (value) => ({ ok: true as const, value }),
  })
}

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

/** Request-body streaming is a platform leaf; size checks and cancellation stay unchanged. */
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

/** Effect-native webhook dispatch graph. The exported handler runs it at the Worker edge. */
export function handleTelegramWebhookEffect(
  request: Request,
  dependencies: TelegramWebhookDependencies,
): Effect.Effect<Response, TelegramWebhookError> {
  if (
    !dependencies.webhookSecret ||
    !validIdentitySecret(dependencies.identitySecret) ||
    !secretMatches(
      request.headers.get('x-telegram-bot-api-secret-token'),
      dependencies.webhookSecret,
    )
  ) {
    return Effect.succeed(
      response(dependencies.webhookSecret && validIdentitySecret(dependencies.identitySecret) ? 401 : 503),
    )
  }

  const contentLength = request.headers.get('content-length')
  if (contentLength != null) {
    const declaredLength = Number(contentLength)
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) return Effect.succeed(response(413))
  }

  return Effect.gen(function* () {
    const bodyResult = yield* settle(promiseEffect(
      () => readBoundedBody(request),
      'Failed to read Telegram webhook body',
    ))
    if (!bodyResult.ok) {
      return response(bodyResult.error.cause instanceof TelegramBodyTooLargeError ? 413 : 400)
    }

    const inputResult = yield* settle(Effect.tryPromise({
      try: () => Promise.resolve(JSON.parse(new TextDecoder().decode(bodyResult.value)) as unknown),
      catch: (cause) => webhookFailure('Invalid Telegram webhook JSON', cause),
    }))
    if (!inputResult.ok) return response(400)
    const update = parseTelegramUpdate(inputResult.value)
    if (!update) return response()

    const source = 'message' in update ? update.message : update.callback_query
    const identityHash = hashTelegramIdentity(source.from.id, dependencies.identitySecret!)
    const locale = source.from.language_code?.toLowerCase().startsWith('es') ? 'es' : 'en'
    const parsedText = 'message' in update ? parseTelegramText(update.message.text) : null
    if ('message' in update && !parsedText) return response()
    const startSource = parsedText?.kind === 'command' && parsedText.command === 'start'
      ? parsedText.payload === 'website' || parsedText.payload === 'app' ? parsedText.payload : undefined
      : undefined

    const claimResult = yield* settle(promiseEffect(
      () => (dependencies.claim ?? claimTelegramUpdate)(update.update_id, identityHash),
      'Failed to claim Telegram update',
    ))
    if (!claimResult.ok) return response(503)
    const claim = claimResult.value
    if (claim.completed) return response()

    const dispatchStarted = performance.now()
    let typingChatId: string | null = null
    const dispatch = Effect.gen(function* () {
      const ordinaryText = 'message' in update && parsedText?.kind === 'text'
      const promptCallback = 'callback_query' in update
        ? parsePromptCallback(update.callback_query.data)
        : null
      const shouldCheckRateLimit = Boolean(claim.checkRateLimit && (ordinaryText || promptCallback))
      const conversationEffect = promiseEffect(
        () => (dependencies.getOrCreateConversation ?? getOrCreateExternalConversation)({
          channel: 'telegram',
          externalIdentityHash: identityHash,
          metadata: { locale, ...(startSource ? { startSource } : {}) },
        }),
        'Failed to get or create Telegram conversation',
      )
      const rateLimitEffect = shouldCheckRateLimit
        ? promiseEffect(
            () => (dependencies.rateLimit ?? checkRateLimit)(identityHash),
            'Failed to check Telegram rate limit',
          )
        : Effect.succeed({ success: true, remaining: 0, reset: 0 })
      const [conversationResult, rateResult] = yield* Effect.all([
        settle(conversationEffect),
        settle(rateLimitEffect),
      ], { concurrency: 'unbounded' })
      if (!conversationResult.ok) return yield* Effect.fail(conversationResult.error)
      if (!rateResult.ok) return yield* Effect.fail(rateResult.error)
      const conversation = conversationResult.value
      yield* promiseEffect(
        () => (dependencies.attachConversation ?? attachTelegramUpdateConversation)(
          update.update_id,
          identityHash,
          conversation.id,
        ),
        'Failed to attach Telegram conversation claim',
      )

      const rateLimited = shouldCheckRateLimit && !rateResult.value.success
      if ('message' in update && parsedText?.kind === 'text' && !rateLimited) {
        typingChatId = update.message.chat.id
      }
      const plaintext = 'message' in update
        ? {
            identityHash,
            chatId: update.message.chat.id,
            ...(rateLimited ? { rateLimited: true } : { text: update.message.text }),
            ...(update.message.from.language_code
              ? { languageCode: update.message.from.language_code }
              : {}),
          }
        : {
            identityHash,
            chatId: update.callback_query.message.chat.id,
            callbackId: update.callback_query.id,
            callbackData: update.callback_query.data,
            ...(rateLimited ? { rateLimited: true } : {}),
            ...(update.callback_query.from.language_code
              ? { languageCode: update.callback_query.from.language_code }
              : {}),
          }
      const validatedPlaintext = parseTelegramPlaintextPayload(plaintext)
      if (!validatedPlaintext) return yield* Effect.fail(webhookFailure('Invalid Telegram payload'))
      const sealed = yield* Effect.tryPromise({
        try: () => Promise.resolve().then(() => sealTelegramEnvelope(
          validatedPlaintext,
          claim.envelopeKey,
          update.update_id,
          conversation.id,
        )),
        catch: (cause) => webhookFailure('Failed to seal Telegram payload', cause),
      })
      const payload: TelegramTaskPayload = {
        updateId: update.update_id,
        queueKey: conversation.id,
        sealedEnvelope: sealed,
      }
      yield* promiseEffect(
        () => dependencies.trigger(payload, {
          idempotencyKey: `telegram-update:${update.update_id}`,
          idempotencyKeyTTL: '30d',
          concurrencyKey: conversation.id,
        }),
        'Telegram inbox rejected update',
      )
      logger.info('[telegram] webhook dispatch', {
        channel: 'telegram',
        updateId: update.update_id,
        requestId: `telegram:${update.update_id}`,
        phase: 'dispatch',
        durationMs: Math.round(performance.now() - dispatchStarted),
        outcome: 'success',
      })
      return
    })

    const dispatchResult = yield* settle(dispatch)
    if (!dispatchResult.ok) {
      logger.info('[telegram] webhook dispatch', {
        channel: 'telegram',
        updateId: update.update_id,
        requestId: `telegram:${update.update_id}`,
        phase: 'dispatch',
        durationMs: Math.round(performance.now() - dispatchStarted),
        outcome: 'error',
      })
      yield* Effect.match(
        promiseEffect(
          () => (dependencies.markFailed ?? markTelegramUpdateFailed)(update.update_id, 'dispatch_failed'),
          'Failed to mark Telegram update failed',
        ),
        { onFailure: () => undefined, onSuccess: () => undefined },
      )
      return response(503)
    }
    return typingChatId ? typingResponse(typingChatId) : response()
  })
}

/** Promise compatibility adapter at the Worker fetch boundary. */
export function handleTelegramWebhook(request: Request, dependencies: TelegramWebhookDependencies) {
  return Effect.runPromise(handleTelegramWebhookEffect(request, dependencies))
}
