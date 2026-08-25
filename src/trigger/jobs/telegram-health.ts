import { schedules } from '@trigger.dev/sdk/v3'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createTelegramClient } from '#features/telegram/client.ts'
import { createServiceRoleClient } from '../utils/db-client.ts'
import { logger } from '#shared/lib/logger.ts'

// Two hours is well beyond the task's normal retry sequence.
export const TELEGRAM_STALE_FAILURE_AGE_MS = 2 * 60 * 60 * 1000
export const TELEGRAM_RECENT_ERROR_AGE_MS = 2 * 60 * 60 * 1000
export const TELEGRAM_PENDING_UPDATE_LIMIT = 100
const MAX_PENDING_UPDATE_COUNT = 100_000
const MAX_WEBHOOK_ERROR_DATE = 4_102_444_800 // 2100-01-01, bounded Telegram epoch seconds

export interface TelegramWebhookInfo {
  url: string
  pending_update_count: number
  last_error_date?: number
}

export function parseTelegramWebhookInfo(value: unknown): TelegramWebhookInfo | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const info = value as Record<string, unknown>
  if (
    typeof info.url !== 'string' || info.url.length > 2048 ||
    !info.url.startsWith('https://') ||
    !Number.isSafeInteger(info.pending_update_count) ||
    (info.pending_update_count as number) < 0 ||
    (info.pending_update_count as number) > MAX_PENDING_UPDATE_COUNT ||
    (info.last_error_date !== undefined &&
      (!Number.isSafeInteger(info.last_error_date) ||
        (info.last_error_date as number) < 0 ||
        (info.last_error_date as number) > MAX_WEBHOOK_ERROR_DATE))
  ) return null
  return {
    url: info.url,
    pending_update_count: info.pending_update_count as number,
    ...(info.last_error_date === undefined ? {} : { last_error_date: info.last_error_date as number }),
  }
}

export function telegramHealthDecision(
  webhookInfo: unknown,
  staleFailedUpdates: number,
  now = new Date(),
): {
  healthy: boolean
  reason: 'ok' | 'malformed_webhook_info' | 'pending_backlog' | 'recent_webhook_error' | 'stale_failed_updates'
} {
  const parsed = parseTelegramWebhookInfo(webhookInfo)
  if (!parsed) return { healthy: false, reason: 'malformed_webhook_info' }
  if (parsed.pending_update_count > TELEGRAM_PENDING_UPDATE_LIMIT) {
    return { healthy: false, reason: 'pending_backlog' }
  }
  if (
    parsed.last_error_date !== undefined &&
    now.getTime() / 1000 - parsed.last_error_date <= TELEGRAM_RECENT_ERROR_AGE_MS / 1000
  ) {
    return { healthy: false, reason: 'recent_webhook_error' }
  }
  if (!Number.isSafeInteger(staleFailedUpdates) || staleFailedUpdates < 0) {
    return { healthy: false, reason: 'stale_failed_updates' }
  }
  return staleFailedUpdates === 0
    ? { healthy: true, reason: 'ok' }
    : { healthy: false, reason: 'stale_failed_updates' }
}

export async function countStaleTelegramFailures(
  client: SupabaseClient,
  now = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - TELEGRAM_STALE_FAILURE_AGE_MS).toISOString()
  const { count, error } = await client
    .from('telegram_updates')
    .select('update_id', { count: 'exact', head: true })
    .eq('status', 'failed')
    .lt('updated_at', cutoff)
  if (error) throw new Error('Failed to read stale Telegram updates')
  return count ?? 0
}

export async function runTelegramHealthCheck(
  telegram: { getWebhookInfo: () => Promise<unknown> },
  client: SupabaseClient,
  now = new Date(),
): Promise<void> {
  const webhookInfo = await telegram.getWebhookInfo()
  const staleFailedUpdates = await countStaleTelegramFailures(client, now)
  const decision = telegramHealthDecision(webhookInfo, staleFailedUpdates, now)
  const parsed = parseTelegramWebhookInfo(webhookInfo)
  logger.info('[telegram] health check', {
    channel: 'telegram',
    phase: 'health-check',
    outcome: decision.healthy ? 'healthy' : 'unhealthy',
    pendingUpdateCount: parsed?.pending_update_count ?? null,
    recentWebhookError: decision.reason === 'recent_webhook_error',
    staleFailedUpdates,
    webhookStatus: decision.reason,
  })
  if (!decision.healthy) throw new Error(`Telegram health check failed: ${decision.reason}`)
}

export const telegramHealth = schedules.task({
  id: 'telegram-health',
  cron: { pattern: '0 * * * *', timezone: 'America/Buenos_Aires' },
  run: async () => runTelegramHealthCheck(
    createTelegramClient({ token: process.env.TELEGRAM_BOT_TOKEN ?? '' }),
    createServiceRoleClient(),
  ),
})
