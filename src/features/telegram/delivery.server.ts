import { Data, Effect } from 'effect'
import { createTelegramEnvelopeKey } from './envelope.server.ts'
import { requireD1 } from '#shared/lib/db/d1-binding.server.ts'
import * as d1 from './telegram-d1.server.ts'

export type TelegramDeliveryClaim =
  | { completed: true }
  | { completed: false; envelopeKey: string; checkRateLimit: boolean }

class TelegramDeliveryError extends Data.TaggedError('TelegramDeliveryError')<{
  readonly message: string
}> {}

const deliveryFailure = (message: string) => new TelegramDeliveryError({ message })

function d1Effect<A>(work: () => Promise<A>, message: string) {
  return Effect.tryPromise({ try: work, catch: () => deliveryFailure(message) })
}

/** Effect-native idempotency claim program. */
export function claimTelegramUpdateEffect(
  updateId: string,
  identityHash: string,
): Effect.Effect<TelegramDeliveryClaim, TelegramDeliveryError> {
  return Effect.gen(function* () {
    if (!/^[a-f0-9]{64}$/.test(identityHash)) return yield* deliveryFailure('Invalid Telegram identity hash')
    const envelopeKey = createTelegramEnvelopeKey()
    const now = new Date().toISOString()
    if (yield* d1Effect(() => d1.insertClaim(requireD1(), updateId, identityHash, envelopeKey, now), 'Failed to claim Telegram update')) {
      return { completed: false, envelopeKey, checkRateLimit: true }
    }
    const data = yield* d1Effect(() => d1.readClaim(requireD1(), updateId), 'Failed to read Telegram update claim')
    if (!data) return yield* deliveryFailure('Failed to read Telegram update claim')
    if (data.status === 'completed') return { completed: true }
    if (data.identity_hash !== identityHash) return yield* deliveryFailure('Telegram update identity mismatch')
    if (typeof data.envelope_key !== 'string') return yield* deliveryFailure('Telegram update retry key is unavailable')
    const retryKey = data.envelope_key
    yield* d1Effect(() => d1.renewClaim(requireD1(), updateId, identityHash, now), 'Failed to renew Telegram update claim')
    return { completed: false, envelopeKey: retryKey, checkRateLimit: data.status === 'failed' }
  })
}

export function claimTelegramUpdate(
  updateId: string,
  identityHash: string,
) {
  return Effect.runPromise(claimTelegramUpdateEffect(updateId, identityHash))
}

/** Effect-native conversation attachment program. */
export function attachTelegramUpdateConversationEffect(
  updateId: string,
  identityHash: string,
  conversationId: string,
): Effect.Effect<void, TelegramDeliveryError> {
  return Effect.flatMap(
    d1Effect(() => d1.attachConversation(requireD1(), updateId, identityHash, conversationId, new Date().toISOString()),
      'Failed to attach Telegram conversation claim'),
    (attached) => attached ? Effect.void : Effect.fail(deliveryFailure('Failed to attach Telegram conversation claim')))
}

export function attachTelegramUpdateConversation(
  updateId: string,
  identityHash: string,
  conversationId: string,
) {
  return Effect.runPromise(attachTelegramUpdateConversationEffect(updateId, identityHash, conversationId))
}

/** Effect-native delivery envelope lookup program. */
export function getTelegramUpdateEnvelopeKeyEffect(
  updateId: string,
): Effect.Effect<string | null, TelegramDeliveryError> {
  return Effect.gen(function* () {
    const data = yield* d1Effect(() => d1.readClaim(requireD1(), updateId), 'Telegram update envelope key unavailable')
    if (!data) return yield* deliveryFailure('Telegram update envelope key unavailable')
    if (data.status === 'completed' && data.envelope_key == null) return null
    if (typeof data.envelope_key !== 'string') return yield* deliveryFailure('Telegram update envelope key unavailable')
    return data.envelope_key
  })
}

export function getTelegramUpdateEnvelopeKey(
  updateId: string,
) {
  return Effect.runPromise(getTelegramUpdateEnvelopeKeyEffect(updateId))
}

/** Effect-native successful delivery marker. */
export function markTelegramUpdateCompletedEffect(
  updateId: string,
  conversationId: string | null,
): Effect.Effect<void, TelegramDeliveryError> {
  return d1Effect(() => d1.markCompleted(requireD1(), updateId, conversationId, new Date().toISOString()), 'Failed to complete Telegram update claim')
}

export function markTelegramUpdateCompleted(
  updateId: string,
  conversationId: string | null,
) {
  return Effect.runPromise(markTelegramUpdateCompletedEffect(updateId, conversationId))
}

/** Effect-native identity redaction program. */
export function redactTelegramIdentityClaimsEffect(
  identityHash: string,
): Effect.Effect<void, TelegramDeliveryError> {
  return d1Effect(() => d1.redactIdentity(requireD1(), identityHash, new Date().toISOString()), 'Failed to redact Telegram identity claims')
}

export function redactTelegramIdentityClaims(
  identityHash: string,
) {
  return Effect.runPromise(redactTelegramIdentityClaimsEffect(identityHash))
}

/** Effect-native failed delivery marker. */
export function markTelegramUpdateFailedEffect(
  updateId: string,
  errorCode: string,
): Effect.Effect<void, TelegramDeliveryError> {
  return d1Effect(() => d1.markFailed(requireD1(), updateId, errorCode, new Date().toISOString()), 'Failed to mark Telegram update failed')
}

export function markTelegramUpdateFailed(
  updateId: string,
  errorCode: string,
) {
  return Effect.runPromise(markTelegramUpdateFailedEffect(updateId, errorCode))
}
