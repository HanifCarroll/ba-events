import { useState, useCallback } from 'react'
import { useRouter } from '@tanstack/react-router'
import { getEventsWithoutDescriptions, updateEventDescriptionsAction } from '@/lib/admin'
import { fetchDescriptionsBatch, type DescriptionFetchResult } from '@/lib/scrapers/passline'
import type { EventWithVenue } from '@/lib/types'

export type EnrichStep = 'select' | 'fetching' | 'preview' | 'saving'

export function useDescriptionEnrichment() {
  const router = useRouter()
  const [showEnrichDialog, setShowEnrichDialog] = useState(false)
  const [eventsWithoutDesc, setEventsWithoutDesc] = useState<EventWithVenue[]>([])
  const [enrichSelectedIds, setEnrichSelectedIds] = useState<Set<string>>(new Set())
  const [enrichStep, setEnrichStep] = useState<EnrichStep>('select')
  const [enrichProgress, setEnrichProgress] = useState<{ current: number; total: number } | null>(null)
  const [fetchedDescriptions, setFetchedDescriptions] = useState<DescriptionFetchResult[]>([])
  const [isLoadingEvents, setIsLoadingEvents] = useState(false)

  async function openEnrichDialog() {
    setShowEnrichDialog(true)
    setIsLoadingEvents(true)
    setEnrichStep('select')
    setEnrichSelectedIds(new Set())
    setFetchedDescriptions([])
    setEnrichProgress(null)

    try {
      const events = await getEventsWithoutDescriptions()
      setEventsWithoutDesc(events)
      // Select all by default
      setEnrichSelectedIds(new Set(events.map(e => e.id)))
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
    setFetchedDescriptions([])
    setEnrichProgress(null)
  }

  const toggleEnrichSelect = useCallback((id: string) => {
    setEnrichSelectedIds(prev => {
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
      setEnrichSelectedIds(new Set(eventsWithoutDesc.map(e => e.id)))
    }
  }

  async function handleFetchDescriptions() {
    const selectedEvents = eventsWithoutDesc
      .filter(e => enrichSelectedIds.has(e.id))
      .map(e => ({ id: e.id, link: e.link || '' }))

    if (selectedEvents.length === 0) return

    setEnrichStep('fetching')
    setEnrichProgress({ current: 0, total: selectedEvents.length })

    try {
      const results = await fetchDescriptionsBatch(
        selectedEvents,
        (current, total) => setEnrichProgress({ current, total })
      )
      setFetchedDescriptions(results)
      setEnrichStep('preview')
    } catch (err) {
      console.error('Fetch failed:', err)
      setEnrichStep('select')
    }
  }

  async function handleSaveDescriptions() {
    const updates = fetchedDescriptions
      .filter(r => r.description)
      .map(r => ({ id: r.id, description: r.description! }))

    if (updates.length === 0) {
      closeEnrichDialog()
      return
    }

    setEnrichStep('saving')
    setEnrichProgress({ current: 0, total: updates.length })

    try {
      await updateEventDescriptionsAction({ data: { updates } })
      closeEnrichDialog()
      router.invalidate()
    } catch (err) {
      console.error('Save failed:', err)
      setEnrichStep('preview')
    }
  }

  return {
    showEnrichDialog,
    eventsWithoutDesc,
    enrichSelectedIds,
    enrichStep,
    setEnrichStep,
    enrichProgress,
    fetchedDescriptions,
    isLoadingEvents,
    openEnrichDialog,
    closeEnrichDialog,
    toggleEnrichSelect,
    toggleEnrichSelectAll,
    handleFetchDescriptions,
    handleSaveDescriptions,
  }
}

export type UseDescriptionEnrichmentReturn = ReturnType<typeof useDescriptionEnrichment>
