import { Schema } from 'effect'

const campaign = Schema.fromJsonString(Schema.Struct({ expiresAt: Schema.Number, attemptIds: Schema.Array(Schema.String) }))
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Server configuration selects a finite, expiring comparison cohort. Invalid
 * configuration fails closed; request bodies and headers cannot enable it.
 */
export function selectedForEarlyStartup(configuration: string | undefined, attemptId: string, now: number): boolean {
  if (!configuration || configuration.length > 4096) return false
  try {
    const parsed = Schema.decodeUnknownSync(campaign)(configuration)
    return Number.isFinite(parsed.expiresAt) && parsed.expiresAt > now &&
      parsed.expiresAt <= now + 2 * 60 * 60_000 && parsed.attemptIds.length <= 64 &&
      parsed.attemptIds.every(id => uuid.test(id)) && parsed.attemptIds.includes(attemptId)
  } catch { return false }
}
