import { useState, useCallback, useRef } from 'react'
import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { enrichVenuesWithNominatimAction } from '@/lib/admin'
import type { Venue } from '@/lib/types'
import type { VenueEnrichmentOutput } from '@/lib/admin/venue-enrichment'

interface EnrichmentState {
  isEnriching: boolean
  current: number
  total: number
}

export function useVenueNominatimEnrichment() {
  const router = useRouter()
  const [state, setState] = useState<EnrichmentState>({
    isEnriching: false,
    current: 0,
    total: 0,
  })
  const [result, setResult] = useState<VenueEnrichmentOutput | null>(null)

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
  }, [])

  /**
   * Enrich selected venues using Nominatim API
   * Note: Processing happens server-side with rate limiting
   * We poll progress by checking the response
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

      // Show initial toast with estimated time
      const estimatedSeconds = enrichableVenues.length
      toastIdRef.current = toast.loading(
        `Enriching ${enrichableVenues.length} venues...`,
        {
          description: `Looking up addresses on OpenStreetMap. ~${estimatedSeconds}s remaining.`,
        }
      )

      try {
        // Call server action (handles rate limiting internally)
        const enrichResult = await enrichVenuesWithNominatimAction({
          data: { venues: venuesToEnrich },
        })

        setResult(enrichResult)

        // Update state to show completion
        setState({
          isEnriching: false,
          current: enrichResult.total,
          total: enrichResult.total,
        })

        // Show completion toast
        if (enrichResult.enriched === 0) {
          toast.error('No venues enriched', {
            id: toastIdRef.current,
            description: 'Could not find address data for any selected venues.',
          })
        } else if (enrichResult.errors.length > 0) {
          toast.warning(
            `Enriched ${enrichResult.enriched} of ${enrichResult.total} venues`,
            {
              id: toastIdRef.current,
              description: `${enrichResult.errors.length} venues had errors. Check the dialog for details.`,
            }
          )
        } else {
          toast.success(`Enriched ${enrichResult.enriched} venues`, {
            id: toastIdRef.current,
            description: 'Address and neighborhood data has been added.',
          })
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
    canEnrichVenue,
    getEnrichableVenues,
    enrichVenues,
    clearResult,
  }
}

export type UseVenueNominatimEnrichmentReturn = ReturnType<
  typeof useVenueNominatimEnrichment
>
