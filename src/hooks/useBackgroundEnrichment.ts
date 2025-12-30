import { useState, useCallback, useRef } from 'react'
import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { enrichEventDescriptionsAction } from '@/lib/admin'
import type { EventWithVenue } from '@/lib/types'

const BATCH_SIZE = 3

interface EnrichmentState {
  isEnriching: boolean
  current: number
  total: number
}

export function useBackgroundEnrichment() {
  const router = useRouter()
  const [state, setState] = useState<EnrichmentState>({
    isEnriching: false,
    current: 0,
    total: 0,
  })

  // Keep track of the current toast ID so we can update it
  const toastIdRef = useRef<string | number | undefined>(undefined)

  // Signal to stop enrichment between batches
  const shouldStopRef = useRef(false)

  /**
   * Check if an event can be enriched (missing description but has a link)
   */
  const canEnrichEvent = useCallback((event: EventWithVenue) => {
    return !event.description_es && !!event.link
  }, [])

  /**
   * Get enrichable events from a selection
   */
  const getEnrichableEvents = useCallback(
    (events: EventWithVenue[], selectedIds: Set<string>) => {
      return events.filter((e) => selectedIds.has(e.id) && canEnrichEvent(e))
    },
    [canEnrichEvent]
  )

  /**
   * Stop the current enrichment process (will stop after current batch completes)
   */
  const stopEnrichment = useCallback(() => {
    shouldStopRef.current = true
  }, [])

  /**
   * Enrich selected events using Jina Reader + Haiku 4.5
   * Processes in batches with progress updates and stop capability
   */
  const enrichEvents = useCallback(
    async (
      events: EventWithVenue[],
      selectedIds: Set<string>,
      onComplete?: () => void
    ) => {
      const enrichableEvents = getEnrichableEvents(events, selectedIds)

      if (enrichableEvents.length === 0) {
        toast.info('No events need descriptions', {
          description:
            'Selected events either have descriptions or no links to fetch from.',
        })
        return
      }

      // Reset stop signal
      shouldStopRef.current = false

      setState({
        isEnriching: true,
        current: 0,
        total: enrichableEvents.length,
      })

      // Prepare events for enrichment
      const eventsToEnrich = enrichableEvents.map((e) => ({
        id: e.id,
        link: e.link || '',
      }))

      // Show initial toast
      toastIdRef.current = toast.loading(
        `Adding descriptions to ${enrichableEvents.length} events...`,
        {
          description: 'Using AI to extract descriptions. Click stop to pause.',
        }
      )

      let totalEnriched = 0
      let processed = 0
      let wasStopped = false

      try {
        // Process in batches
        for (let i = 0; i < eventsToEnrich.length; i += BATCH_SIZE) {
          // Check if stopped
          if (shouldStopRef.current) {
            wasStopped = true
            break
          }

          const batch = eventsToEnrich.slice(i, i + BATCH_SIZE)

          // Update toast with progress
          toast.loading(
            `Adding descriptions (${processed}/${eventsToEnrich.length})...`,
            {
              id: toastIdRef.current,
              description: `Processing batch ${Math.floor(i / BATCH_SIZE) + 1}. Click stop to pause.`,
            }
          )

          // Enrich this batch
          const result = await enrichEventDescriptionsAction({
            data: { events: batch },
          })

          totalEnriched += result.enriched
          processed += batch.length

          // Update progress state
          setState((prev) => ({
            ...prev,
            current: processed,
          }))

          // Refresh UI to show new descriptions immediately
          router.invalidate()
        }

        // Final toast
        if (wasStopped) {
          toast.warning(`Stopped adding descriptions`, {
            id: toastIdRef.current,
            description: `Added descriptions to ${totalEnriched} of ${eventsToEnrich.length} events. Click Add Descriptions again to continue.`,
          })
        } else if (totalEnriched === 0) {
          toast.error('No descriptions added', {
            id: toastIdRef.current,
            description:
              'Could not extract descriptions from any event pages.',
          })
        } else {
          toast.success(`Added descriptions to ${totalEnriched} events`, {
            id: toastIdRef.current,
            description: `${totalEnriched} of ${eventsToEnrich.length} events now have AI-generated descriptions.`,
          })
        }

        // Call completion callback
        onComplete?.()
      } catch (error) {
        console.error('Failed to add descriptions:', error)
        toast.error('Failed to add descriptions', {
          id: toastIdRef.current,
          description:
            error instanceof Error
              ? error.message
              : 'An unexpected error occurred.',
        })
      } finally {
        setState({ isEnriching: false, current: 0, total: 0 })
        toastIdRef.current = undefined
        shouldStopRef.current = false
      }
    },
    [getEnrichableEvents, router]
  )

  return {
    isEnriching: state.isEnriching,
    enrichProgress: state,
    canEnrichEvent,
    getEnrichableEvents,
    enrichEvents,
    stopEnrichment,
  }
}

export type UseBackgroundEnrichmentReturn = ReturnType<
  typeof useBackgroundEnrichment
>
