import type { SupabaseClient } from '@supabase/supabase-js'
import { Data, Effect } from 'effect'
import { getSupabaseServiceRoleClient } from '#shared/lib/db/service.server.ts'
import { createTelegramEnvelopeKey } from './envelope.server.ts'

export type TelegramDeliveryClaim =
  | { completed: true }
  | { completed: false; envelopeKey: string; checkRateLimit: boolean }

class TelegramDeliveryError extends Data.TaggedError('TelegramDeliveryError')<{
  readonly message: string
}> {}

const deliveryFailure = (message: string) => new TelegramDeliveryError({ message })

/** Effect-native idempotency claim program. */
export function claimTelegramUpdateEffect(
  updateId: string,
  identityHash: string,
  client: SupabaseClient = getSupabaseServiceRoleClient()
): Effect.Effect<TelegramDeliveryClaim, TelegramDeliveryError> {
  return Effect.gen(function* () {
    if (!/^[a-f0-9]{64}$/.test(identityHash)) return yield* Effect.fail(deliveryFailure('Invalid Telegram identity hash'))
    const envelopeKey = createTelegramEnvelopeKey()
    const { error: insertError } = yield* Effect.tryPromise({
      try: (signal) => client.from('telegram_updates').insert({
        update_id: updateId,
        status: 'processing',
        identity_hash: identityHash,
        envelope_key: envelopeKey,
      }).abortSignal(signal),
      catch: () => deliveryFailure('Failed to claim Telegram update'),
    })
    if (!insertError) return { completed: false, envelopeKey, checkRateLimit: true }
    if (insertError.code !== '23505') return yield* Effect.fail(deliveryFailure('Failed to claim Telegram update'))

    const { data, error } = yield* Effect.tryPromise({
      try: (signal) => client
        .from('telegram_updates')
        .select('status, attempt_count, identity_hash, envelope_key')
        .eq('update_id', updateId)
        .abortSignal(signal)
        .single(),
      catch: () => deliveryFailure('Failed to read Telegram update claim'),
    })
    if (error || !data) return yield* Effect.fail(deliveryFailure('Failed to read Telegram update claim'))
    if (data.status === 'completed') return { completed: true }
    if (data.identity_hash !== identityHash) return yield* Effect.fail(deliveryFailure('Telegram update identity mismatch'))
    if (typeof data.envelope_key !== 'string') return yield* Effect.fail(deliveryFailure('Telegram update retry key is unavailable'))
    const checkRateLimit = data.status === 'failed'

    const { error: updateError } = yield* Effect.tryPromise({
      try: (signal) => client
        .from('telegram_updates')
        .update({
          status: 'processing',
          attempt_count: Number(data.attempt_count) + 1,
          error_code: null,
          updated_at: new Date().toISOString(),
        })
        .eq('update_id', updateId)
        .eq('identity_hash', identityHash).abortSignal(signal),
      catch: () => deliveryFailure('Failed to renew Telegram update claim'),
    })
    if (updateError) return yield* Effect.fail(deliveryFailure('Failed to renew Telegram update claim'))
    return { completed: false, envelopeKey: data.envelope_key, checkRateLimit }
  })
}

export function claimTelegramUpdate(
  updateId: string,
  identityHash: string,
  client: SupabaseClient = getSupabaseServiceRoleClient(),
) {
  return Effect.runPromise(claimTelegramUpdateEffect(updateId, identityHash, client))
}

/** Effect-native conversation attachment program. */
export function attachTelegramUpdateConversationEffect(
  updateId: string,
  identityHash: string,
  conversationId: string,
  client: SupabaseClient = getSupabaseServiceRoleClient(),
): Effect.Effect<void, TelegramDeliveryError> {
  return Effect.gen(function* () {
    const { data, error } = yield* Effect.tryPromise({
      try: (signal) => client
        .from('telegram_updates')
        .update({ conversation_id: conversationId, updated_at: new Date().toISOString() })
        .eq('update_id', updateId)
        .eq('identity_hash', identityHash)
        .neq('status', 'completed')
        .select('update_id')
        .abortSignal(signal)
        .maybeSingle(),
      catch: () => deliveryFailure('Failed to attach Telegram conversation claim'),
    })
    if (error || !data) return yield* Effect.fail(deliveryFailure('Failed to attach Telegram conversation claim'))
  })
}

export function attachTelegramUpdateConversation(
  updateId: string,
  identityHash: string,
  conversationId: string,
  client: SupabaseClient = getSupabaseServiceRoleClient(),
) {
  return Effect.runPromise(attachTelegramUpdateConversationEffect(updateId, identityHash, conversationId, client))
}

/** Effect-native delivery envelope lookup program. */
export function getTelegramUpdateEnvelopeKeyEffect(
  updateId: string,
  client: SupabaseClient = getSupabaseServiceRoleClient(),
): Effect.Effect<string | null, TelegramDeliveryError> {
  return Effect.gen(function* () {
    const { data, error } = yield* Effect.tryPromise({
      try: (signal) => client
        .from('telegram_updates')
        .select('status, envelope_key')
        .eq('update_id', updateId)
        .abortSignal(signal)
        .single(),
      catch: () => deliveryFailure('Telegram update envelope key unavailable'),
    })
    if (error || !data) return yield* Effect.fail(deliveryFailure('Telegram update envelope key unavailable'))
    if (data.status === 'completed' && data.envelope_key == null) return null
    if (typeof data.envelope_key !== 'string') return yield* Effect.fail(deliveryFailure('Telegram update envelope key unavailable'))
    return data.envelope_key
  })
}

export function getTelegramUpdateEnvelopeKey(
  updateId: string,
  client: SupabaseClient = getSupabaseServiceRoleClient(),
) {
  return Effect.runPromise(getTelegramUpdateEnvelopeKeyEffect(updateId, client))
}

/** Effect-native successful delivery marker. */
export function markTelegramUpdateCompletedEffect(
  updateId: string,
  conversationId: string | null,
  client: SupabaseClient = getSupabaseServiceRoleClient(),
): Effect.Effect<void, TelegramDeliveryError> {
  return Effect.gen(function* () {
    const now = new Date().toISOString()
    const { error } = yield* Effect.tryPromise({
      try: (signal) => client
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
        .neq('status', 'completed').abortSignal(signal),
      catch: () => deliveryFailure('Failed to complete Telegram update claim'),
    })
    if (error) return yield* Effect.fail(deliveryFailure('Failed to complete Telegram update claim'))
  })
}

export function markTelegramUpdateCompleted(
  updateId: string,
  conversationId: string | null,
  client: SupabaseClient = getSupabaseServiceRoleClient(),
) {
  return Effect.runPromise(markTelegramUpdateCompletedEffect(updateId, conversationId, client))
}

/** Effect-native identity redaction program. */
export function redactTelegramIdentityClaimsEffect(
  identityHash: string,
  client: SupabaseClient = getSupabaseServiceRoleClient(),
): Effect.Effect<void, TelegramDeliveryError> {
  return Effect.gen(function* () {
    const now = new Date().toISOString()
    const { error } = yield* Effect.tryPromise({
      try: (signal) => client
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
        .eq('identity_hash', identityHash).abortSignal(signal),
      catch: () => deliveryFailure('Failed to redact Telegram identity claims'),
    })
    if (error) return yield* Effect.fail(deliveryFailure('Failed to redact Telegram identity claims'))
  })
}

export function redactTelegramIdentityClaims(
  identityHash: string,
  client: SupabaseClient = getSupabaseServiceRoleClient(),
) {
  return Effect.runPromise(redactTelegramIdentityClaimsEffect(identityHash, client))
}

/** Effect-native failed delivery marker. */
export function markTelegramUpdateFailedEffect(
  updateId: string,
  errorCode: string,
  client: SupabaseClient = getSupabaseServiceRoleClient(),
): Effect.Effect<void, TelegramDeliveryError> {
  return Effect.gen(function* () {
    const { error } = yield* Effect.tryPromise({
      try: (signal) => client
        .from('telegram_updates')
        .update({
          status: 'failed',
          error_code: errorCode.slice(0, 64),
          updated_at: new Date().toISOString(),
        })
        .eq('update_id', updateId)
        .neq('status', 'completed').abortSignal(signal),
      catch: () => deliveryFailure('Failed to mark Telegram update failed'),
    })
    if (error) return yield* Effect.fail(deliveryFailure('Failed to mark Telegram update failed'))
  })
}

export function markTelegramUpdateFailed(
  updateId: string,
  errorCode: string,
  client: SupabaseClient = getSupabaseServiceRoleClient(),
) {
  return Effect.runPromise(markTelegramUpdateFailedEffect(updateId, errorCode, client))
}
