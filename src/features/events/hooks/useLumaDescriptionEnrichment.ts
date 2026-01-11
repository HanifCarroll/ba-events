import { useCallback, useRef } from 'react'
import { toast } from 'sonner'
import { useInvalidateCache } from '@/shared/hooks/useInvalidateCache'
import { useStreamingProgress } from '@/shared/hooks/useStreamingProgress'
import { enrichLumaDescriptionsAction } from '@/features/import'
import type { DescriptionEnrichProgress, DescriptionEnrichComplete } from '@/shared/lib/streaming-types'
import type { EventWithVenue } from '@/shared/lib/types'

/**
 * Hook for enriching Luma events with descriptions fetched from their event pages.
 * Uses Playwright to scrape the actual description from each Luma event page.
 */
export function useLumaDescriptionEnrichment() {
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
      toast.loading(`Fetching Luma descriptions (${update.current}/${update.total})...`, {
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
        toast.error('No Luma descriptions added', {
          id: toastIdRef.current,
          description: 'Could not extract descriptions from any Luma event pages.',
        })
      } else {
        toast.success(`Added descriptions to ${result.enriched} Luma events`, {
          id: toastIdRef.current,
          description: `${result.enriched} of ${result.total} events now have descriptions from Luma.`,
        })
      }
    },
    onError: (error) => {
      console.error('Failed to add Luma descriptions:', error)
      toast.error('Failed to add Luma descriptions', {
        id: toastIdRef.current,
        description: error.message || 'An unexpected error occurred.',
      })
    },
    onStop: () => {
      // Refresh UI to show new descriptions
      invalidateEvents()

      toast.warning(`Stopped adding Luma descriptions`, {
        id: toastIdRef.current,
        description: `Added descriptions to ${totalEnrichedRef.current} of ${totalToProcessRef.current} events.`,
      })
    },
    getCurrentFromProgress: (p) => p.current,
    getTotalFromProgress: (p) => p.total,
  })

  /**
   * Check if an event is a Luma event that can be enriched.
   * Allows both 'pending' (never enriched) and 'failed' (retry) events.
   */
  const canEnrichEvent = useCallback((event: EventWithVenue) => {
    const canEnrich =
      event.enrichment_status === 'pending' || event.enrichment_status === 'failed'
    return event.source === 'luma' && canEnrich && !!event.link
  }, [])

  /**
   * Get Luma events that can be enriched from a selection
   */
  const getLumaEnrichableEvents = useCallback(
    (events: EventWithVenue[], selectedIds: Set<string>) => {
      return events.filter((e) => selectedIds.has(e.id) && canEnrichEvent(e))
    },
    [canEnrichEvent]
  )

  /**
   * Enrich selected Luma events with descriptions from their event pages
   * Streams real-time progress updates from the server
   */
  const enrichLumaEvents = useCallback(
    async (
      events: EventWithVenue[],
      selectedIds: Set<string>,
      onComplete?: () => void
    ) => {
      const enrichableEvents = getLumaEnrichableEvents(events, selectedIds)

      if (enrichableEvents.length === 0) {
        toast.info('No Luma events need descriptions', {
          description:
            'Selected Luma events either have descriptions or no source URLs.',
        })
        return
      }

      // Reset counters
      totalEnrichedRef.current = 0
      totalToProcessRef.current = enrichableEvents.length

      // Prepare events for enrichment
      const eventsToEnrich = enrichableEvents.map((e) => ({
        eventId: e.id,
        source_url: e.link || '',
        name: e.name,
      }))

      // Show initial toast
      toastIdRef.current = toast.loading(
        `Fetching descriptions for ${enrichableEvents.length} Luma events...`,
        {
          description: 'Visiting each event page to extract the full description.',
        }
      )

      try {
        const stream = await enrichLumaDescriptionsAction({
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
    [getLumaEnrichableEvents, processStream]
  )

  return {
    isLumaEnriching: state.isProcessing,
    lumaEnrichProgress: {
      isEnriching: state.isProcessing,
      current: state.current,
      total: state.total,
    },
    canEnrichLumaEvent: canEnrichEvent,
    getLumaEnrichableEvents,
    enrichLumaEvents,
    stopLumaEnrichment: stop,
  }
}

export type UseLumaDescriptionEnrichmentReturn = ReturnType<typeof useLumaDescriptionEnrichment>
