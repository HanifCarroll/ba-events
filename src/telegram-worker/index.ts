import { createTelegramClient, TelegramApiError } from '#features/telegram/client.ts'
import { defaultTelegramTurnDependencies, processTelegramTurn } from '#features/telegram/turn.ts'
import { telegramTaskPayloadSchema, type TelegramTaskPayload } from '#features/telegram/task-payload.ts'
import { handleTelegramWebhook } from '#features/telegram/webhook.server.ts'
import { getSupabaseServiceRoleClient } from '#shared/lib/db/service.server.ts'
import { purgeTelegramRetention } from '#features/telegram/retention.ts'
import { runTelegramHealthCheck } from '#features/telegram/health.ts'

const ITEM_PREFIX = 'item:'
const SEEN_PREFIX = 'seen:'

type DurableObjectStorageLike = {
  get<T>(key: string): Promise<T | undefined>
  put(entries: Record<string, unknown>): Promise<void>
  put(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
  setAlarm(at: number): Promise<void>
  list<T>(options?: { prefix?: string; limit?: number }): Promise<{
    entries(): Iterator<[string, T]>
    size: number
  }>
}
type DurableObjectStateLike = { storage: DurableObjectStorageLike }
type DurableObjectNamespaceLike = {
  idFromName(name: string): unknown
  get(id: unknown): { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> }
}
type ScheduledControllerLike = { cron: string }
type ExecutionContextLike = { waitUntil(promise: Promise<unknown>): void }

type Env = {
  TELEGRAM_BOT_TOKEN: string
  TELEGRAM_WEBHOOK_SECRET: string
  TELEGRAM_ID_HASH_SECRET: string
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
  TELEGRAM_INBOX: DurableObjectNamespaceLike
}

export type InboxItem = {
  updateId: string
  payload: TelegramTaskPayload
  attempts: number
}

type InboxProcessor = (item: InboxItem, env: Env) => Promise<void>

export function boundedBackoffMs(attempt: number): number {
  return Math.min(2 ** attempt * 1_000, 30_000)
}

function retryAfterMs(error: unknown): number | null {
  const retryAfter = error instanceof TelegramApiError ? error.retryAfter : undefined
  if (retryAfter === undefined || !Number.isFinite(retryAfter) || retryAfter <= 0) return null
  return Math.ceil(retryAfter * 1_000)
}

async function processItem(item: InboxItem, env: Env): Promise<void> {
  const client = createTelegramClient({ token: env.TELEGRAM_BOT_TOKEN })
  await processTelegramTurn(item.payload, {
    ...defaultTelegramTurnDependencies,
    sendMessage: (chatId, message) => client.sendMessage(chatId, message.text, message.replyMarkup),
    sendTyping: (chatId) => client.sendChatAction(chatId),
    sendDraft: (chatId, draftId, text) => client.sendMessageDraft(chatId, draftId, text),
    answerCallback: (callbackId, text) => client.answerCallbackQuery(callbackId, text),
  })
}

export class TelegramInbox {
  constructor(
    private readonly state: DurableObjectStateLike,
    private readonly env: Env,
    private readonly processor: InboxProcessor = processItem,
  ) {}

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
    let payload: TelegramTaskPayload
    try {
      payload = telegramTaskPayloadSchema.parse(await request.json())
    } catch {
      return new Response('Bad Request', { status: 400 })
    }
    if (await this.state.storage.get(`${SEEN_PREFIX}${payload.updateId}`)) return new Response(null, { status: 202 })
    const sequence = (await this.state.storage.get<number>('sequence')) ?? 0
    const item: InboxItem = { updateId: payload.updateId, payload, attempts: 0 }
    await this.state.storage.put({
      sequence: sequence + 1,
      [`${ITEM_PREFIX}${String(sequence).padStart(16, '0')}`]: item,
      [`${SEEN_PREFIX}${payload.updateId}`]: true,
    })
    await this.state.storage.setAlarm(Date.now())
    return new Response(null, { status: 202 })
  }

  async alarm(): Promise<void> {
    const items = await this.state.storage.list<InboxItem>({ prefix: ITEM_PREFIX, limit: 1 })
    const entry = items.entries().next().value as [string, InboxItem] | undefined
    if (!entry) return
    const [key, item] = entry
    const seenKey = `${SEEN_PREFIX}${item.updateId}`
    try {
      await this.processor(item, this.env)
      await this.state.storage.delete(key)
      await this.state.storage.delete(seenKey)
    } catch (error) {
      if (item.attempts >= 2) {
        await this.state.storage.delete(key)
        await this.state.storage.delete(seenKey)
      } else {
        await this.state.storage.put(key, { ...item, attempts: item.attempts + 1 })
        const delay = retryAfterMs(error) ?? boundedBackoffMs(item.attempts)
        await this.state.storage.setAlarm(Date.now() + delay)
        return
      }
    }
    if ((await this.state.storage.list({ prefix: ITEM_PREFIX, limit: 1 })).size > 0) {
      await this.state.storage.setAlarm(Date.now())
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname !== '/api/telegram') return new Response('Not Found', { status: 404 })
    return handleTelegramWebhook(request, {
      webhookSecret: env.TELEGRAM_WEBHOOK_SECRET,
      identitySecret: env.TELEGRAM_ID_HASH_SECRET,
      trigger: async (payload) => {
        const id = env.TELEGRAM_INBOX.idFromName(payload.queueKey)
        const response = await env.TELEGRAM_INBOX.get(id).fetch('https://telegram-inbox/internal', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!response.ok) throw new Error('Telegram inbox rejected update')
      },
    })
  },
  async scheduled(controller: ScheduledControllerLike, env: Env, ctx: ExecutionContextLike): Promise<void> {
    const job = controller.cron === '0 * * * *'
      ? runTelegramHealthCheck(createTelegramClient({ token: env.TELEGRAM_BOT_TOKEN }), getSupabaseServiceRoleClient())
      : purgeTelegramRetention(getSupabaseServiceRoleClient())
    ctx.waitUntil(job)
  },
}
