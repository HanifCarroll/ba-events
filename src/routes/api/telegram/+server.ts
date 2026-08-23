import { tasks } from '@trigger.dev/sdk/v3'
import type { RequestHandler } from './$types'
import type { telegramUpdateTask } from '#trigger/jobs/telegram-update.ts'
import { handleTelegramWebhook } from '#features/telegram/webhook.server.ts'

export const POST: RequestHandler = ({ request }) =>
  handleTelegramWebhook(request, {
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET,
    identitySecret: process.env.TELEGRAM_ID_HASH_SECRET,
    trigger: (payload, options) =>
      tasks.trigger<typeof telegramUpdateTask>('telegram-update', payload, options),
  })
