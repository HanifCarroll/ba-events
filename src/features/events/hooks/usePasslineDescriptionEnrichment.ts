import { useCallback, useRef } from 'react'
import { toast } from 'sonner'
import { useInvalidateCache } from '@/shared/hooks/useInvalidateCache'
import { useStreamingProgress } from '@/shared/hooks/useStreamingProgress'
import { enrichPasslineDescriptionsWithPlaywrightAction } from '../api/enrichment'
import type {
  PasslineDescriptionEnrichProgress,
  PasslineDescriptionEnrichComplete,
} from '@/shared/lib/streaming-types'
import type { EventWithVenue } from '@/shared/lib/types'

/**
 * Hook for enriching Passline events with descriptions using Playwright.
 *
 * Uses server-side Playwright/Browserless to:
 * 1. Visit each Passline event page (bypasses CORS and Cloudflare)
 * 2. Extract description from JSON-LD
 * 3. Translate Spanish description to English
 * 4. Generate embedding and save to database
 *
 * Use the "Add Descriptions" button to trigger this enrichment.
 */
export function usePasslineDescriptionEnrichment() {
  const { invalidateEvents } = useInvalidateCache()

  // Keep track of the current toast ID so we can update it
  const toastIdRef = useRef<string | number | undefined>(undefined)
  const totalEnrichedRef = useRef(0)
  const totalToProcessRef = useRef(0)

  const { state, processStream, stop } = useStreamingProgress<
    PasslineDescriptionEnrichProgress,
    PasslineDescriptionEnrichComplete
  >({
    onProgress: (update) => {
      // Update toast with progress
      const statusText = update.success ? 'Fetched' : 'Processing'
      toast.loading(
        `Processing Passline descriptions (${update.current}/${update.total})...`,
        {
          id: toastIdRef.current,
          description: update.eventName
            ? `${statusText}: ${update.eventName.substring(0, 40)}${update.eventName.length > 40 ? '...' : ''}`
            : 'Processing...',
        }
      )

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
        toast.error('No Passline descriptions added', {
          id: toastIdRef.current,
          description: 'Could not extract descriptions from any Passline event pages.',
        })
      } else {
        toast.success(`Added descriptions to ${result.enriched} Passline events`, {
          id: toastIdRef.current,
          description: `${result.enriched} of ${result.total} events enriched (${result.translated} translated to English).`,
        })
      }
    },
    onError: (error) => {
      console.error('Failed to add Passline descriptions:', error)
      toast.error('Failed to add Passline descriptions', {
        id: toastIdRef.current,
        description: error.message || 'An unexpected error occurred.',
      })
    },
    onStop: () => {
      // Refresh UI to show new descriptions
      invalidateEvents()

      toast.warning(`Stopped adding Passline descriptions`, {
        id: toastIdRef.current,
        description: `Added descriptions to ${totalEnrichedRef.current} of ${totalToProcessRef.current} events.`,
      })
    },
    getCurrentFromProgress: (p) => p.current,
    getTotalFromProgress: (p) => p.total,
  })

  /**
   * Check if an event is a Passline event that can be enriched.
   * Allows both 'pending' (never enriched) and 'failed' (retry) events.
   */
  const canEnrichEvent = useCallback((event: EventWithVenue) => {
    const canEnrich =
      event.enrichment_status === 'pending' || event.enrichment_status === 'failed'
    return event.source === 'passline' && canEnrich && !!event.link
  }, [])

  /**
   * Get Passline events that can be enriched from a selection
   */
  const getPasslineEnrichableEvents = useCallback(
    (events: EventWithVenue[], selectedIds: Set<string>) => {
      return events.filter((e) => selectedIds.has(e.id) && canEnrichEvent(e))
    },
    [canEnrichEvent]
  )

  /**
   * Enrich selected Passline events with descriptions using Playwright.
   * Server-side Playwright/Browserless handles:
   * - Visiting Passline pages (bypasses CORS)
   * - Cloudflare challenge handling
   * - JSON-LD extraction
   * - Translation and embedding generation
   */
  const enrichPasslineEvents = useCallback(
    async (
      events: EventWithVenue[],
      selectedIds: Set<string>,
      onComplete?: () => void
    ) => {
      const enrichableEvents = getPasslineEnrichableEvents(events, selectedIds)

      if (enrichableEvents.length === 0) {
        toast.info('No Passline events need descriptions', {
          description:
            'Selected Passline events either have descriptions or no source URLs.',
        })
        return
      }

      // Reset counters
      totalEnrichedRef.current = 0
      totalToProcessRef.current = enrichableEvents.length

      // Prepare events for server-side enrichment
      const eventsForEnrichment = enrichableEvents.map((e) => ({
        id: e.id,
        name: e.name,
        link: e.link || '',
      }))

      // Show initial toast
      toastIdRef.current = toast.loading(
        `Fetching descriptions for ${enrichableEvents.length} Passline events...`,
        {
          description: 'Using Playwright to visit each event page.',
        }
      )

      try {
        // Single-phase: Server-side extraction, translation, and saving
        const stream = await enrichPasslineDescriptionsWithPlaywrightAction({
          data: { events: eventsForEnrichment },
        })

        await processStream(
          stream,
          (update): update is PasslineDescriptionEnrichProgress =>
            update.type === 'progress'
        )

        // Call completion callback
        onComplete?.()
      } finally {
        toastIdRef.current = undefined
      }
    },
    [getPasslineEnrichableEvents, processStream]
  )

  return {
    isPasslineEnriching: state.isProcessing,
    passlineEnrichProgress: {
      isEnriching: state.isProcessing,
      current: state.current,
      total: state.total,
    },
    canEnrichPasslineEvent: canEnrichEvent,
    getPasslineEnrichableEvents,
    enrichPasslineEvents,
    stopPasslineEnrichment: stop,
  }
}

export type UsePasslineDescriptionEnrichmentReturn = ReturnType<
  typeof usePasslineDescriptionEnrichment
>
