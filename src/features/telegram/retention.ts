import { Data, Effect } from 'effect'
import type { D1Database } from '@cloudflare/workers-types'
import { EXTERNAL_CHANNEL } from '#features/chat/api/channels.ts'
import { purgeExternalConversations } from '#features/chat/api/external-conversations.server.ts'
import { preparePurgeUpdateClaims } from './telegram-d1.server.ts'

export const TELEGRAM_RETENTION_DAYS = 30

class TelegramRetentionError extends Data.TaggedError('TelegramRetentionError')<{
  readonly message: string
}> {}

/** Delete expired conversations first and then expired claims, in one D1 transaction. */
export async function purgeRetention(client: D1Database, cutoff: string) {
  const { conversations, afterResults: [updates] } = await purgeExternalConversations(
    client, EXTERNAL_CHANNEL.telegram, cutoff, [preparePurgeUpdateClaims(client, cutoff)],
  )
  return { conversations, updates: updates.results.length }
}

/** Effect-native retention purge; platform scheduler remains the runtime root. */
export function purgeTelegramRetentionEffect(
  client: D1Database,
  now = new Date(),
): Effect.Effect<{ conversations: number; updates: number }, TelegramRetentionError> {
  return Effect.gen(function* () {
    const cutoff = new Date(now.getTime() - TELEGRAM_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()
    return yield* Effect.tryPromise({
      try: () => purgeRetention(client, cutoff),
      catch: () => new TelegramRetentionError({ message: 'Telegram retention failed' }),
    })
  })
}

export function purgeTelegramRetention(client: D1Database, now = new Date()) {
  return Effect.runPromise(purgeTelegramRetentionEffect(client, now))
}
