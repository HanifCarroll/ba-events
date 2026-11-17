/**
 * Core Venue Review Logic
 *
 * Approve/reject/merge operations for the venue review queue.
 *
 * The admin review UI was removed (agents operate the site); these functions
 * keep the review operations callable from agent scripts through a catalog
 * store (catalog-store.ts). `reviewedBy` is optional because service-role contexts have no auth
 * user.
 */
import { Data, Effect } from 'effect'
import type { CatalogStore } from './catalog-store.ts'
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
  catalog: CatalogStore,
  input: VenueReviewInput & { finalVenueId: string | null; status: 'approved' | 'rejected' | 'merged' }
): Effect.Effect<{ success: true }, VenueReviewError> {
  return Effect.gen(function* () {
    const { id, notes, reviewedBy, finalVenueId, status } = input

    yield* importTry('venue-review.update-queue', () => catalog.settleVenueReview(id, {
      status,
      final_venue_id: finalVenueId,
      reviewed_at: new Date().toISOString(),
      reviewed_by: reviewedBy ?? null,
      notes: notes ?? null,
    })).pipe(Effect.mapError((cause) => reviewError('venue-review.update-queue', cause.message, cause)))

    // Update events to use the settled venue. A failed read re-points nothing, as before.
    if (finalVenueId) {
      const eventIds = yield* importTry('venue-review.load-queue', () => catalog.venueReviewEventIds(id))
        .pipe(Effect.mapError((cause) => reviewError('venue-review.load-queue', cause.message, cause)))

      if (eventIds.length) {
        yield* importTry('venue-review.repoint-events', () => catalog.setEventsVenue(eventIds, finalVenueId)).pipe(
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
  catalog: CatalogStore,
  input: ApproveVenueReviewInput
): Effect.Effect<{ success: true }, VenueReviewError> {
  return settleReviewEffect(catalog, {
    ...input,
    finalVenueId: input.venueId,
    status: 'approved',
  })
}

export async function approveVenueReview(
  catalog: CatalogStore,
  input: ApproveVenueReviewInput
): Promise<{ success: true }> {
  return runReview(approveVenueReviewEffect(catalog, input))
}

/**
 * Reject a venue review (don't use this venue).
 */
export function rejectVenueReviewEffect(
  catalog: CatalogStore,
  input: VenueReviewInput
): Effect.Effect<{ success: true }, VenueReviewError> {
  return settleReviewEffect(catalog, {
    ...input,
    finalVenueId: null,
    status: 'rejected',
  })
}

export async function rejectVenueReview(
  catalog: CatalogStore,
  input: VenueReviewInput
): Promise<{ success: true }> {
  return runReview(rejectVenueReviewEffect(catalog, input))
}

/**
 * Merge a venue review into an existing venue.
 */
export function mergeVenueReviewEffect(
  catalog: CatalogStore,
  input: MergeVenueReviewInput
): Effect.Effect<{ success: true }, VenueReviewError> {
  return settleReviewEffect(catalog, {
    ...input,
    finalVenueId: input.targetVenueId,
    status: 'merged',
  })
}

export async function mergeVenueReview(
  catalog: CatalogStore,
  input: MergeVenueReviewInput
): Promise<{ success: true }> {
  return runReview(mergeVenueReviewEffect(catalog, input))
}
