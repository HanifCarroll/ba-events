import { useState, useCallback, useRef } from 'react'
import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { updateEventDescriptionsAction } from '@/lib/admin'
import { fetchDescriptionsBatch, type DescriptionFetchResult } from '@/lib/scrapers/passline'
import type { EventWithVenue } from '@/lib/types'

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

  /**
   * Check if an event can be enriched (missing description but has a link)
   */
  const canEnrichEvent = useCallback((event: EventWithVenue) => {
    return !event.description && !!event.link
  }, [])

  /**
   * Get enrichable events from a selection
   */
  const getEnrichableEvents = useCallback((
    events: EventWithVenue[],
    selectedIds: Set<string>
  ) => {
    return events.filter(e => selectedIds.has(e.id) && canEnrichEvent(e))
  }, [canEnrichEvent])

  /**
   * Enrich selected events in the background
   */
  const enrichEvents = useCallback(async (
    events: EventWithVenue[],
    selectedIds: Set<string>,
    onComplete?: () => void
  ) => {
    const enrichableEvents = getEnrichableEvents(events, selectedIds)

    if (enrichableEvents.length === 0) {
      toast.info('No events to enrich', {
        description: 'Selected events either have descriptions or no links to fetch from.',
      })
      return
    }

    setState({
      isEnriching: true,
      current: 0,
      total: enrichableEvents.length,
    })

    // Show initial toast
    toastIdRef.current = toast.loading(`Enriching ${enrichableEvents.length} events...`, {
      description: 'Fetching descriptions from event pages.',
    })

    try {
      // Prepare events for batch fetch
      const eventsToFetch = enrichableEvents.map(e => ({
        id: e.id,
        link: e.link || '',
      }))

      // Fetch descriptions with progress updates
      const results = await fetchDescriptionsBatch(
        eventsToFetch,
        (current, total) => {
          setState(prev => ({ ...prev, current, total }))
          // Update toast with progress
          toast.loading(`Enriching events (${current}/${total})...`, {
            id: toastIdRef.current,
            description: `Fetched ${current} of ${total} descriptions.`,
          })
        }
      )

      // Filter successful results
      const successfulResults = results.filter(
        (r): r is DescriptionFetchResult & { description: string } =>
          r.description !== null
      )

      if (successfulResults.length === 0) {
        toast.error('No descriptions found', {
          id: toastIdRef.current,
          description: 'Could not fetch any descriptions from the event pages.',
        })
        setState({ isEnriching: false, current: 0, total: 0 })
        return
      }

      // Update toast for saving phase
      toast.loading(`Saving ${successfulResults.length} descriptions...`, {
        id: toastIdRef.current,
      })

      // Save to database
      const updates = successfulResults.map(r => ({
        id: r.id,
        description: r.description,
      }))

      await updateEventDescriptionsAction({ data: { updates } })

      // Success toast
      toast.success(`Enriched ${successfulResults.length} events`, {
        id: toastIdRef.current,
        description: `${successfulResults.length} of ${enrichableEvents.length} events now have descriptions.`,
      })

      // Invalidate router to refresh data
      router.invalidate()

      // Call completion callback
      onComplete?.()

    } catch (error) {
      console.error('Enrichment failed:', error)
      toast.error('Enrichment failed', {
        id: toastIdRef.current,
        description: error instanceof Error ? error.message : 'An unexpected error occurred.',
      })
    } finally {
      setState({ isEnriching: false, current: 0, total: 0 })
      toastIdRef.current = undefined
    }
  }, [getEnrichableEvents, router])

  return {
    isEnriching: state.isEnriching,
    enrichProgress: state,
    canEnrichEvent,
    getEnrichableEvents,
    enrichEvents,
  }
}

export type UseBackgroundEnrichmentReturn = ReturnType<typeof useBackgroundEnrichment>
