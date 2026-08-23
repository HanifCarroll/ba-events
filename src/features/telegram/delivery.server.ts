import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseServiceRoleClient } from '#shared/lib/db/service.server.ts'
import { createTelegramEnvelopeKey } from './envelope.server.ts'

export type TelegramDeliveryClaim =
  | { completed: true }
  | { completed: false; envelopeKey: string; checkRateLimit: boolean }

export async function claimTelegramUpdate(
  updateId: string,
  identityHash: string,
  client: SupabaseClient = getSupabaseServiceRoleClient()
): Promise<TelegramDeliveryClaim> {
  if (!/^[a-f0-9]{64}$/.test(identityHash)) throw new Error('Invalid Telegram identity hash')
  const envelopeKey = createTelegramEnvelopeKey()
  const { error: insertError } = await client.from('telegram_updates').insert({
    update_id: updateId,
    status: 'processing',
    identity_hash: identityHash,
    envelope_key: envelopeKey,
  })
  if (!insertError) return { completed: false, envelopeKey, checkRateLimit: true }
  if (insertError.code !== '23505') throw new Error('Failed to claim Telegram update')

  const { data, error } = await client
    .from('telegram_updates')
    .select('status, attempt_count, identity_hash, envelope_key')
    .eq('update_id', updateId)
    .single()
  if (error || !data) throw new Error('Failed to read Telegram update claim')
  if (data.status === 'completed') return { completed: true }
  if (data.identity_hash !== identityHash) throw new Error('Telegram update identity mismatch')
  if (typeof data.envelope_key !== 'string') throw new Error('Telegram update retry key is unavailable')
  const checkRateLimit = data.status === 'failed'

  const { error: updateError } = await client
    .from('telegram_updates')
    .update({
      status: 'processing',
      attempt_count: Number(data.attempt_count) + 1,
      error_code: null,
      updated_at: new Date().toISOString(),
    })
    .eq('update_id', updateId)
    .eq('identity_hash', identityHash)
  if (updateError) throw new Error('Failed to renew Telegram update claim')
  return { completed: false, envelopeKey: data.envelope_key, checkRateLimit }
}

export async function attachTelegramUpdateConversation(
  updateId: string,
  identityHash: string,
  conversationId: string,
  client: SupabaseClient = getSupabaseServiceRoleClient()
): Promise<void> {
  const { data, error } = await client
    .from('telegram_updates')
    .update({ conversation_id: conversationId, updated_at: new Date().toISOString() })
    .eq('update_id', updateId)
    .eq('identity_hash', identityHash)
    .neq('status', 'completed')
    .select('update_id')
    .maybeSingle()
  if (error || !data) throw new Error('Failed to attach Telegram conversation claim')
}

export async function getTelegramUpdateEnvelopeKey(
  updateId: string,
  client: SupabaseClient = getSupabaseServiceRoleClient()
): Promise<string | null> {
  const { data, error } = await client
    .from('telegram_updates')
    .select('status, envelope_key')
    .eq('update_id', updateId)
    .single()
  if (error || !data) throw new Error('Telegram update envelope key unavailable')
  if (data.status === 'completed' && data.envelope_key == null) return null
  if (typeof data.envelope_key !== 'string') throw new Error('Telegram update envelope key unavailable')
  return data.envelope_key
}

export async function markTelegramUpdateCompleted(
  updateId: string,
  conversationId: string | null,
  client: SupabaseClient = getSupabaseServiceRoleClient()
): Promise<void> {
  const now = new Date().toISOString()
  const { error } = await client
    .from('telegram_updates')
    .update({
      status: 'completed',
      conversation_id: conversationId,
      envelope_key: null,
      error_code: null,
      completed_at: now,
      updated_at: now,
    })
    .eq('update_id', updateId)
    .neq('status', 'completed')
  if (error) throw new Error('Failed to complete Telegram update claim')
}

export async function redactTelegramIdentityClaims(
  identityHash: string,
  client: SupabaseClient = getSupabaseServiceRoleClient()
): Promise<void> {
  const now = new Date().toISOString()
  const { error } = await client
    .from('telegram_updates')
    .update({
      status: 'completed',
      conversation_id: null,
      identity_hash: null,
      envelope_key: null,
      error_code: 'identity_redacted',
      completed_at: now,
      updated_at: now,
    })
    .eq('identity_hash', identityHash)
  if (error) throw new Error('Failed to redact Telegram identity claims')
}

export async function markTelegramUpdateFailed(
  updateId: string,
  errorCode: string,
  client: SupabaseClient = getSupabaseServiceRoleClient()
): Promise<void> {
  const { error } = await client
    .from('telegram_updates')
    .update({
      status: 'failed',
      error_code: errorCode.slice(0, 64),
      updated_at: new Date().toISOString(),
    })
    .eq('update_id', updateId)
    .neq('status', 'completed')
  if (error) throw new Error('Failed to mark Telegram update failed')
}
