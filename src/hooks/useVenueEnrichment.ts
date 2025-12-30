import { useState, useCallback, useRef } from 'react'
import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { enrichBATourismVenuesAction } from '@/lib/admin'
import type { EventWithVenue } from '@/lib/types'

interface VenueEnrichmentState {
  isEnriching: boolean
  current: number
  total: number
}

/**
 * Hook for enriching events with missing venue data
 * Currently supports BA Tourism events
 */
export function useVenueEnrichment() {
  const router = useRouter()
  const [state, setState] = useState<VenueEnrichmentState>({
    isEnriching: false,
    current: 0,
    total: 0,
  })

  const toastIdRef = useRef<string | number | undefined>(undefined)

  /**
   * Check if an event can be venue-enriched
   * Currently only BA Tourism events without venue_id and with a link
   */
  const canEnrichVenue = useCallback((event: EventWithVenue) => {
    return (
      event.source === 'ba-tourism' &&
      !event.venue_id &&
      !!event.link &&
      event.link.includes('turismo.buenosaires.gob.ar')
    )
  }, [])

  /**
   * Get enrichable events from a selection
   */
  const getVenueEnrichableEvents = useCallback(
    (events: EventWithVenue[], selectedIds: Set<string>) => {
      return events.filter((e) => selectedIds.has(e.id) && canEnrichVenue(e))
    },
    [canEnrichVenue]
  )

  /**
   * Enrich selected events with venue data
   */
  const enrichVenues = useCallback(
    async (
      events: EventWithVenue[],
      selectedIds: Set<string>,
      onComplete?: () => void
    ) => {
      const enrichableEvents = getVenueEnrichableEvents(events, selectedIds)

      if (enrichableEvents.length === 0) {
        toast.info('No events to enrich', {
          description:
            'Selected events either have venues or are not from BA Tourism.',
        })
        return
      }

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
        `Filling venues for ${enrichableEvents.length} events...`,
        {
          description: 'Extracting venue info from event pages.',
        }
      )

      try {
        const result = await enrichBATourismVenuesAction({
          data: { events: eventsToEnrich },
        })

        setState((prev) => ({
          ...prev,
          current: result.total,
        }))

        // Final toast
        if (result.enriched === 0) {
          toast.error('No venues found', {
            id: toastIdRef.current,
            description: 'Could not extract venue info from any event pages.',
          })
        } else {
          const venueMsg = result.venuesCreated > 0
            ? ` (${result.venuesCreated} new venues created)`
            : ''
          toast.success(`Filled venues for ${result.enriched} events${venueMsg}`, {
            id: toastIdRef.current,
            description:
              result.errors.length > 0
                ? `${result.errors.length} events had errors.`
                : 'All events now have venues.',
          })
        }

        // Refresh UI
        router.invalidate()

        // Call completion callback
        onComplete?.()
      } catch (error) {
        console.error('Venue enrichment failed:', error)
        toast.error('Venue enrichment failed', {
          id: toastIdRef.current,
          description:
            error instanceof Error
              ? error.message
              : 'An unexpected error occurred.',
        })
      } finally {
        setState({ isEnriching: false, current: 0, total: 0 })
        toastIdRef.current = undefined
      }
    },
    [getVenueEnrichableEvents, router]
  )

  return {
    isVenueEnriching: state.isEnriching,
    venueEnrichProgress: state,
    canEnrichVenue,
    getVenueEnrichableEvents,
    enrichVenues,
  }
}

export type UseVenueEnrichmentReturn = ReturnType<typeof useVenueEnrichment>
