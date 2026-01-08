/**
 * Server functions for scrape runs monitoring and management
 */

import { createServerFn } from '@tanstack/react-start'
import { requireAdminAccess } from '@/shared/lib/admin-utils'
import { createSupabaseServerClient } from '@/shared/lib/db/server'
import type {
  ScrapeRun,
  ScrapeRunSource,
  VenueReviewQueueWithDetails,
  VenueReviewStatus,
} from '@/shared/lib/types'

// ============================================================================
// Scrape Runs
// ============================================================================

/**
 * List recent scrape runs with optional filtering
 */
export const listScrapeRunsAction = createServerFn({ method: 'GET' })
  .inputValidator(
    (params?: { source?: ScrapeRunSource; limit?: number; offset?: number }) => params ?? {}
  )
  .handler(async ({ data }) => {
    // Admin only - scrape runs are sensitive
    await requireAdminAccess()
    const client = createSupabaseServerClient()
    const { source, limit = 50, offset = 0 } = data

    let query = client
      .from('scrape_runs')
      .select('*', { count: 'exact' })
      .order('started_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (source) {
      query = query.eq('source', source)
    }

    const { data: runs, error, count } = await query

    if (error) throw new Error(error.message)

    return {
      runs: runs as ScrapeRun[],
      total: count ?? 0,
    }
  })

/**
 * Get a single scrape run by ID
 */
export const getScrapeRunAction = createServerFn({ method: 'GET' })
  .inputValidator((id: string) => id)
  .handler(async ({ data: id }) => {
    await requireAdminAccess()
    const client = createSupabaseServerClient()

    const { data: run, error } = await client
      .from('scrape_runs')
      .select('*')
      .eq('id', id)
      .single()

    if (error) throw new Error(error.message)

    return run as ScrapeRun
  })

/**
 * Get latest run for each source
 */
export const getLatestScrapeRunsAction = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAdminAccess()
  const client = createSupabaseServerClient()
  const sources: ScrapeRunSource[] = ['passline', 'eventbrite', 'ba-tourism', 'meetup', 'luma']

  const latestRuns: Record<string, ScrapeRun | null> = {}

  // Get latest run for each source
  await Promise.all(
    sources.map(async (source) => {
      const { data } = await client
        .from('scrape_runs')
        .select('*')
        .eq('source', source)
        .order('started_at', { ascending: false })
        .limit(1)
        .single()

      latestRuns[source] = data as ScrapeRun | null
    })
  )

  // Get latest "all" run (daily orchestrator)
  const { data: allRun } = await client
    .from('scrape_runs')
    .select('*')
    .eq('source', 'all')
    .order('started_at', { ascending: false })
    .limit(1)
    .single()

  latestRuns['all'] = allRun as ScrapeRun | null

  return latestRuns
})

/**
 * Get aggregated stats for scrape runs
 */
export const getScrapeStatsAction = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAdminAccess()
  const client = createSupabaseServerClient()

  // Get stats for the last 7 days
  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

  const { data: runs } = await client
    .from('scrape_runs')
    .select('*')
    .gte('started_at', sevenDaysAgo.toISOString())

  const stats = {
    totalRuns: runs?.length ?? 0,
    successfulRuns: runs?.filter((r) => r.status === 'completed').length ?? 0,
    failedRuns: runs?.filter((r) => r.status === 'failed').length ?? 0,
    partialRuns: runs?.filter((r) => r.status === 'partial').length ?? 0,
    totalEventsInserted: runs?.reduce((sum, r) => sum + (r.events_inserted ?? 0), 0) ?? 0,
    totalEventsUpdated: runs?.reduce((sum, r) => sum + (r.events_updated ?? 0), 0) ?? 0,
    totalVenuesCreated: runs?.reduce((sum, r) => sum + (r.venues_auto_created ?? 0), 0) ?? 0,
    totalVenuesQueued: runs?.reduce((sum, r) => sum + (r.venues_queued_review ?? 0), 0) ?? 0,
  }

  return stats
})

// ============================================================================
// Venue Review Queue
// ============================================================================

/**
 * List venue review queue entries
 */
export const listVenueReviewQueueAction = createServerFn({ method: 'GET' })
  .inputValidator(
    (params?: { status?: VenueReviewStatus; limit?: number; offset?: number }) => params ?? {}
  )
  .handler(async ({ data }) => {
    const client = await requireAdminAccess()
    const { status, limit = 50, offset = 0 } = data

    // Build query with joins for venue names
    let query = client
      .from('venue_review_queue')
      .select(
        `
        *,
        best_match_venue:venues!venue_review_queue_best_match_venue_id_fkey(name),
        final_venue:venues!venue_review_queue_final_venue_id_fkey(name),
        reviewer:profiles!venue_review_queue_reviewed_by_fkey(email)
      `,
        { count: 'exact' }
      )
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (status) {
      query = query.eq('status', status)
    }

    const { data: entries, error, count } = await query

    if (error) throw new Error(error.message)

    // Transform to VenueReviewQueueWithDetails
    const transformed: VenueReviewQueueWithDetails[] = (entries ?? []).map((entry) => ({
      id: entry.id,
      scrape_run_id: entry.scrape_run_id,
      source: entry.source,
      source_venue_name: entry.source_venue_name,
      source_address: entry.source_address,
      source_coordinates: entry.source_coordinates,
      source_event_ids: entry.source_event_ids,
      best_match_venue_id: entry.best_match_venue_id,
      match_confidence: entry.match_confidence,
      status: entry.status,
      reviewed_at: entry.reviewed_at,
      reviewed_by: entry.reviewed_by,
      final_venue_id: entry.final_venue_id,
      notes: entry.notes,
      created_at: entry.created_at,
      updated_at: entry.updated_at,
      best_match_venue_name: (entry.best_match_venue as { name: string } | null)?.name ?? null,
      final_venue_name: (entry.final_venue as { name: string } | null)?.name ?? null,
      reviewed_by_email: (entry.reviewer as { email: string } | null)?.email ?? null,
    }))

    return {
      entries: transformed,
      total: count ?? 0,
    }
  })

/**
 * Get count of pending venue reviews
 */
export const getVenueReviewCountAction = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAdminAccess()
  const client = createSupabaseServerClient()

  const { count } = await client
    .from('venue_review_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending')

  return count ?? 0
})

/**
 * Approve a venue review (use suggested match)
 */
export const approveVenueReviewAction = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: string; venueId: string; notes?: string }) => input)
  .handler(async ({ data: { id, venueId, notes } }) => {
    const client = await requireAdminAccess()

    const {
      data: { user },
    } = await client.auth.getUser()

    const { error } = await client
      .from('venue_review_queue')
      .update({
        status: 'approved',
        final_venue_id: venueId,
        reviewed_at: new Date().toISOString(),
        reviewed_by: user?.id,
        notes,
      })
      .eq('id', id)

    if (error) throw new Error(error.message)

    // Update events to use this venue
    const { data: review } = await client
      .from('venue_review_queue')
      .select('source_event_ids')
      .eq('id', id)
      .single()

    if (review?.source_event_ids?.length) {
      await client
        .from('events')
        .update({ venue_id: venueId })
        .in('id', review.source_event_ids)
    }

    return { success: true }
  })

/**
 * Reject a venue review (don't use this venue)
 */
export const rejectVenueReviewAction = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: string; notes?: string }) => input)
  .handler(async ({ data: { id, notes } }) => {
    const client = await requireAdminAccess()

    const {
      data: { user },
    } = await client.auth.getUser()

    const { error } = await client
      .from('venue_review_queue')
      .update({
        status: 'rejected',
        reviewed_at: new Date().toISOString(),
        reviewed_by: user?.id,
        notes,
      })
      .eq('id', id)

    if (error) throw new Error(error.message)

    return { success: true }
  })

/**
 * Merge venue review into existing venue
 */
export const mergeVenueReviewAction = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: string; targetVenueId: string; notes?: string }) => input)
  .handler(async ({ data: { id, targetVenueId, notes } }) => {
    const client = await requireAdminAccess()

    const {
      data: { user },
    } = await client.auth.getUser()

    const { error } = await client
      .from('venue_review_queue')
      .update({
        status: 'merged',
        final_venue_id: targetVenueId,
        reviewed_at: new Date().toISOString(),
        reviewed_by: user?.id,
        notes,
      })
      .eq('id', id)

    if (error) throw new Error(error.message)

    // Update events to use the target venue
    const { data: review } = await client
      .from('venue_review_queue')
      .select('source_event_ids')
      .eq('id', id)
      .single()

    if (review?.source_event_ids?.length) {
      await client
        .from('events')
        .update({ venue_id: targetVenueId })
        .in('id', review.source_event_ids)
    }

    return { success: true }
  })
