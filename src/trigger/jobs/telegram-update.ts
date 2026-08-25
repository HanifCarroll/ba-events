import { task } from '@trigger.dev/sdk/v3'
import { createTelegramClient, TelegramApiError } from '#features/telegram/client.ts'
import {
  defaultTelegramTurnDependencies,
  processTelegramTurn,
} from '#features/telegram/turn.ts'
import {
  telegramTaskPayloadSchema,
  type TelegramTaskPayload,
} from '#features/telegram/task-payload.ts'
import { markTelegramUpdateFailed } from '#features/telegram/delivery.server.ts'

export async function retryTelegram<T>(
  operation: () => Promise<T>,
  // Hold the per-chat queue slot while Telegram throttles us so replies cannot reorder.
  waitFor: (seconds: number) => Promise<unknown> = (seconds) =>
    new Promise((resolve) => setTimeout(resolve, seconds * 1000))
): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (
      !(error instanceof TelegramApiError) ||
      error.errorCode !== 429 ||
      !error.retryAfter ||
      error.retryAfter <= 0
    ) throw error
    await waitFor(Math.ceil(error.retryAfter))
    return operation()
  }
}

export const telegramUpdateTask = task({
  id: 'telegram-update',
  queue: { concurrencyLimit: 1 },
  retry: { maxAttempts: 3 },
  run: async (payload: TelegramTaskPayload) => {
    const validated = telegramTaskPayloadSchema.parse(payload)
    try {
      const client = createTelegramClient({ token: process.env.TELEGRAM_BOT_TOKEN ?? '' })
      await processTelegramTurn(validated, {
        ...defaultTelegramTurnDependencies,
        sendMessage: (chatId, message) =>
          retryTelegram(() => client.sendMessage(chatId, message.text, message.replyMarkup)),
        sendTyping: (chatId) => retryTelegram(() => client.sendChatAction(chatId)),
        sendDraft: (chatId, draftId, text) => client.sendMessageDraft(chatId, draftId, text),
        answerCallback: (callbackId, text) =>
          retryTelegram(() => client.answerCallbackQuery(callbackId, text)),
      })
    } catch (error) {
      await markTelegramUpdateFailed(
        validated.updateId,
        error instanceof Error ? error.name : 'unknown_error'
      )
      throw error
    }
  },
})
