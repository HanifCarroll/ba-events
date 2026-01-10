import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import { useInvalidateCache } from '@/shared/hooks/useInvalidateCache'
import {
  getEventsWithoutDescriptions,
  enrichEventDescriptionsAction,
  type DescriptionEnrichComplete,
} from '../api/enrichment'
import type { EventWithVenue } from '@/shared/lib/types'

export type EnrichStep = 'select' | 'enriching' | 'complete'

export function useDescriptionEnrichment() {
  const { invalidateEvents } = useInvalidateCache()
  const [showEnrichDialog, setShowEnrichDialog] = useState(false)
  const [eventsWithoutDesc, setEventsWithoutDesc] = useState<EventWithVenue[]>(
    []
  )
  const [enrichSelectedIds, setEnrichSelectedIds] = useState<Set<string>>(
    new Set()
  )
  const [enrichStep, setEnrichStep] = useState<EnrichStep>('select')
  const [enrichProgress, setEnrichProgress] = useState<{
    current: number
    total: number
  } | null>(null)
  const [enrichResult, setEnrichResult] = useState<{
    enriched: number
    total: number
  } | null>(null)
  const [isLoadingEvents, setIsLoadingEvents] = useState(false)

  async function openEnrichDialog() {
    setShowEnrichDialog(true)
    setIsLoadingEvents(true)
    setEnrichStep('select')
    setEnrichSelectedIds(new Set())
    setEnrichProgress(null)
    setEnrichResult(null)

    try {
      const events = await getEventsWithoutDescriptions()
      setEventsWithoutDesc(events)
      // Select all by default
      setEnrichSelectedIds(new Set(events.map((e) => e.id)))
    } catch (err) {
      console.error('Failed to load events:', err)
      toast.error('Failed to load events for enrichment')
    } finally {
      setIsLoadingEvents(false)
    }
  }

  function closeEnrichDialog() {
    setShowEnrichDialog(false)
    setEnrichStep('select')
    setEventsWithoutDesc([])
    setEnrichSelectedIds(new Set())
    setEnrichProgress(null)
    setEnrichResult(null)
  }

  const toggleEnrichSelect = useCallback((id: string) => {
    setEnrichSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  function toggleEnrichSelectAll() {
    if (enrichSelectedIds.size === eventsWithoutDesc.length) {
      setEnrichSelectedIds(new Set())
    } else {
      setEnrichSelectedIds(new Set(eventsWithoutDesc.map((e) => e.id)))
    }
  }

  /**
   * Enrich selected events using Jina Reader + Haiku 4.5
   * Streams progress updates in real-time
   */
  async function handleEnrichDescriptions() {
    const selectedEvents = eventsWithoutDesc
      .filter((e) => enrichSelectedIds.has(e.id) && e.link)
      .map((e) => ({ id: e.id, link: e.link!, source: e.source, name: e.name }))

    if (selectedEvents.length === 0) return

    setEnrichStep('enriching')
    setEnrichProgress({ current: 0, total: selectedEvents.length })

    try {
      const stream = await enrichEventDescriptionsAction({
        data: { events: selectedEvents },
      })

      let finalResult: DescriptionEnrichComplete | null = null

      for await (const update of stream) {
        if (update.type === 'progress') {
          setEnrichProgress({ current: update.current, total: update.total })
        } else if (update.type === 'complete') {
          finalResult = update
        }
      }

      if (finalResult) {
        setEnrichResult({ enriched: finalResult.enriched, total: finalResult.total })
        setEnrichStep('complete')
        await invalidateEvents()
      }
    } catch (err) {
      console.error('Enrichment failed:', err)
      toast.error('Failed to enrich event descriptions')
      setEnrichStep('select')
    }
  }

  return {
    showEnrichDialog,
    eventsWithoutDesc,
    enrichSelectedIds,
    enrichStep,
    setEnrichStep,
    enrichProgress,
    enrichResult,
    isLoadingEvents,
    openEnrichDialog,
    closeEnrichDialog,
    toggleEnrichSelect,
    toggleEnrichSelectAll,
    handleEnrichDescriptions,
  }
}

export type UseDescriptionEnrichmentReturn = ReturnType<
  typeof useDescriptionEnrichment
>
