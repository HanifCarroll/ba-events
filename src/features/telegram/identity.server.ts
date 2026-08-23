import { createHmac } from 'node:crypto'

export function hashTelegramIdentity(telegramUserId: string, secret: string): string {
  if (!/^\d{1,20}$/.test(telegramUserId)) throw new Error('Invalid Telegram user ID')
  if (Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('Telegram identity secret must be at least 32 bytes')
  }
  return createHmac('sha256', secret).update(`telegram:v1:${telegramUserId}`).digest('hex')
}
