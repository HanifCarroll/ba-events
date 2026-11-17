import type { SupabaseClient } from '@supabase/supabase-js'
import { Data, Effect } from 'effect'
import { getSupabaseServiceRoleClient } from '#shared/lib/db/service.server.ts'
import { createTelegramEnvelopeKey } from './envelope.server.ts'
import { boundD1 } from '#shared/lib/db/d1-binding.server.ts'
import * as d1 from './telegram-d1.server.ts'

export type TelegramDeliveryClaim =
  | { completed: true }
  | { completed: false; envelopeKey: string; checkRateLimit: boolean }

class TelegramDeliveryError extends Data.TaggedError('TelegramDeliveryError')<{
  readonly message: string
}> {}

const deliveryFailure = (message: string) => new TelegramDeliveryError({ message })

/** The D1 path when the Worker binds `DB` and no Supabase client was passed in (tests pass one). */
function d1For(client: SupabaseClient | undefined) {
  return client ? null : boundD1()
}

function d1Effect<A>(work: () => Promise<A>, message: string) {
  return Effect.tryPromise({ try: work, catch: () => deliveryFailure(message) })
}

/** Effect-native idempotency claim program. */
export function claimTelegramUpdateEffect(
  updateId: string,
  identityHash: string,
  client?: SupabaseClient
): Effect.Effect<TelegramDeliveryClaim, TelegramDeliveryError> {
  return Effect.gen(function* () {
    if (!/^[a-f0-9]{64}$/.test(identityHash)) return yield* Effect.fail(deliveryFailure('Invalid Telegram identity hash'))
    const envelopeKey = createTelegramEnvelopeKey()
    const db = d1For(client)
    if (db) {
      const now = new Date().toISOString()
      if (yield* d1Effect(() => d1.insertClaim(db, updateId, identityHash, envelopeKey, now), 'Failed to claim Telegram update')) {
        return { completed: false, envelopeKey, checkRateLimit: true }
      }
      const data = yield* d1Effect(() => d1.readClaim(db, updateId), 'Failed to read Telegram update claim')
      if (!data) return yield* Effect.fail(deliveryFailure('Failed to read Telegram update claim'))
      if (data.status === 'completed') return { completed: true }
      if (data.identity_hash !== identityHash) return yield* Effect.fail(deliveryFailure('Telegram update identity mismatch'))
      if (typeof data.envelope_key !== 'string') return yield* Effect.fail(deliveryFailure('Telegram update retry key is unavailable'))
      const retryKey = data.envelope_key
      yield* d1Effect(() => d1.renewClaim(db, updateId, identityHash, now), 'Failed to renew Telegram update claim')
      return { completed: false, envelopeKey: retryKey, checkRateLimit: data.status === 'failed' }
    }
    const supabase = client ?? getSupabaseServiceRoleClient()
    const { error: insertError } = yield* Effect.tryPromise({
      try: (signal) => supabase.from('telegram_updates').insert({
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
      try: (signal) => supabase
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
      try: (signal) => supabase
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
  client?: SupabaseClient,
) {
  return Effect.runPromise(claimTelegramUpdateEffect(updateId, identityHash, client))
}

/** Effect-native conversation attachment program. */
export function attachTelegramUpdateConversationEffect(
  updateId: string,
  identityHash: string,
  conversationId: string,
  client?: SupabaseClient,
): Effect.Effect<void, TelegramDeliveryError> {
  const db = d1For(client)
  if (db) {
    return Effect.flatMap(
      d1Effect(() => d1.attachConversation(db, updateId, identityHash, conversationId, new Date().toISOString()),
        'Failed to attach Telegram conversation claim'),
      (attached) => attached ? Effect.void : Effect.fail(deliveryFailure('Failed to attach Telegram conversation claim')))
  }
  const supabase = client ?? getSupabaseServiceRoleClient()
  return Effect.gen(function* () {
    const { data, error } = yield* Effect.tryPromise({
      try: (signal) => supabase
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
  client?: SupabaseClient,
) {
  return Effect.runPromise(attachTelegramUpdateConversationEffect(updateId, identityHash, conversationId, client))
}

/** Effect-native delivery envelope lookup program. */
export function getTelegramUpdateEnvelopeKeyEffect(
  updateId: string,
  client?: SupabaseClient,
): Effect.Effect<string | null, TelegramDeliveryError> {
  const db = d1For(client)
  const supabase = db ? null : client ?? getSupabaseServiceRoleClient()
  return Effect.gen(function* () {
    const { data, error } = db
      ? { data: yield* d1Effect(() => d1.readClaim(db, updateId), 'Telegram update envelope key unavailable'), error: null }
      : yield* Effect.tryPromise({
      try: (signal) => supabase!
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
  client?: SupabaseClient,
) {
  return Effect.runPromise(getTelegramUpdateEnvelopeKeyEffect(updateId, client))
}

/** Effect-native successful delivery marker. */
export function markTelegramUpdateCompletedEffect(
  updateId: string,
  conversationId: string | null,
  client?: SupabaseClient,
): Effect.Effect<void, TelegramDeliveryError> {
  const db = d1For(client)
  if (db) {
    return d1Effect(() => d1.markCompleted(db, updateId, conversationId, new Date().toISOString()), 'Failed to complete Telegram update claim')
  }
  const supabase = client ?? getSupabaseServiceRoleClient()
  return Effect.gen(function* () {
    const now = new Date().toISOString()
    const { error } = yield* Effect.tryPromise({
      try: (signal) => supabase
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
  client?: SupabaseClient,
) {
  return Effect.runPromise(markTelegramUpdateCompletedEffect(updateId, conversationId, client))
}

/** Effect-native identity redaction program. */
export function redactTelegramIdentityClaimsEffect(
  identityHash: string,
  client?: SupabaseClient,
): Effect.Effect<void, TelegramDeliveryError> {
  const db = d1For(client)
  if (db) return d1Effect(() => d1.redactIdentity(db, identityHash, new Date().toISOString()), 'Failed to redact Telegram identity claims')
  const supabase = client ?? getSupabaseServiceRoleClient()
  return Effect.gen(function* () {
    const now = new Date().toISOString()
    const { error } = yield* Effect.tryPromise({
      try: (signal) => supabase
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
  client?: SupabaseClient,
) {
  return Effect.runPromise(redactTelegramIdentityClaimsEffect(identityHash, client))
}

/** Effect-native failed delivery marker. */
export function markTelegramUpdateFailedEffect(
  updateId: string,
  errorCode: string,
  client?: SupabaseClient,
): Effect.Effect<void, TelegramDeliveryError> {
  const db = d1For(client)
  if (db) return d1Effect(() => d1.markFailed(db, updateId, errorCode, new Date().toISOString()), 'Failed to mark Telegram update failed')
  const supabase = client ?? getSupabaseServiceRoleClient()
  return Effect.gen(function* () {
    const { error } = yield* Effect.tryPromise({
      try: (signal) => supabase
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
  client?: SupabaseClient,
) {
  return Effect.runPromise(markTelegramUpdateFailedEffect(updateId, errorCode, client))
}
