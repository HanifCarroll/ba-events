import { useCallback, useRef } from 'react'
import { toast } from 'sonner'
import { useInvalidateCache } from '@/shared/hooks/useInvalidateCache'
import { useStreamingProgress } from '@/shared/hooks/useStreamingProgress'
import {
  enrichPasslineDescriptionsAction,
  type PasslineDescriptionEnrichProgress,
  type PasslineDescriptionEnrichComplete,
} from '../api/enrichment'
import { extractPasslineEventsBatchClient } from '@/features/import/scrapers/passline/client-enrichment'
import type { EventWithVenue } from '@/shared/lib/types'

/**
 * Hook for enriching Passline events with descriptions.
 *
 * Since Cloudflare blocks server-side requests to Passline, this hook:
 * 1. Extracts descriptions client-side from JSON-LD on each event page
 * 2. Sends the Spanish descriptions to the server for translation and embedding
 *
 * Use the "Fetch Passline Descriptions" button to trigger this enrichment.
 */
export function usePasslineDescriptionEnrichment() {
  const { invalidateEvents } = useInvalidateCache()

  // Keep track of the current toast ID so we can update it
  const toastIdRef = useRef<string | number | undefined>(undefined)
  const totalEnrichedRef = useRef(0)
  const totalToProcessRef = useRef(0)
  const extractionPhaseRef = useRef(false)

  const { state, processStream, stop } = useStreamingProgress<
    PasslineDescriptionEnrichProgress,
    PasslineDescriptionEnrichComplete
  >({
    onProgress: (update) => {
      // Update toast with progress
      toast.loading(
        `Processing Passline descriptions (${update.current}/${update.total})...`,
        {
          id: toastIdRef.current,
          description: update.eventName
            ? `Translating: ${update.eventName.substring(0, 40)}${update.eventName.length > 40 ? '...' : ''}`
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
   * Check if an event is a Passline event that can be enriched
   */
  const canEnrichEvent = useCallback((event: EventWithVenue) => {
    return (
      event.source === 'passline' &&
      event.enrichment_status === 'pending' &&
      !!event.link
    )
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
   * Enrich selected Passline events with descriptions
   * 1. First extracts descriptions client-side from JSON-LD
   * 2. Then sends to server for translation and embedding
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
      extractionPhaseRef.current = true

      // Prepare events for client-side extraction
      const eventsForExtraction = enrichableEvents.map((e) => ({
        id: e.id,
        url: e.link || '',
      }))

      // Show initial toast for extraction phase
      toastIdRef.current = toast.loading(
        `Extracting descriptions from ${enrichableEvents.length} Passline pages...`,
        {
          description: 'Fetching event pages to extract JSON-LD data.',
        }
      )

      try {
        // Phase 1: Client-side extraction from JSON-LD
        const extractedResults = await extractPasslineEventsBatchClient(
          eventsForExtraction,
          (current, total) => {
            toast.loading(`Extracting descriptions (${current}/${total})...`, {
              id: toastIdRef.current,
              description: `Fetching Passline event pages...`,
            })
          },
          300 // 300ms delay between requests
        )

        // Filter to only events where we got descriptions
        const eventsWithDescriptions = extractedResults
          .filter((r) => r.description && r.description.length > 0)
          .map((r) => {
            const event = enrichableEvents.find((e) => e.id === r.id)
            return {
              id: r.id,
              name: event?.name || 'Unknown',
              description_es: r.description!,
            }
          })

        if (eventsWithDescriptions.length === 0) {
          toast.error('No descriptions found', {
            id: toastIdRef.current,
            description:
              'Could not extract descriptions from any Passline event pages. They may not have description data.',
          })
          return
        }

        // Update toast for translation phase
        extractionPhaseRef.current = false
        toast.loading(
          `Translating ${eventsWithDescriptions.length} descriptions...`,
          {
            id: toastIdRef.current,
            description: 'Sending to server for translation and embedding.',
          }
        )

        // Phase 2: Server-side translation and saving
        const stream = await enrichPasslineDescriptionsAction({
          data: { events: eventsWithDescriptions },
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
        extractionPhaseRef.current = false
      }
    },
    [getPasslineEnrichableEvents, processStream]
  )

  return {
    isPasslineEnriching: state.isProcessing || extractionPhaseRef.current,
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
