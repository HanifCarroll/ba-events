/**
 * Core Venue Review Logic
 *
 * Approve/reject/merge operations for the venue review queue.
 *
 * The admin review UI was removed (agents operate the site); these functions
 * keep the review operations callable from agent scripts with a service-role
 * client. `reviewedBy` is optional because service-role contexts have no auth
 * user.
 */
import { Data, Effect } from 'effect'
import type { SupabaseClient } from '@supabase/supabase-js'
import { importTry } from './effect-utils.ts'

interface VenueReviewInput {
  id: string
  notes?: string | null
  reviewedBy?: string | null
}

export interface ApproveVenueReviewInput extends VenueReviewInput {
  venueId: string
}

export interface MergeVenueReviewInput extends VenueReviewInput {
  targetVenueId: string
}

export class VenueReviewError extends Data.TaggedError('VenueReviewError')<{
  readonly operation: string
  readonly message: string
  readonly cause?: unknown
}> {}

const reviewError = (operation: string, message: string, cause?: unknown) =>
  new VenueReviewError({ operation, message, cause })

/**
 * Update the review queue entry and re-point its events at a venue.
 */
function settleReviewEffect(
  client: SupabaseClient,
  input: VenueReviewInput & { finalVenueId: string | null; status: 'approved' | 'rejected' | 'merged' }
): Effect.Effect<{ success: true }, VenueReviewError> {
  return Effect.gen(function* () {
    const { id, notes, reviewedBy, finalVenueId, status } = input

    const { error } = yield* importTry('venue-review.update-queue', () => client
      .from('venue_review_queue')
      .update({
        status,
        final_venue_id: finalVenueId,
        reviewed_at: new Date().toISOString(),
        reviewed_by: reviewedBy ?? null,
        notes: notes ?? null,
      })
      .eq('id', id)
    ).pipe(Effect.mapError((cause) => reviewError('venue-review.update-queue', cause.message, cause)))

    if (error) return yield* Effect.fail(reviewError('venue-review.update-queue', error.message, error))

    // Update events to use the settled venue. A rejected SDK promise still
    // fails the program, while a response-level update error remains ignored
    // as it was in the legacy implementation.
    if (finalVenueId) {
      const { data: review } = yield* importTry('venue-review.load-queue', () => client
        .from('venue_review_queue')
        .select('source_event_ids')
        .eq('id', id)
        .single()
      ).pipe(Effect.mapError((cause) => reviewError('venue-review.load-queue', cause.message, cause)))

      if (review?.source_event_ids?.length) {
        yield* importTry('venue-review.repoint-events', () => client
          .from('events')
          .update({ venue_id: finalVenueId })
          .in('id', review.source_event_ids)
        ).pipe(
          Effect.mapError((cause) => reviewError('venue-review.repoint-events', cause.message, cause)),
          Effect.asVoid
        )
      }
    }

    return { success: true as const }
  })
}

const runReview = <A>(effect: Effect.Effect<A, VenueReviewError>): Promise<A> =>
  Effect.runPromise(effect).catch((error) => {
    throw new Error(error instanceof Error ? error.message : String(error))
  })

/**
 * Approve a venue review (use the suggested match).
 */
export function approveVenueReviewEffect(
  client: SupabaseClient,
  input: ApproveVenueReviewInput
): Effect.Effect<{ success: true }, VenueReviewError> {
  return settleReviewEffect(client, {
    ...input,
    finalVenueId: input.venueId,
    status: 'approved',
  })
}

export async function approveVenueReview(
  client: SupabaseClient,
  input: ApproveVenueReviewInput
): Promise<{ success: true }> {
  return runReview(approveVenueReviewEffect(client, input))
}

/**
 * Reject a venue review (don't use this venue).
 */
export function rejectVenueReviewEffect(
  client: SupabaseClient,
  input: VenueReviewInput
): Effect.Effect<{ success: true }, VenueReviewError> {
  return settleReviewEffect(client, {
    ...input,
    finalVenueId: null,
    status: 'rejected',
  })
}

export async function rejectVenueReview(
  client: SupabaseClient,
  input: VenueReviewInput
): Promise<{ success: true }> {
  return runReview(rejectVenueReviewEffect(client, input))
}

/**
 * Merge a venue review into an existing venue.
 */
export function mergeVenueReviewEffect(
  client: SupabaseClient,
  input: MergeVenueReviewInput
): Effect.Effect<{ success: true }, VenueReviewError> {
  return settleReviewEffect(client, {
    ...input,
    finalVenueId: input.targetVenueId,
    status: 'merged',
  })
}

export async function mergeVenueReview(
  client: SupabaseClient,
  input: MergeVenueReviewInput
): Promise<{ success: true }> {
  return runReview(mergeVenueReviewEffect(client, input))
}
