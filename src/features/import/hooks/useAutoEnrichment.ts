import { useState, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import { useInvalidateCache } from '@/shared/hooks/useInvalidateCache'
import { enrichEventDescriptionsAction } from '@/features/events/api/enrichment'
import { enrichVenuesWithNominatimAction } from '@/features/venues/api/enrichment'
import type {
  DescriptionEnrichProgress,
  DescriptionEnrichComplete,
} from '@/features/events/api/streaming-types'
import type {
  NominatimEnrichProgress,
  NominatimEnrichComplete,
} from '@/shared/lib/streaming-types'

// ============================================================================
// TYPES
// ============================================================================

export interface AutoEnrichmentState {
  phase: 'idle' | 'events' | 'venues' | 'complete'
  eventProgress: { current: number; total: number } | null
  venueProgress: { current: number; total: number } | null
  eventResult: { enriched: number; failed: number } | null
  venueResult: { enriched: number; failed: number } | null
}

export interface EventToEnrich {
  id: string
  name: string
  link: string
  source: string
}

export interface VenueToEnrich {
  venueId: string
  venueName: string
}

interface UseAutoEnrichmentOptions {
  onComplete?: () => void
}

// ============================================================================
// INITIAL STATE
// ============================================================================

const initialState: AutoEnrichmentState = {
  phase: 'idle',
  eventProgress: null,
  venueProgress: null,
  eventResult: null,
  venueResult: null,
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook for orchestrating automatic enrichment of both events and venues.
 * Runs event description enrichment first, then venue Nominatim enrichment.
 *
 * Used by:
 * - Import wizard (auto-enrichment after import)
 * - Events admin (backfill enrichment)
 */
export function useAutoEnrichment(options?: UseAutoEnrichmentOptions) {
  const { invalidateAll } = useInvalidateCache()
  const [state, setState] = useState<AutoEnrichmentState>(initialState)
  const shouldStopRef = useRef(false)
  const toastIdRef = useRef<string | number | undefined>(undefined)

  /**
   * Stop enrichment after current item completes
   */
  const stop = useCallback(() => {
    shouldStopRef.current = true
  }, [])

  /**
   * Reset state to initial values
   */
  const reset = useCallback(() => {
    setState(initialState)
    shouldStopRef.current = false
    toastIdRef.current = undefined
  }, [])

  /**
   * Process event description enrichment stream
   */
  const processEventStream = useCallback(
    async (events: EventToEnrich[]): Promise<{ enriched: number; failed: number }> => {
      if (events.length === 0) {
        return { enriched: 0, failed: 0 }
      }

      setState((prev) => ({
        ...prev,
        phase: 'events',
        eventProgress: { current: 0, total: events.length },
        eventResult: { enriched: 0, failed: 0 },
      }))

      toastIdRef.current = toast.loading(
        `Enriching ${events.length} event descriptions...`,
        { description: 'This may take a few minutes' }
      )

      let enriched = 0
      let failed = 0

      try {
        const stream = await enrichEventDescriptionsAction({
          data: {
            events: events.map((e) => ({
              id: e.id,
              link: e.link,
              source: e.source,
              name: e.name,
            })),
          },
        })

        for await (const update of stream) {
          if (shouldStopRef.current) {
            break
          }

          if (update.type === 'progress') {
            const progress = update as DescriptionEnrichProgress

            // Track enriched/failed incrementally based on success field
            if (progress.success) {
              enriched++
            } else {
              failed++
            }

            setState((prev) => ({
              ...prev,
              eventProgress: { current: progress.current, total: progress.total },
              eventResult: { enriched, failed },
            }))

            toast.loading(`Enriching events (${progress.current}/${progress.total})...`, {
              id: toastIdRef.current,
              description: progress.eventName
                ? `Processing: ${progress.eventName.substring(0, 40)}${progress.eventName.length > 40 ? '...' : ''}`
                : 'Processing...',
            })
          } else {
            // Complete message - use final counts from server
            const complete = update as DescriptionEnrichComplete
            enriched = complete.enriched
            failed = complete.total - complete.enriched
          }
        }
      } catch (error) {
        console.error('[auto-enrichment] Event enrichment failed:', error)
        toast.error('Event enrichment failed', {
          id: toastIdRef.current,
          description: error instanceof Error ? error.message : 'Unknown error',
        })
        toastIdRef.current = undefined
      }

      return { enriched, failed }
    },
    []
  )

  /**
   * Process venue Nominatim enrichment stream
   */
  const processVenueStream = useCallback(
    async (venues: VenueToEnrich[]): Promise<{ enriched: number; failed: number }> => {
      if (venues.length === 0) {
        return { enriched: 0, failed: 0 }
      }

      setState((prev) => ({
        ...prev,
        phase: 'venues',
        venueProgress: { current: 0, total: venues.length },
        venueResult: { enriched: 0, failed: 0 },
      }))

      // Update or create toast
      if (toastIdRef.current) {
        toast.loading(`Enriching ${venues.length} venues...`, {
          id: toastIdRef.current,
          description: 'Looking up addresses on OpenStreetMap',
        })
      } else {
        toastIdRef.current = toast.loading(`Enriching ${venues.length} venues...`, {
          description: 'Looking up addresses on OpenStreetMap',
        })
      }

      let enriched = 0
      let failed = 0

      try {
        const stream = await enrichVenuesWithNominatimAction({
          data: { venues },
        })

        for await (const update of stream) {
          if (shouldStopRef.current) {
            break
          }

          if (update.type === 'progress') {
            const progress = update as NominatimEnrichProgress

            // Track enriched/failed incrementally based on success field
            if (progress.success) {
              enriched++
            } else {
              failed++
            }

            setState((prev) => ({
              ...prev,
              venueProgress: { current: progress.current, total: progress.total },
              venueResult: { enriched, failed },
            }))

            toast.loading(`Enriching venues (${progress.current}/${progress.total})...`, {
              id: toastIdRef.current,
              description: progress.venueName
                ? `Processing: ${progress.venueName.substring(0, 40)}${progress.venueName.length > 40 ? '...' : ''}`
                : 'Processing...',
            })
          } else {
            // Complete message - use final counts from server
            const complete = update as NominatimEnrichComplete
            enriched = complete.enriched
            failed = complete.total - complete.enriched
          }
        }
      } catch (error) {
        console.error('[auto-enrichment] Venue enrichment failed:', error)
        toast.error('Venue enrichment failed', {
          id: toastIdRef.current,
          description: error instanceof Error ? error.message : 'Unknown error',
        })
        toastIdRef.current = undefined
      }

      return { enriched, failed }
    },
    []
  )

  /**
   * Start enrichment for events and venues.
   * Runs event enrichment first, then venue enrichment.
   */
  const startEnrichment = useCallback(
    async (events: EventToEnrich[], venues: VenueToEnrich[]) => {
      // Reset stop flag
      shouldStopRef.current = false

      // Skip if nothing to enrich
      if (events.length === 0 && venues.length === 0) {
        toast.info('Nothing to enrich', {
          description: 'All records are already enriched',
        })
        return
      }

      // Phase 1: Event enrichment
      const eventResult = await processEventStream(events)
      setState((prev) => ({ ...prev, eventResult }))

      // Check if stopped
      if (shouldStopRef.current) {
        setState((prev) => ({ ...prev, phase: 'complete' }))
        toast.warning('Enrichment stopped', {
          id: toastIdRef.current,
          description: `Events: ${eventResult.enriched} enriched`,
        })
        toastIdRef.current = undefined
        await invalidateAll()
        options?.onComplete?.()
        return
      }

      // Phase 2: Venue enrichment
      const venueResult = await processVenueStream(venues)
      setState((prev) => ({ ...prev, venueResult, phase: 'complete' }))

      // Final toast
      const totalEnriched = eventResult.enriched + venueResult.enriched
      const totalFailed = eventResult.failed + venueResult.failed

      if (totalEnriched === 0 && totalFailed > 0) {
        toast.error('Enrichment failed', {
          id: toastIdRef.current,
          description: `No records were enriched. ${totalFailed} failed.`,
        })
      } else if (shouldStopRef.current) {
        toast.warning('Enrichment stopped', {
          id: toastIdRef.current,
          description: `Events: ${eventResult.enriched}, Venues: ${venueResult.enriched}`,
        })
      } else {
        toast.success('Enrichment complete', {
          id: toastIdRef.current,
          description: `Events: ${eventResult.enriched}, Venues: ${venueResult.enriched}`,
        })
      }

      toastIdRef.current = undefined
      await invalidateAll()
      options?.onComplete?.()
    },
    [processEventStream, processVenueStream, invalidateAll, options]
  )

  /**
   * Start enrichment for events only (for backfill)
   */
  const startEventEnrichment = useCallback(
    async (events: EventToEnrich[]) => {
      shouldStopRef.current = false
      const eventResult = await processEventStream(events)
      setState((prev) => ({ ...prev, eventResult, phase: 'complete' }))

      if (eventResult.enriched > 0) {
        toast.success(`Enriched ${eventResult.enriched} events`, {
          id: toastIdRef.current,
        })
      } else {
        toast.error('No events enriched', {
          id: toastIdRef.current,
          description: `${eventResult.failed} failed`,
        })
      }

      toastIdRef.current = undefined
      await invalidateAll()
      options?.onComplete?.()
    },
    [processEventStream, invalidateAll, options]
  )

  /**
   * Start enrichment for venues only (for backfill)
   */
  const startVenueEnrichment = useCallback(
    async (venues: VenueToEnrich[]) => {
      shouldStopRef.current = false
      const venueResult = await processVenueStream(venues)
      setState((prev) => ({ ...prev, venueResult, phase: 'complete' }))

      if (venueResult.enriched > 0) {
        toast.success(`Enriched ${venueResult.enriched} venues`, {
          id: toastIdRef.current,
        })
      } else {
        toast.error('No venues enriched', {
          id: toastIdRef.current,
          description: `${venueResult.failed} failed`,
        })
      }

      toastIdRef.current = undefined
      await invalidateAll()
      options?.onComplete?.()
    },
    [processVenueStream, invalidateAll, options]
  )

  return {
    state,
    startEnrichment,
    startEventEnrichment,
    startVenueEnrichment,
    stop,
    reset,
    isEnriching: state.phase !== 'idle' && state.phase !== 'complete',
  }
}

export type UseAutoEnrichmentReturn = ReturnType<typeof useAutoEnrichment>
