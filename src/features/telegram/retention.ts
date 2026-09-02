import type { SupabaseClient } from '@supabase/supabase-js'
import { Data, Effect } from 'effect'

export const TELEGRAM_RETENTION_DAYS = 30

class TelegramRetentionError extends Data.TaggedError('TelegramRetentionError')<{
  readonly message: string
}> {}

/** Effect-native retention purge; platform scheduler remains the runtime root. */
export function purgeTelegramRetentionEffect(
  client: SupabaseClient,
  now = new Date(),
): Effect.Effect<{ conversations: number; updates: number }, TelegramRetentionError> {
  return Effect.gen(function* () {
    const cutoff = new Date(now.getTime() - TELEGRAM_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()
    const { error: conversationError, count: conversations } = yield* Effect.tryPromise({
      try: () => client.from('conversations').delete({ count: 'exact' }).eq('channel', 'telegram').lt('created_at', cutoff),
      catch: () => new TelegramRetentionError({ message: 'Telegram conversation retention failed' }),
    })
    if (conversationError) return yield* Effect.fail(new TelegramRetentionError({ message: 'Telegram conversation retention failed' }))
    const { error: updateError, count: updates } = yield* Effect.tryPromise({
      try: () => client.from('telegram_updates').delete({ count: 'exact' }).lt('received_at', cutoff),
      catch: () => new TelegramRetentionError({ message: 'Telegram update retention failed' }),
    })
    if (updateError) return yield* Effect.fail(new TelegramRetentionError({ message: 'Telegram update retention failed' }))
    return { conversations: conversations ?? 0, updates: updates ?? 0 }
  })
}

export function purgeTelegramRetention(client: SupabaseClient, now = new Date()) {
  return Effect.runPromise(purgeTelegramRetentionEffect(client, now))
}
