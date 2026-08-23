import { createTelegramClient } from '../src/features/telegram/client.ts'

const action = process.argv[2]
const token = process.env.TELEGRAM_BOT_TOKEN ?? ''
if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required')

const client = createTelegramClient({ token })

if (action === 'set') {
  const url = process.env.TELEGRAM_WEBHOOK_URL
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (!url || !secret) {
    throw new Error('TELEGRAM_WEBHOOK_URL and TELEGRAM_WEBHOOK_SECRET are required')
  }
  await client.setWebhook(url, secret)
  console.log('Telegram webhook configured.')
} else if (action === 'info') {
  const info = await client.getWebhookInfo()
  console.log(JSON.stringify(info, null, 2))
} else if (action === 'delete') {
  await client.deleteWebhook(process.env.TELEGRAM_DROP_PENDING_UPDATES === 'true')
  console.log('Telegram webhook deleted.')
} else {
  throw new Error('Usage: bun scripts/telegram-webhook.ts set|info|delete')
}
