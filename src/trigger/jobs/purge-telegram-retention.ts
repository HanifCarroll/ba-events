import type { SupabaseClient } from '@supabase/supabase-js'

export const TELEGRAM_RETENTION_DAYS = 30

export async function purgeTelegramRetention(
  client: SupabaseClient,
  now = new Date()
): Promise<{ conversations: number; updates: number }> {
  const cutoff = new Date(
    now.getTime() - TELEGRAM_RETENTION_DAYS * 24 * 60 * 60 * 1000
  ).toISOString()

  const { error: conversationError, count: conversations } = await client
    .from('conversations')
    .delete({ count: 'exact' })
    .eq('channel', 'telegram')
    .lt('created_at', cutoff)
  if (conversationError) throw new Error('Telegram conversation retention failed')

  const { error: updateError, count: updates } = await client
    .from('telegram_updates')
    .delete({ count: 'exact' })
    .lt('received_at', cutoff)
  if (updateError) throw new Error('Telegram update retention failed')

  return { conversations: conversations ?? 0, updates: updates ?? 0 }
}
