import { useState, useCallback, useRef } from 'react'
import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { enrichVenuesWithNominatimAction, type VenueEnrichmentOutput, type VenueEnrichmentComplete } from '../api/enrichment'
import { getVenueEventsAction, type VenueEventPreview } from '../api/review'
import type { Venue } from '@/shared/lib/types'

interface EnrichmentState {
  isEnriching: boolean
  current: number
  total: number
}

// Events grouped by venue ID for display in summary
export type VenueEventsMap = Record<string, VenueEventPreview[]>

export function useVenueNominatimEnrichment() {
  const router = useRouter()
  const [state, setState] = useState<EnrichmentState>({
    isEnriching: false,
    current: 0,
    total: 0,
  })
  const [result, setResult] = useState<VenueEnrichmentOutput | null>(null)
  const [venueEvents, setVenueEvents] = useState<VenueEventsMap>({})

  // Keep track of the current toast ID so we can update it
  const toastIdRef = useRef<string | number | undefined>(undefined)

  /**
   * Check if a venue can be enriched (missing address or neighborhood)
   */
  const canEnrichVenue = useCallback((venue: Venue) => {
    return !venue.address || !venue.neighborhood
  }, [])

  /**
   * Get enrichable venues from a selection
   */
  const getEnrichableVenues = useCallback(
    (venues: Venue[], selectedIds: Set<string>) => {
      return venues.filter((v) => selectedIds.has(v.id) && canEnrichVenue(v))
    },
    [canEnrichVenue]
  )

  /**
   * Clear enrichment result (call when closing dialog)
   */
  const clearResult = useCallback(() => {
    setResult(null)
    setVenueEvents({})
  }, [])

  /**
   * Enrich selected venues using Nominatim API
   * Uses streaming to show real-time progress updates
   */
  const enrichVenues = useCallback(
    async (
      venues: Venue[],
      selectedIds: Set<string>,
      onComplete?: () => void
    ) => {
      const enrichableVenues = getEnrichableVenues(venues, selectedIds)

      if (enrichableVenues.length === 0) {
        toast.info('No venues need enrichment', {
          description: 'Selected venues already have address and neighborhood data.',
        })
        return
      }

      setState({
        isEnriching: true,
        current: 0,
        total: enrichableVenues.length,
      })
      setResult(null)

      // Prepare venues for enrichment
      const venuesToEnrich = enrichableVenues.map((v) => ({
        venueId: v.id,
        venueName: v.name,
      }))

      // Show initial toast
      toastIdRef.current = toast.loading(
        `Enriching 0/${enrichableVenues.length} venues...`,
        {
          description: 'Looking up addresses on OpenStreetMap...',
        }
      )

      try {
        // Call server action and stream progress updates
        const stream = await enrichVenuesWithNominatimAction({
          data: { venues: venuesToEnrich },
        })

        let finalResult: VenueEnrichmentComplete | null = null

        // Iterate through streamed updates
        for await (const update of stream) {
          if (update.type === 'progress') {
            // Update state in real-time
            setState({
              isEnriching: true,
              current: update.current,
              total: update.total,
            })

            // Update toast with current progress
            toast.loading(
              `Enriching ${update.current}/${update.total}: ${update.venueName}`,
              {
                id: toastIdRef.current,
                description: update.success
                  ? 'Found address data'
                  : update.error || 'Processing...',
              }
            )
          } else if (update.type === 'complete') {
            finalResult = update
          }
        }

        // Handle completion
        if (finalResult) {
          setResult({
            success: true,
            enriched: finalResult.enriched,
            total: finalResult.total,
            errors: finalResult.errors,
          })

          setState({
            isEnriching: false,
            current: finalResult.total,
            total: finalResult.total,
          })

          // Fetch events for failed venues so user can see affected events
          if (finalResult.errors.length > 0) {
            const failedVenueIds = finalResult.errors.map((e) => e.venueId)
            try {
              const events = await getVenueEventsAction({ data: failedVenueIds })
              setVenueEvents(events)
            } catch (err) {
              console.error('Failed to fetch events for failed venues:', err)
            }
          }

          // Show completion toast
          if (finalResult.enriched === 0) {
            toast.error('No venues enriched', {
              id: toastIdRef.current,
              description: 'Could not find address data for any selected venues.',
            })
          } else if (finalResult.errors.length > 0) {
            toast.warning(
              `Enriched ${finalResult.enriched} of ${finalResult.total} venues`,
              {
                id: toastIdRef.current,
                description: `${finalResult.errors.length} venues had errors. Check the dialog for details.`,
              }
            )
          } else {
            toast.success(`Enriched ${finalResult.enriched} venues`, {
              id: toastIdRef.current,
              description: 'Address and neighborhood data has been added.',
            })
          }
        }

        // Refresh UI to show new data
        router.invalidate()

        // Call completion callback
        onComplete?.()
      } catch (error) {
        console.error('Failed to enrich venues:', error)
        setState({ isEnriching: false, current: 0, total: 0 })
        toast.error('Failed to enrich venues', {
          id: toastIdRef.current,
          description:
            error instanceof Error
              ? error.message
              : 'An unexpected error occurred.',
        })
      } finally {
        toastIdRef.current = undefined
      }
    },
    [getEnrichableVenues, router]
  )

  return {
    isEnriching: state.isEnriching,
    enrichProgress: state,
    enrichResult: result,
    venueEvents,
    canEnrichVenue,
    getEnrichableVenues,
    enrichVenues,
    clearResult,
  }
}

export type UseVenueNominatimEnrichmentReturn = ReturnType<
  typeof useVenueNominatimEnrichment
>
