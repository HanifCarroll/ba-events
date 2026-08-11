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
import type { SupabaseClient } from '@supabase/supabase-js'

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

/**
 * Update the review queue entry and re-point its events at a venue.
 */
async function settleReview(
  client: SupabaseClient,
  input: VenueReviewInput & { finalVenueId: string | null; status: 'approved' | 'rejected' | 'merged' }
): Promise<{ success: true }> {
  const { id, notes, reviewedBy, finalVenueId, status } = input

  const { error } = await client
    .from('venue_review_queue')
    .update({
      status,
      final_venue_id: finalVenueId,
      reviewed_at: new Date().toISOString(),
      reviewed_by: reviewedBy ?? null,
      notes: notes ?? null,
    })
    .eq('id', id)

  if (error) throw new Error(error.message)

  // Update events to use the settled venue
  if (finalVenueId) {
    const { data: review } = await client
      .from('venue_review_queue')
      .select('source_event_ids')
      .eq('id', id)
      .single()

    if (review?.source_event_ids?.length) {
      await client
        .from('events')
        .update({ venue_id: finalVenueId })
        .in('id', review.source_event_ids)
    }
  }

  return { success: true }
}

/**
 * Approve a venue review (use the suggested match).
 */
export async function approveVenueReview(
  client: SupabaseClient,
  input: ApproveVenueReviewInput
): Promise<{ success: true }> {
  return settleReview(client, {
    ...input,
    finalVenueId: input.venueId,
    status: 'approved',
  })
}

/**
 * Reject a venue review (don't use this venue).
 */
export async function rejectVenueReview(
  client: SupabaseClient,
  input: VenueReviewInput
): Promise<{ success: true }> {
  return settleReview(client, {
    ...input,
    finalVenueId: null,
    status: 'rejected',
  })
}

/**
 * Merge a venue review into an existing venue.
 */
export async function mergeVenueReview(
  client: SupabaseClient,
  input: MergeVenueReviewInput
): Promise<{ success: true }> {
  return settleReview(client, {
    ...input,
    finalVenueId: input.targetVenueId,
    status: 'merged',
  })
}
