export interface TelegramInlineKeyboardButton {
  text: string
  url?: string
  callback_data?: string
}

export interface TelegramInlineKeyboardMarkup {
  inline_keyboard: TelegramInlineKeyboardButton[][]
}

const TELEGRAM_DRAFT_ID_MAX = 2_147_483_647

export function telegramDraftIdFromUpdateId(updateId: string): number {
  const value = BigInt(updateId)
  return Number(value % BigInt(TELEGRAM_DRAFT_ID_MAX)) || 1
}

export class TelegramApiError extends Error {
  constructor(
    message: string,
    readonly errorCode?: number,
    readonly retryAfter?: number,
  ) {
    super(message)
    this.name = 'TelegramApiError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

interface TelegramClientOptions {
  token: string
  fetch?: typeof fetch
  timeoutMs?: number
}

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
    let response: Response
    try {
      response = await fetchImpl(endpoint(method), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      throw new TelegramApiError(`Telegram request failed: ${redact(error)}`)
    }

    let raw: unknown
    try {
      raw = await response.json()
    } catch {
      throw new TelegramApiError(`Telegram returned an invalid response (${response.status})`)
    }
    if (!isRecord(raw) || typeof raw.ok !== 'boolean') {
      throw new TelegramApiError(`Telegram returned an invalid response (${response.status})`)
    }
    if (raw.ok && Object.hasOwn(raw, 'result')) return raw.result as T

    if (!raw.ok) {
      const parameters = isRecord(raw.parameters) ? raw.parameters : null
      throw new TelegramApiError(
        redact(typeof raw.description === 'string' ? raw.description : `Telegram request failed (${response.status})`),
        typeof raw.error_code === 'number' ? raw.error_code : undefined,
        typeof parameters?.retry_after === 'number' ? parameters.retry_after : undefined,
      )
    }
    throw new TelegramApiError(`Telegram returned an invalid response (${response.status})`)
  }

  return {
    sendMessage(chatId: string, text: string, replyMarkup?: TelegramInlineKeyboardMarkup) {
      return call<unknown>('sendMessage', {
        chat_id: chatId,
        text,
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      })
    },
    sendMessageDraft(chatId: string, draftId: number, text = '') {
      if (!Number.isSafeInteger(draftId) || draftId <= 0 || draftId > 2_147_483_647) {
        throw new Error('Telegram draft id must be a positive safe 31-bit integer')
      }
      if (text.length > 4096) throw new Error('Telegram draft text is too long')
      return call<unknown>('sendMessageDraft', { chat_id: chatId, draft_id: draftId, text })
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
