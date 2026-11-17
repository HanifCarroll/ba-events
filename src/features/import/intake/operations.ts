/**
 * The operator commands that read or write the intake store, shared by `scripts/instagram-intake.ts` (on Supabase) and
 * the intake API (on D1), so both give the same output. Inputs are untrusted: each is decoded strictly here.
 */
import { Effect, Schema } from 'effect'
import { ImportOperationError } from '../core/effect-utils.ts'
import { SourceSchema } from './schema.ts'
import type { IntakeStore } from './store.ts'

const invalid = (message: string) => new ImportOperationError({ operation: 'intake.input', message })
const uuid = Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)))
const strict = <S extends Schema.Top>(schema: S, input: unknown, message: string) => Effect.try({
  try: () => Schema.decodeUnknownSync(schema as never, { onExcessProperty: 'error' })(input) as S['Type'],
  catch: error => invalid(`${message}: ${error instanceof Error ? error.message : 'see docs/instagram-intake.md'}`),
})

export const ReviewSchema = Schema.Struct({ observation_id: uuid,
  note: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(4000))) })
export const decodeSource = (input: unknown) => strict(SourceSchema, input, 'Invalid source')
export const decodeReview = (input: unknown) => strict(ReviewSchema, input, 'Invalid review')
export const decodeId = (input: unknown) => strict(uuid, input, 'Invalid id')

export const preflightEffect = Effect.fn('intake.preflight')(function*(store: IntakeStore, keys: { embedding: boolean; presentation: boolean }) {
  const policy = yield* store.policy()
  const sources = yield* store.enabledSourceCount()
  const storage = yield* store.storageReady()
  return { schema_ready: true, storage_ready: storage, active_sources: sources,
    collection_enabled: policy.collection_enabled, publishing_enabled: policy.publishing_enabled,
    run_cap_usd: Number(policy.run_cap_usd), monthly_cap_usd: Number(policy.monthly_cap_usd),
    embedding_key_present: keys.embedding, presentation_key_present: keys.presentation,
    publishing_ready: storage && policy.publishing_enabled && keys.embedding && keys.presentation,
    collection_ready: storage && policy.collection_enabled && sources > 0 && sources <= policy.max_sources }
})

/** Unreviewed observations, oldest first, each with its retained media rows. */
export const pendingEffect = Effect.fn('intake.pending')(function*(store: IntakeStore) {
  const observations = yield* store.unreviewedObservations()
  const records = []
  for (const observation of observations) records.push({ ...observation, media: yield* store.mediaFor(observation.id as string) })
  return records
})

export const lookupEffect = Effect.fn('intake.lookup')(function*(store: IntakeStore, name: unknown) {
  if (typeof name !== 'string' || !name || name.length > 100 || /[%_,()]/.test(name)) return yield* invalid('Use a plain name fragment')
  const [venues, events] = yield* Effect.all([store.lookupVenues(name), store.lookupEvents(name)])
  return { venues, events, coverage: 'bounded name lookup; preview performs the complete date-window comparison' }
})

/** The receipt without the private snapshot of the event before an update. */
export function publicReceipt(receipt: Record<string, unknown>) {
  const { previous_event: _privateSnapshot, ...rest } = receipt
  return rest
}
