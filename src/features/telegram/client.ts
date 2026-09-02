import { Data, Effect, Schema } from 'effect'

export interface TelegramInlineKeyboardButton {
  text: string
  url?: string
  callback_data?: string
}

export interface TelegramInlineKeyboardMarkup {
  inline_keyboard: TelegramInlineKeyboardButton[][]
}

export interface TelegramReplyKeyboardRemove {
  remove_keyboard: true
}

export type TelegramReplyMarkup = TelegramInlineKeyboardMarkup | TelegramReplyKeyboardRemove

const TELEGRAM_DRAFT_ID_MAX = 2_147_483_647

export function telegramDraftIdFromUpdateId(updateId: string): number {
  const value = BigInt(updateId)
  return Number(value % BigInt(TELEGRAM_DRAFT_ID_MAX)) || 1
}

class TelegramApiErrorBase extends Data.TaggedError('TelegramApiError')<{
  readonly message: string
  readonly errorCode?: number
  readonly retryAfter?: number
}> {}

export class TelegramApiError extends TelegramApiErrorBase {
  constructor(
    message: string,
    readonly errorCode?: number,
    readonly retryAfter?: number,
  ) {
    super({ message, errorCode, retryAfter })
    this.name = 'TelegramApiError'
  }
}

interface TelegramClientOptions {
  token: string
  fetch?: typeof fetch
  timeoutMs?: number
}

const telegramEnvelopeSchema = Schema.Struct({
  ok: Schema.Boolean,
  result: Schema.optional(Schema.Any),
  description: Schema.optional(Schema.String),
  error_code: Schema.optional(Schema.Number),
  parameters: Schema.optional(Schema.Struct({
    retry_after: Schema.optional(Schema.Number),
  })),
})

export function createTelegramClient({
  token,
  fetch: fetchImpl = globalThis.fetch,
  timeoutMs = 10_000,
}: TelegramClientOptions) {
  if (!token) throw new Error('Telegram bot token is required')
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Telegram timeout must be positive')

  const endpoint = (method: string) => `https://api.telegram.org/bot${token}/${method}`
  const redact = (value: unknown) =>
    String(value).replaceAll(token, '[REDACTED]').replaceAll(encodeURIComponent(token), '[REDACTED]')

  async function call<T>(method: string, body?: Record<string, unknown>): Promise<T> {
    const program = Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: () => fetchImpl(endpoint(method), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: body ? JSON.stringify(body) : undefined,
          // Telegram owns the native timeout contract. Keep this signal
          // unchanged so Worker retry/cancellation behavior remains intact.
          signal: AbortSignal.timeout(timeoutMs),
        }),
        catch: (error) => new TelegramApiError(`Telegram request failed: ${redact(error)}`),
      })

      const raw = yield* Effect.tryPromise({
        try: () => response.json() as Promise<unknown>,
        catch: () => new TelegramApiError(`Telegram returned an invalid response (${response.status})`),
      })
      const parsed = Schema.decodeUnknownResult(telegramEnvelopeSchema)(raw)
      if (parsed._tag !== 'Success') {
        return yield* Effect.fail(new TelegramApiError(`Telegram returned an invalid response (${response.status})`))
      }

      const envelope = parsed.success
      if (envelope.ok && Object.hasOwn(envelope, 'result')) return envelope.result as T
      if (!envelope.ok) {
        return yield* Effect.fail(new TelegramApiError(
          redact(envelope.description ?? `Telegram request failed (${response.status})`),
          envelope.error_code,
          envelope.parameters?.retry_after,
        ))
      }
      return yield* Effect.fail(new TelegramApiError(`Telegram returned an invalid response (${response.status})`))
    })
    return Effect.runPromise(program)
  }

  return {
    sendMessage(chatId: string, text: string, replyMarkup?: TelegramReplyMarkup) {
      return call<unknown>('sendMessage', {
        chat_id: chatId,
        text,
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      })
    },
    sendMessageDraft(chatId: string, draftId: number, text: string) {
      const numericChatId = Number(chatId)
      if (!/^-?\d+$/.test(chatId) || !Number.isSafeInteger(numericChatId)) {
        throw new Error('Telegram draft chat id must be a safe integer')
      }
      if (!Number.isSafeInteger(draftId) || draftId <= 0 || draftId > 2_147_483_647) {
        throw new Error('Telegram draft id must be a positive safe 31-bit integer')
      }
      if (text.length > 4096) throw new Error('Telegram draft text is too long')
      return call<unknown>('sendMessageDraft', { chat_id: numericChatId, draft_id: draftId, text })
    },
    sendChatAction(chatId: string, action: 'typing' = 'typing') {
      return call<unknown>('sendChatAction', { chat_id: chatId, action })
    },
    answerCallbackQuery(callbackQueryId: string, text?: string) {
      return call<unknown>('answerCallbackQuery', {
        callback_query_id: callbackQueryId,
        ...(text ? { text: text.slice(0, 200) } : {}),
      })
    },
    setWebhook(url: string, secretToken?: string) {
      try {
        if (new URL(url).protocol !== 'https:') throw new Error()
      } catch {
        throw new Error('Telegram webhook URL must use HTTPS')
      }
      return call<boolean>('setWebhook', {
        url,
        allowed_updates: ['message', 'callback_query'],
        ...(secretToken ? { secret_token: secretToken } : {}),
      })
    },
    getWebhookInfo() {
      return call<unknown>('getWebhookInfo')
    },
    deleteWebhook(dropPendingUpdates = false) {
      return call<boolean>('deleteWebhook', { drop_pending_updates: dropPendingUpdates })
    },
  }
}

export type TelegramClient = ReturnType<typeof createTelegramClient>
