import { useState, useCallback } from 'react'
import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import {
  getMeetupEventsNeedingEnrichmentAction,
  enrichMeetupVenuesAction,
  getLumaEventsNeedingDescriptionEnrichmentAction,
  enrichLumaDescriptionsAction,
  extractPasslineEventsBatchClient,
  type MeetupVenueEnrichComplete,
  type LumaDescriptionEnrichComplete,
} from '@/features/import'
import {
  getPasslineEventsNeedingDescriptionsAction,
  enrichPasslineDescriptionsAction,
  type PasslineDescriptionEnrichComplete,
} from '@/features/events/api/enrichment'
import type { ImportSource } from './useImportSource'

type EnrichmentResultType =
  | Pick<MeetupVenueEnrichComplete, 'enriched' | 'venuesCreated' | 'errors'>
  | Pick<LumaDescriptionEnrichComplete, 'enriched' | 'errors'>
  | Pick<PasslineDescriptionEnrichComplete, 'enriched' | 'errors' | 'translated'>

export interface UseImportEnrichmentReturn {
  // State
  isEnriching: boolean
  enrichmentProgress: { current: number; total: number } | null
  enrichmentResult: EnrichmentResultType | null
  eventsNeedingEnrichment: Array<{ id: string; link: string }>
  lumaEventsNeedingEnrichment: Array<{ id: string; source_url: string; name: string }>
  passlineEventsNeedingEnrichment: Array<{ id: string; link: string; name: string }>
  isLoadingEnrichmentEvents: boolean

  // Actions
  fetchEventsNeedingEnrichment: () => Promise<void>
  fetchLumaEventsNeedingEnrichment: () => Promise<void>
  fetchPasslineEventsNeedingEnrichment: () => Promise<void>
  enrichVenues: () => Promise<void>
  enrichDescriptions: () => Promise<void>
  enrichPasslineDescriptions: () => Promise<void>
  skipEnrichment: () => void
  retryFailedEnrichment: (source: ImportSource | null) => Promise<void>
  viewEvents: () => void
  setError: (error: string | null) => void
  reset: () => void
}

export function useImportEnrichment(
  setError: (error: string | null) => void
): UseImportEnrichmentReturn {
  const router = useRouter()

  const [isEnriching, setIsEnriching] = useState(false)
  const [enrichmentProgress, setEnrichmentProgress] = useState<{ current: number; total: number } | null>(null)
  const [enrichmentResult, setEnrichmentResult] = useState<EnrichmentResultType | null>(null)
  const [eventsNeedingEnrichment, setEventsNeedingEnrichment] = useState<Array<{ id: string; link: string }>>([])
  const [lumaEventsNeedingEnrichment, setLumaEventsNeedingEnrichment] = useState<Array<{ id: string; source_url: string; name: string }>>([])
  const [passlineEventsNeedingEnrichment, setPasslineEventsNeedingEnrichment] = useState<Array<{ id: string; link: string; name: string }>>([])
  const [isLoadingEnrichmentEvents, setIsLoadingEnrichmentEvents] = useState(false)

  const fetchEventsNeedingEnrichment = useCallback(async () => {
    setIsLoadingEnrichmentEvents(true)
    try {
      const result = await getMeetupEventsNeedingEnrichmentAction()
      setEventsNeedingEnrichment(result.events)
    } catch (err) {
      console.error('Failed to fetch events needing enrichment:', err)
      setEventsNeedingEnrichment([])
    } finally {
      setIsLoadingEnrichmentEvents(false)
    }
  }, [])

  const fetchLumaEventsNeedingEnrichment = useCallback(async () => {
    setIsLoadingEnrichmentEvents(true)
    try {
      const result = await getLumaEventsNeedingDescriptionEnrichmentAction()
      setLumaEventsNeedingEnrichment(result.events)
    } catch (err) {
      console.error('Failed to fetch Luma events needing enrichment:', err)
      setLumaEventsNeedingEnrichment([])
    } finally {
      setIsLoadingEnrichmentEvents(false)
    }
  }, [])

  const fetchPasslineEventsNeedingEnrichment = useCallback(async () => {
    setIsLoadingEnrichmentEvents(true)
    try {
      const result = await getPasslineEventsNeedingDescriptionsAction()
      setPasslineEventsNeedingEnrichment(result)
    } catch (err) {
      console.error('Failed to fetch Passline events needing enrichment:', err)
      setPasslineEventsNeedingEnrichment([])
    } finally {
      setIsLoadingEnrichmentEvents(false)
    }
  }, [])

  const enrichVenues = useCallback(async () => {
    if (eventsNeedingEnrichment.length === 0) return

    setIsEnriching(true)
    setEnrichmentProgress({ current: 0, total: eventsNeedingEnrichment.length })
    setError(null)

    try {
      const events = eventsNeedingEnrichment.map(e => ({
        eventId: e.id,
        eventUrl: e.link,
      }))

      const enrichStream = await enrichMeetupVenuesAction({ data: { events } })
      let enrichFinalResult: MeetupVenueEnrichComplete | null = null

      for await (const update of enrichStream) {
        if (update.type === 'progress') {
          setEnrichmentProgress({ current: update.current, total: update.total })
        } else if (update.type === 'complete') {
          enrichFinalResult = update
        }
      }

      if (enrichFinalResult) {
        setEnrichmentResult({
          enriched: enrichFinalResult.enriched,
          venuesCreated: enrichFinalResult.venuesCreated,
          errors: enrichFinalResult.errors,
        })

        if (enrichFinalResult.enriched > 0) {
          toast.success(`Enriched ${enrichFinalResult.enriched} events with venue data`)
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to enrich venues')
      toast.error('Venue enrichment failed')
    } finally {
      setIsEnriching(false)
      setEnrichmentProgress(null)
    }
  }, [eventsNeedingEnrichment, setError])

  const enrichDescriptions = useCallback(async () => {
    if (lumaEventsNeedingEnrichment.length === 0) return

    setIsEnriching(true)
    setEnrichmentProgress({ current: 0, total: lumaEventsNeedingEnrichment.length })
    setError(null)

    try {
      const events = lumaEventsNeedingEnrichment.map(e => ({
        eventId: e.id,
        source_url: e.source_url,
        name: e.name,
      }))

      const enrichStream = await enrichLumaDescriptionsAction({ data: { events } })
      let enrichFinalResult: LumaDescriptionEnrichComplete | null = null

      for await (const update of enrichStream) {
        if (update.type === 'progress') {
          setEnrichmentProgress({ current: update.current, total: update.total })
        } else if (update.type === 'complete') {
          enrichFinalResult = update
        }
      }

      if (enrichFinalResult) {
        setEnrichmentResult({
          enriched: enrichFinalResult.enriched,
          errors: enrichFinalResult.errors || [],
        })

        if (enrichFinalResult.enriched > 0) {
          toast.success(`Enriched ${enrichFinalResult.enriched} events with descriptions`)
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to enrich descriptions')
      toast.error('Description enrichment failed')
    } finally {
      setIsEnriching(false)
      setEnrichmentProgress(null)
    }
  }, [lumaEventsNeedingEnrichment, setError])

  const enrichPasslineDescriptions = useCallback(async () => {
    if (passlineEventsNeedingEnrichment.length === 0) return

    setIsEnriching(true)
    setEnrichmentProgress({ current: 0, total: passlineEventsNeedingEnrichment.length })
    setError(null)

    try {
      // Phase 1: Client-side extraction from JSON-LD
      const eventsForExtraction = passlineEventsNeedingEnrichment.map(e => ({
        id: e.id,
        url: e.link,
      }))

      const extractedResults = await extractPasslineEventsBatchClient(
        eventsForExtraction,
        (current, total) => {
          setEnrichmentProgress({ current, total: total * 2 })
        },
        300
      )

      // Filter to only events where we got descriptions
      const eventsWithDescriptions = extractedResults
        .filter(r => r.description && r.description.length > 0)
        .map(r => {
          const event = passlineEventsNeedingEnrichment.find(e => e.id === r.id)
          return {
            id: r.id,
            name: event?.name || 'Unknown',
            description_es: r.description!,
          }
        })

      if (eventsWithDescriptions.length === 0) {
        setEnrichmentResult({
          enriched: 0,
          translated: 0,
          errors: [],
        })
        toast.error('No descriptions found in Passline event pages')
        setIsEnriching(false)
        setEnrichmentProgress(null)
        return
      }

      // Phase 2: Server-side translation and saving
      const enrichStream = await enrichPasslineDescriptionsAction({
        data: { events: eventsWithDescriptions },
      })
      let enrichFinalResult: PasslineDescriptionEnrichComplete | null = null

      for await (const update of enrichStream) {
        if (update.type === 'progress') {
          setEnrichmentProgress({
            current: passlineEventsNeedingEnrichment.length + update.current,
            total: passlineEventsNeedingEnrichment.length + update.total,
          })
        } else if (update.type === 'complete') {
          enrichFinalResult = update
        }
      }

      if (enrichFinalResult) {
        setEnrichmentResult({
          enriched: enrichFinalResult.enriched,
          translated: enrichFinalResult.translated,
          errors: enrichFinalResult.errors || [],
        })

        if (enrichFinalResult.enriched > 0) {
          toast.success(
            `Enriched ${enrichFinalResult.enriched} Passline events (${enrichFinalResult.translated} translated)`
          )
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to enrich Passline descriptions')
      toast.error('Passline description enrichment failed')
    } finally {
      setIsEnriching(false)
      setEnrichmentProgress(null)
    }
  }, [passlineEventsNeedingEnrichment, setError])

  const skipEnrichment = useCallback(() => {
    router.navigate({ to: '/admin/events' })
  }, [router])

  const viewEvents = useCallback(() => {
    router.navigate({ to: '/admin/events' })
  }, [router])

  const retryFailedEnrichment = useCallback(async (source: ImportSource | null) => {
    if (!enrichmentResult || !enrichmentResult.errors || enrichmentResult.errors.length === 0) return

    setIsEnriching(true)
    setError(null)

    const failedEventIds = new Set((enrichmentResult.errors ?? []).map((e: { id: string; error: string }) => e.id))

    if (source === 'luma') {
      const eventsToRetry = lumaEventsNeedingEnrichment.filter(e => failedEventIds.has(e.id))

      if (eventsToRetry.length === 0) {
        toast.error('Could not find events for retry')
        setIsEnriching(false)
        return
      }

      setEnrichmentProgress({ current: 0, total: eventsToRetry.length })

      try {
        const events = eventsToRetry.map(e => ({
          eventId: e.id,
          source_url: e.source_url,
          name: e.name,
        }))

        const retryStream = await enrichLumaDescriptionsAction({ data: { events } })
        let retryFinalResult: LumaDescriptionEnrichComplete | null = null

        for await (const update of retryStream) {
          if (update.type === 'progress') {
            setEnrichmentProgress({ current: update.current, total: update.total })
          } else if (update.type === 'complete') {
            retryFinalResult = update
          }
        }

        if (retryFinalResult) {
          const previousEnriched = enrichmentResult.enriched

          setEnrichmentResult({
            enriched: previousEnriched + retryFinalResult.enriched,
            errors: retryFinalResult.errors || [],
          })

          if (retryFinalResult.enriched > 0) {
            toast.success(`Retry successful: enriched ${retryFinalResult.enriched} more events`)
          } else if (retryFinalResult.errors && retryFinalResult.errors.length > 0) {
            toast.error(`Retry failed: ${retryFinalResult.errors.length} events still have errors`)
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to retry enrichment')
        toast.error('Retry failed')
      } finally {
        setIsEnriching(false)
        setEnrichmentProgress(null)
      }
    } else {
      // Meetup venue enrichment retry
      const eventsToRetry = eventsNeedingEnrichment.filter(e => failedEventIds.has(e.id))

      if (eventsToRetry.length === 0) {
        toast.error('Could not find event links for failed events')
        setIsEnriching(false)
        return
      }

      setEnrichmentProgress({ current: 0, total: eventsToRetry.length })

      try {
        const events = eventsToRetry.map(e => ({
          eventId: e.id,
          eventUrl: e.link,
        }))

        const retryStream = await enrichMeetupVenuesAction({ data: { events } })
        let retryFinalResult: MeetupVenueEnrichComplete | null = null

        for await (const update of retryStream) {
          if (update.type === 'progress') {
            setEnrichmentProgress({ current: update.current, total: update.total })
          } else if (update.type === 'complete') {
            retryFinalResult = update
          }
        }

        if (retryFinalResult) {
          const previousEnriched = enrichmentResult.enriched
          const previousVenuesCreated = 'venuesCreated' in enrichmentResult ? enrichmentResult.venuesCreated : 0

          setEnrichmentResult({
            enriched: previousEnriched + retryFinalResult.enriched,
            venuesCreated: previousVenuesCreated + retryFinalResult.venuesCreated,
            errors: retryFinalResult.errors,
          })

          if (retryFinalResult.enriched > 0) {
            toast.success(`Retry successful: enriched ${retryFinalResult.enriched} more events`)
          } else if (retryFinalResult.errors.length > 0) {
            toast.error(`Retry failed: ${retryFinalResult.errors.length} events still have errors`)
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to retry enrichment')
        toast.error('Retry failed')
      } finally {
        setIsEnriching(false)
        setEnrichmentProgress(null)
      }
    }
  }, [enrichmentResult, eventsNeedingEnrichment, lumaEventsNeedingEnrichment, setError])

  const reset = useCallback(() => {
    setIsEnriching(false)
    setEnrichmentProgress(null)
    setEnrichmentResult(null)
    setEventsNeedingEnrichment([])
    setLumaEventsNeedingEnrichment([])
    setPasslineEventsNeedingEnrichment([])
  }, [])

  return {
    // State
    isEnriching,
    enrichmentProgress,
    enrichmentResult,
    eventsNeedingEnrichment,
    lumaEventsNeedingEnrichment,
    passlineEventsNeedingEnrichment,
    isLoadingEnrichmentEvents,

    // Actions
    fetchEventsNeedingEnrichment,
    fetchLumaEventsNeedingEnrichment,
    fetchPasslineEventsNeedingEnrichment,
    enrichVenues,
    enrichDescriptions,
    enrichPasslineDescriptions,
    skipEnrichment,
    retryFailedEnrichment,
    viewEvents,
    setError,
    reset,
  }
}
