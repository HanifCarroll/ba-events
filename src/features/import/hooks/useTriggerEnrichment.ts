/**
 * Hook for triggering and monitoring event enrichment jobs via Trigger.dev
 *
 * Uses Trigger.dev's Realtime API for real-time progress updates.
 * Provides a better UX than polling with immediate feedback on job progress.
 */
import { useState, useCallback, useEffect } from 'react'
import { useRealtimeRun } from '@trigger.dev/react-hooks'
import { toast } from 'sonner'
import {
  triggerEventEnrichmentAction,
  getActiveEnrichmentJobAction,
} from '../api/trigger-enrichment'

// ============================================================================
// TYPES
// ============================================================================

export interface EnrichmentProgress {
  current: number
  total: number
  enriched: number
  failed: number
  currentEvent: string | null
}

export interface EnrichmentResult {
  total: number
  enriched: number
  skipped: number
  failed: number
}

export type EnrichmentStatus =
  | 'idle'
  | 'checking'
  | 'triggering'
  | 'running'
  | 'completed'
  | 'failed'

export interface TriggerEnrichmentState {
  status: EnrichmentStatus
  progress: EnrichmentProgress | null
  result: EnrichmentResult | null
  error: string | null
  runId: string | null
}

// ============================================================================
// HOOK
// ============================================================================

export function useTriggerEnrichment(options?: { onComplete?: () => void }) {
  // Local state for managing the enrichment flow
  const [runInfo, setRunInfo] = useState<{
    runId: string
    token: string
  } | null>(null)
  const [localStatus, setLocalStatus] = useState<EnrichmentStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const toastIdRef = useState<string | number | undefined>(undefined)

  // Trigger.dev Realtime subscription
  const {
    run,
    error: realtimeError,
  } = useRealtimeRun(runInfo?.runId ?? '', {
    accessToken: runInfo?.token ?? '',
    enabled: !!runInfo?.runId && !!runInfo?.token,
  })

  // Extract progress from run metadata
  const progress = run?.metadata?.progress as EnrichmentProgress | undefined

  // Extract result from run output when completed
  const result = run?.output as EnrichmentResult | undefined

  // Determine overall status based on run state and local state
  const status: EnrichmentStatus = (() => {
    if (localStatus === 'checking' || localStatus === 'triggering') {
      return localStatus
    }
    if (!run) {
      return localStatus
    }
    // Map Trigger.dev run statuses to our simplified status
    const runStatus = run.status
    if (runStatus === 'COMPLETED') {
      return 'completed'
    }
    if (
      runStatus === 'FAILED' ||
      runStatus === 'CRASHED' ||
      runStatus === 'SYSTEM_FAILURE' ||
      runStatus === 'CANCELED' ||
      runStatus === 'TIMED_OUT' ||
      runStatus === 'EXPIRED'
    ) {
      return 'failed'
    }
    // All other statuses (EXECUTING, QUEUED, WAITING, DELAYED, DEQUEUED, PENDING_VERSION) mean running
    if (runStatus) {
      return 'running'
    }
    return localStatus
  })()

  // Handle status changes for toasts
  useEffect(() => {
    if (status === 'completed' && run?.output) {
      const output = run.output as EnrichmentResult
      toast.success('Enrichment complete', {
        id: toastIdRef[0],
        description: `${output.enriched} enriched, ${output.failed} failed, ${output.skipped} skipped`,
      })
      toastIdRef[1](undefined)
      options?.onComplete?.()
    } else if (status === 'failed') {
      const errorMsg = realtimeError?.message || run?.error?.message || 'Unknown error'
      toast.error('Enrichment failed', {
        id: toastIdRef[0],
        description: errorMsg,
      })
      toastIdRef[1](undefined)
      setError(errorMsg)
    }
  }, [status, run?.output, run?.error, realtimeError, options])

  // Update toast with progress
  useEffect(() => {
    if (status === 'running' && progress && toastIdRef[0]) {
      const eventText = progress.currentEvent
        ? `Processing: ${progress.currentEvent.substring(0, 35)}${progress.currentEvent.length > 35 ? '...' : ''}`
        : 'Processing...'
      toast.loading(`Enriching events (${progress.current}/${progress.total})...`, {
        id: toastIdRef[0],
        description: eventText,
      })
    }
  }, [status, progress])

  /**
   * Check if there's an active enrichment job and resume subscription if so
   */
  const checkForActiveJob = useCallback(async () => {
    setLocalStatus('checking')
    try {
      const activeJob = await getActiveEnrichmentJobAction()
      if (activeJob) {
        // There's an active job - but we don't have the token to subscribe
        // User needs to wait or check Trigger.dev dashboard
        setError('An enrichment job is already running')
        setLocalStatus('running')
        return true
      }
      setLocalStatus('idle')
      return false
    } catch (err) {
      console.error('[useTriggerEnrichment] Failed to check for active job:', err)
      setLocalStatus('idle')
      return false
    }
  }, [])

  /**
   * Trigger a new enrichment job
   */
  const trigger = useCallback(async (opts?: { limit?: number; source?: string }) => {
    setError(null)
    setLocalStatus('triggering')

    const loadingToastId = toast.loading('Starting enrichment job...', {
      description: 'Connecting to Trigger.dev...',
    })
    toastIdRef[1](loadingToastId)

    try {
      const result = await triggerEventEnrichmentAction({
        data: {
          limit: opts?.limit ?? 200,
          source: opts?.source,
        },
      })

      // Set run info to start realtime subscription
      setRunInfo({
        runId: result.runId,
        token: result.publicAccessToken,
      })
      setLocalStatus('running')

      toast.loading(`Enriching ${result.pendingCount > 200 ? '200' : result.pendingCount} events...`, {
        id: loadingToastId,
        description: 'Job started, waiting for progress...',
      })
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to trigger enrichment'
      setError(errorMsg)
      setLocalStatus('failed')
      toast.error('Failed to start enrichment', {
        id: loadingToastId,
        description: errorMsg,
      })
      toastIdRef[1](undefined)
    }
  }, [])

  /**
   * Reset state to idle
   */
  const reset = useCallback(() => {
    setRunInfo(null)
    setLocalStatus('idle')
    setError(null)
  }, [])

  return {
    status,
    progress: progress ?? null,
    result: result ?? null,
    error: error || realtimeError?.message || null,
    runId: runInfo?.runId ?? null,
    trigger,
    reset,
    checkForActiveJob,
    isEnriching: status === 'running' || status === 'triggering' || status === 'checking',
  }
}

export type UseTriggerEnrichmentReturn = ReturnType<typeof useTriggerEnrichment>
