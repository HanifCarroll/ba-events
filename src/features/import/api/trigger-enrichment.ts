/**
 * Server functions for triggering and managing enrichment jobs via Trigger.dev
 *
 * These functions allow the admin UI to trigger background enrichment jobs
 * and get real-time progress updates via Trigger.dev's Realtime API.
 */
import { createServerFn } from '@tanstack/react-start'
import { tasks, runs } from '@trigger.dev/sdk/v3'
import { requireAdminAccess } from '@/shared/lib/admin-utils'
import { supabase } from '@/shared/lib/db/client'
import type { enrichEventsJob } from '@/trigger/jobs/enrich-events'

// ============================================================================
// TYPES
// ============================================================================

export interface TriggerEnrichmentResult {
  runId: string
  publicAccessToken: string
  pendingCount: number
}

export interface EnrichmentJobStatus {
  status: 'PENDING' | 'EXECUTING' | 'COMPLETED' | 'FAILED' | 'CANCELED' | 'UNKNOWN'
  output?: {
    total: number
    enriched: number
    skipped: number
    failed: number
  }
  error?: string
  startedAt?: string
  finishedAt?: string
}

export interface ActiveEnrichmentJob {
  runId: string
  startedAt: string
}

// ============================================================================
// SERVER FUNCTIONS
// ============================================================================

/**
 * Trigger an event enrichment job via Trigger.dev.
 * Returns the run ID and public access token for frontend subscription.
 */
export const triggerEventEnrichmentAction = createServerFn({ method: 'POST' })
  .inputValidator((data: { limit?: number; source?: string }) => data)
  .handler(async ({ data }): Promise<TriggerEnrichmentResult> => {
    await requireAdminAccess()

    // Check if there's already a running enrichment job
    const existingJob = await getActiveEnrichmentJob()
    if (existingJob) {
      throw new Error('An enrichment job is already running. Please wait for it to complete.')
    }

    // Get count of pending events for UI display
    const { count: pendingCount } = await supabase
      .from('events')
      .select('*', { count: 'exact', head: true })
      .eq('enrichment_status', 'pending')
      .not('link', 'is', null)

    const limit = data.limit ?? 200 // Default to 200 for backfill

    console.log(`[trigger-enrichment] Triggering enrichment job with limit: ${limit}`)

    // Trigger the enrichment job
    const handle = await tasks.trigger<typeof enrichEventsJob>('enrich-events', {
      limit,
      source: data.source,
    })

    console.log(`[trigger-enrichment] Job triggered: ${handle.id}`)

    return {
      runId: handle.id,
      publicAccessToken: handle.publicAccessToken,
      pendingCount: pendingCount ?? 0,
    }
  })

/**
 * Get the status of an enrichment job by run ID.
 * Uses Trigger.dev's runs.retrieve() to get current status.
 */
export const getEnrichmentJobStatusAction = createServerFn({ method: 'GET' })
  .inputValidator((data: { runId: string }) => data)
  .handler(async ({ data }): Promise<EnrichmentJobStatus> => {
    await requireAdminAccess()

    try {
      const run = await runs.retrieve(data.runId)

      return {
        status: run.status as EnrichmentJobStatus['status'],
        output: run.output as EnrichmentJobStatus['output'],
        error: run.error?.message,
        startedAt: run.startedAt?.toISOString(),
        finishedAt: run.finishedAt?.toISOString(),
      }
    } catch (error) {
      console.error(`[trigger-enrichment] Failed to get job status: ${error}`)
      return {
        status: 'UNKNOWN',
        error: error instanceof Error ? error.message : 'Failed to retrieve job status',
      }
    }
  })

/**
 * Check if there's an active (running) enrichment job.
 * This prevents triggering multiple concurrent enrichment jobs.
 */
async function getActiveEnrichmentJob(): Promise<ActiveEnrichmentJob | null> {
  // Query recent runs from Trigger.dev that might still be running
  try {
    const recentRuns = await runs.list({
      status: ['EXECUTING', 'QUEUED', 'WAITING'],
      taskIdentifier: ['enrich-events'],
      limit: 1,
    })

    if (recentRuns.data.length > 0) {
      const activeRun = recentRuns.data[0]
      return {
        runId: activeRun.id,
        startedAt: activeRun.startedAt?.toISOString() ?? activeRun.createdAt.toISOString(),
      }
    }

    return null
  } catch (error) {
    console.error('[trigger-enrichment] Failed to check for active jobs:', error)
    // If we can't check, assume no active job (better to allow triggering than block)
    return null
  }
}

/**
 * Get active enrichment job (for UI to check if one is already running).
 */
export const getActiveEnrichmentJobAction = createServerFn({ method: 'GET' })
  .handler(async (): Promise<ActiveEnrichmentJob | null> => {
    await requireAdminAccess()
    return getActiveEnrichmentJob()
  })
