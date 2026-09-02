import type { SupabaseClient } from '@supabase/supabase-js'
import { Data, Effect, Schema } from 'effect'
import { logger } from '#shared/lib/logger.ts'

export const TELEGRAM_STALE_FAILURE_AGE_MS = 2 * 60 * 60 * 1000
export const TELEGRAM_RECENT_ERROR_AGE_MS = 2 * 60 * 60 * 1000
export const TELEGRAM_PENDING_UPDATE_LIMIT = 100
const MAX_PENDING_UPDATE_COUNT = 100_000
const MAX_WEBHOOK_ERROR_DATE = 4_102_444_800

export interface TelegramWebhookInfo { url: string; pending_update_count: number; last_error_date?: number }

class TelegramHealthError extends Data.TaggedError('TelegramHealthError')<{
  readonly message: string
  readonly cause?: unknown
}> {}

const telegramWebhookInfoSchema = Schema.Struct({
  url: Schema.String.pipe(
    Schema.check(Schema.isMaxLength(2048)),
    Schema.check(Schema.isPattern(/^https:\/\//)),
  ),
  pending_update_count: Schema.Int.pipe(
    Schema.check(Schema.isGreaterThanOrEqualTo(0)),
    Schema.check(Schema.isLessThanOrEqualTo(MAX_PENDING_UPDATE_COUNT)),
  ),
  last_error_date: Schema.optional(Schema.Int.pipe(
    Schema.check(Schema.isGreaterThanOrEqualTo(0)),
    Schema.check(Schema.isLessThanOrEqualTo(MAX_WEBHOOK_ERROR_DATE)),
  )),
})

export function parseTelegramWebhookInfo(value: unknown): TelegramWebhookInfo | null {
  const parsed = Schema.decodeUnknownResult(telegramWebhookInfoSchema)(value)
  return parsed._tag === 'Success' ? parsed.success : null
}

export function telegramHealthDecision(webhookInfo: unknown, staleFailedUpdates: number, now = new Date()) {
  const parsed = parseTelegramWebhookInfo(webhookInfo)
  if (!parsed) return { healthy: false, reason: 'malformed_webhook_info' as const }
  if (parsed.pending_update_count > TELEGRAM_PENDING_UPDATE_LIMIT) return { healthy: false, reason: 'pending_backlog' as const }
  if (parsed.last_error_date !== undefined && now.getTime() / 1000 - parsed.last_error_date <= TELEGRAM_RECENT_ERROR_AGE_MS / 1000) {
    return { healthy: false, reason: 'recent_webhook_error' as const }
  }
  if (!Number.isSafeInteger(staleFailedUpdates) || staleFailedUpdates < 0) return { healthy: false, reason: 'stale_failed_updates' as const }
  return staleFailedUpdates === 0 ? { healthy: true, reason: 'ok' as const } : { healthy: false, reason: 'stale_failed_updates' as const }
}

export function countStaleTelegramFailuresEffect(
  client: SupabaseClient,
  now = new Date(),
): Effect.Effect<number, TelegramHealthError> {
  return Effect.gen(function* () {
    const cutoff = new Date(now.getTime() - TELEGRAM_STALE_FAILURE_AGE_MS).toISOString()
    const { count, error } = yield* Effect.tryPromise({
      try: () => client.from('telegram_updates').select('update_id', { count: 'exact', head: true }).eq('status', 'failed').lt('updated_at', cutoff),
      catch: (cause) => new TelegramHealthError({ message: 'Failed to read stale Telegram updates', cause }),
    })
    if (error) return yield* Effect.fail(new TelegramHealthError({ message: 'Failed to read stale Telegram updates' }))
    return count ?? 0
  })
}

export function countStaleTelegramFailures(client: SupabaseClient, now = new Date()) {
  return Effect.runPromise(countStaleTelegramFailuresEffect(client, now))
}

/** Effect-native health program; scheduled callback remains the platform edge. */
export function runTelegramHealthCheckEffect(
  telegram: { getWebhookInfo: () => Promise<unknown> },
  client: SupabaseClient,
  now = new Date(),
): Effect.Effect<void, TelegramHealthError> {
  return Effect.gen(function* () {
    const webhookInfo = yield* Effect.tryPromise({
      try: () => telegram.getWebhookInfo(),
      catch: (cause) => new TelegramHealthError({ message: 'Telegram health check request failed', cause }),
    })
    const staleFailedUpdates = yield* countStaleTelegramFailuresEffect(client, now)
    const decision = telegramHealthDecision(webhookInfo, staleFailedUpdates, now)
    const parsed = parseTelegramWebhookInfo(webhookInfo)
    logger.info('[telegram] health check', { channel: 'telegram', phase: 'health-check', outcome: decision.healthy ? 'healthy' : 'unhealthy', pendingUpdateCount: parsed?.pending_update_count ?? null, recentWebhookError: decision.reason === 'recent_webhook_error', staleFailedUpdates, webhookStatus: decision.reason })
    if (!decision.healthy) return yield* Effect.fail(new TelegramHealthError({ message: `Telegram health check failed: ${decision.reason}` }))
  })
}

export function runTelegramHealthCheck(telegram: { getWebhookInfo: () => Promise<unknown> }, client: SupabaseClient, now = new Date()) {
  return Effect.runPromise(runTelegramHealthCheckEffect(telegram, client, now))
}
