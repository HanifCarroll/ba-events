import { useCallback, useRef } from 'react'
import { toast } from 'sonner'
import { useInvalidateCache } from '@/shared/hooks/useInvalidateCache'
import { useStreamingProgress } from '@/shared/hooks/useStreamingProgress'
import {
  enrichEventDescriptionsAction,
  type DescriptionEnrichComplete,
} from '../api/enrichment'
import type { DescriptionEnrichProgress } from '../api/streaming-types'
import type { EventWithVenue } from '@/shared/lib/types'

export function useBackgroundEnrichment() {
  const { invalidateEvents } = useInvalidateCache()

  // Keep track of the current toast ID so we can update it
  const toastIdRef = useRef<string | number | undefined>(undefined)
  const totalEnrichedRef = useRef(0)
  const totalToProcessRef = useRef(0)

  const { state, processStream, stop } = useStreamingProgress<
    DescriptionEnrichProgress,
    DescriptionEnrichComplete
  >({
    onProgress: (update) => {
      // Update toast with progress
      toast.loading(`Adding descriptions (${update.current}/${update.total})...`, {
        id: toastIdRef.current,
        description: update.eventName
          ? `Processing: ${update.eventName.substring(0, 40)}${update.eventName.length > 40 ? '...' : ''}`
          : 'Processing...',
      })

      if (update.success) {
        totalEnrichedRef.current++
      }
    },
    onComplete: (result) => {
      totalEnrichedRef.current = result.enriched

      // Refresh UI to show new descriptions
      invalidateEvents()

      // Final toast
      if (result.enriched === 0) {
        toast.error('No descriptions added', {
          id: toastIdRef.current,
          description: 'Could not extract descriptions from any event pages.',
        })
      } else {
        toast.success(`Added descriptions to ${result.enriched} events`, {
          id: toastIdRef.current,
          description: `${result.enriched} of ${result.total} events now have AI-generated descriptions.`,
        })
      }
    },
    onError: (error) => {
      console.error('Failed to add descriptions:', error)
      toast.error('Failed to add descriptions', {
        id: toastIdRef.current,
        description: error.message || 'An unexpected error occurred.',
      })
    },
    onStop: () => {
      // Refresh UI to show new descriptions
      invalidateEvents()

      toast.warning(`Stopped adding descriptions`, {
        id: toastIdRef.current,
        description: `Added descriptions to ${totalEnrichedRef.current} of ${totalToProcessRef.current} events. Click Add Descriptions again to continue.`,
      })
    },
    getCurrentFromProgress: (p) => p.current,
    getTotalFromProgress: (p) => p.total,
  })

  /**
   * Check if an event can be enriched (enrichment_status is 'pending' and has a link)
   */
  const canEnrichEvent = useCallback((event: EventWithVenue) => {
    return event.enrichment_status === 'pending' && !!event.link
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

      // Reset counters
      totalEnrichedRef.current = 0
      totalToProcessRef.current = enrichableEvents.length

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

      try {
        const stream = await enrichEventDescriptionsAction({
          data: { events: eventsToEnrich },
        })

        await processStream(
          stream,
          (update): update is DescriptionEnrichProgress => update.type === 'progress'
        )

        // Call completion callback
        onComplete?.()
      } finally {
        toastIdRef.current = undefined
      }
    },
    [getEnrichableEvents, processStream]
  )

  return {
    isEnriching: state.isProcessing,
    enrichProgress: {
      isEnriching: state.isProcessing,
      current: state.current,
      total: state.total,
    },
    canEnrichEvent,
    getEnrichableEvents,
    enrichEvents,
    stopEnrichment: stop,
  }
}

export type UseBackgroundEnrichmentReturn = ReturnType<typeof useBackgroundEnrichment>
