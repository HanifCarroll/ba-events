import { useState, useCallback, useRef } from 'react'
import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { enrichEventDescriptionsAction, type DescriptionEnrichComplete } from '../api/enrichment'
import type { EventWithVenue } from '@/shared/lib/types'

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
   * Streams real-time progress updates from the server
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

      // Prepare events for enrichment (include source for language hints and name for progress display)
      const eventsToEnrich = enrichableEvents.map((e) => ({
        id: e.id,
        link: e.link || '',
        source: e.source,
        name: e.name,
      }))

      // Show initial toast
      toastIdRef.current = toast.loading(
        `Adding descriptions to ${enrichableEvents.length} events...`,
        {
          description: 'Using AI to extract descriptions. Click stop to pause.',
        }
      )

      let totalEnriched = 0
      let wasStopped = false

      try {
        const stream = await enrichEventDescriptionsAction({
          data: { events: eventsToEnrich },
        })

        let finalResult: DescriptionEnrichComplete | null = null

        for await (const update of stream) {
          // Check if stopped
          if (shouldStopRef.current) {
            wasStopped = true
            break
          }

          if (update.type === 'progress') {
            // Update progress state
            setState((prev) => ({
              ...prev,
              current: update.current,
            }))

            // Update toast with progress
            toast.loading(
              `Adding descriptions (${update.current}/${update.total})...`,
              {
                id: toastIdRef.current,
                description: update.eventName
                  ? `Processing: ${update.eventName.substring(0, 40)}${update.eventName.length > 40 ? '...' : ''}`
                  : 'Processing...',
              }
            )

            if (update.success) {
              totalEnriched++
            }
          } else if (update.type === 'complete') {
            finalResult = update
          }
        }

        // If we broke out early due to stop, use current count
        if (!wasStopped && finalResult) {
          totalEnriched = finalResult.enriched
        }

        // Refresh UI to show new descriptions
        router.invalidate()

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
