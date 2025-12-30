import { useState, useCallback, useRef } from 'react'
import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import {
  enrichBATourismVenuesAction,
  enrichMeetupVenuesAction,
  enrichEventbriteVenuesAction,
  enrichPasslineVenuesAction,
} from '@/lib/admin'
import { extractPasslineVenuesBatchClient } from '@/lib/scrapers/passline/client-enrichment'
import type { EventWithVenue } from '@/lib/types'

interface VenueEnrichmentState {
  isEnriching: boolean
  current: number
  total: number
}

// Sources that support venue enrichment
// BA Tourism, Meetup, Eventbrite: server-side fetching
// Passline: client-side fetching (Cloudflare blocks server requests)
const VENUE_ENRICHABLE_SOURCES: readonly string[] = ['ba-tourism', 'meetup', 'eventbrite', 'passline']

/**
 * Hook for enriching events with missing venue data
 * Supports BA Tourism, Meetup, Eventbrite, and Passline events
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
   * Must be missing venue_id, have a link, and be from a supported source
   */
  const canEnrichVenue = useCallback((event: EventWithVenue) => {
    if (event.venue_id || !event.link) return false

    // Check source-specific conditions
    switch (event.source) {
      case 'ba-tourism':
        return event.link.includes('turismo.buenosaires.gob.ar')
      case 'meetup':
        return event.link.includes('meetup.com')
      case 'eventbrite':
        return event.link.includes('eventbrite')
      case 'passline':
        return event.link.includes('passline.com')
      default:
        return false
    }
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
   * Group events by source for batch processing
   */
  const groupBySource = useCallback(
    (events: EventWithVenue[]): Map<string, EventWithVenue[]> => {
      const groups = new Map<string, EventWithVenue[]>()
      for (const event of events) {
        const source = event.source
        if (!groups.has(source)) {
          groups.set(source, [])
        }
        groups.get(source)!.push(event)
      }
      return groups
    },
    []
  )

  /**
   * Enrich events for a specific source
   */
  const enrichBySource = useCallback(
    async (
      source: string,
      events: EventWithVenue[]
    ): Promise<{ enriched: number; venuesCreated: number; errors: number }> => {
      const eventsToEnrich = events.map((e) => ({
        id: e.id,
        link: e.link || '',
        eventUrl: e.link || '', // For Meetup compatibility
      }))

      switch (source) {
        case 'ba-tourism': {
          const result = await enrichBATourismVenuesAction({
            data: { events: eventsToEnrich },
          })
          return {
            enriched: result.enriched,
            venuesCreated: result.venuesCreated,
            errors: result.errors.length,
          }
        }
        case 'meetup': {
          const meetupEvents = events.map((e) => ({
            eventId: e.id,
            eventUrl: e.link || '',
          }))
          const result = await enrichMeetupVenuesAction({
            data: { events: meetupEvents },
          })
          return {
            enriched: result.enriched,
            venuesCreated: result.venuesCreated,
            errors: result.errors.length,
          }
        }
        case 'eventbrite': {
          const result = await enrichEventbriteVenuesAction({
            data: { events: eventsToEnrich },
          })
          return {
            enriched: result.enriched,
            venuesCreated: result.venuesCreated,
            errors: result.errors.length,
          }
        }
        case 'passline': {
          // Passline requires client-side extraction first (Cloudflare blocks server)
          const passlineEvents = events.map((e) => ({
            id: e.id,
            url: e.link || '',
          }))

          // Step 1: Client-side extraction from detail pages
          const extractedVenues = await extractPasslineVenuesBatchClient(passlineEvents)

          // Step 2: Send extracted data to server for venue matching/creation
          const venueData = extractedVenues
            .filter((r) => r.venue !== null)
            .map((r) => ({
              id: r.id,
              venueName: r.venue!.venueName,
              address: r.venue!.address,
              location: r.venue!.location,
            }))

          if (venueData.length === 0) {
            return {
              enriched: 0,
              venuesCreated: 0,
              errors: extractedVenues.length,
            }
          }

          const result = await enrichPasslineVenuesAction({
            data: { events: venueData },
          })

          return {
            enriched: result.enriched,
            venuesCreated: result.venuesCreated,
            errors: result.errors.length + (extractedVenues.length - venueData.length),
          }
        }
        default:
          return { enriched: 0, venuesCreated: 0, errors: events.length }
      }
    },
    []
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
        toast.info('No events need venues', {
          description:
            'Selected events either have venues or are from unsupported sources.',
        })
        return
      }

      setState({
        isEnriching: true,
        current: 0,
        total: enrichableEvents.length,
      })

      // Group events by source
      const groupedEvents = groupBySource(enrichableEvents)
      const sourceNames = Array.from(groupedEvents.keys()).join(', ')

      // Show initial toast
      toastIdRef.current = toast.loading(
        `Adding venues to ${enrichableEvents.length} events...`,
        {
          description: `Sources: ${sourceNames}`,
        }
      )

      try {
        let totalEnriched = 0
        let totalVenuesCreated = 0
        let totalErrors = 0

        // Process each source group
        for (const [source, sourceEvents] of groupedEvents) {
          if (VENUE_ENRICHABLE_SOURCES.includes(source)) {
            const result = await enrichBySource(source, sourceEvents)
            totalEnriched += result.enriched
            totalVenuesCreated += result.venuesCreated
            totalErrors += result.errors

            // Update progress
            setState((prev) => ({
              ...prev,
              current: prev.current + sourceEvents.length,
            }))
          }
        }

        // Final toast
        if (totalEnriched === 0) {
          toast.error('No venues added', {
            id: toastIdRef.current,
            description: 'Could not extract venue info from any event pages.',
          })
        } else {
          const venueMsg =
            totalVenuesCreated > 0
              ? ` (${totalVenuesCreated} new venues created)`
              : ''
          toast.success(
            `Added venues to ${totalEnriched} events${venueMsg}`,
            {
              id: toastIdRef.current,
              description:
                totalErrors > 0
                  ? `${totalErrors} events had errors.`
                  : 'All events now have venues.',
            }
          )
        }

        // Refresh UI
        router.invalidate()

        // Call completion callback
        onComplete?.()
      } catch (error) {
        console.error('Failed to add venues:', error)
        toast.error('Failed to add venues', {
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
    [getVenueEnrichableEvents, groupBySource, enrichBySource, router]
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
