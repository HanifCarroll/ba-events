import { useState, useCallback } from 'react'
import { useRouter } from '@tanstack/react-router'
import {
  getEventsWithoutDescriptions,
  enrichEventDescriptionsAction,
  type DescriptionEnrichComplete,
} from '@/lib/admin'
import type { EventWithVenue } from '@/lib/types'

export type EnrichStep = 'select' | 'enriching' | 'complete'

export function useDescriptionEnrichment() {
  const router = useRouter()
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
        router.invalidate()
      }
    } catch (err) {
      console.error('Enrichment failed:', err)
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
