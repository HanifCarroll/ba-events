import { useState, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import { track } from '@/lib/analytics'
import {
  importPasslineEventsBatchAction,
  importEventbriteEventsBatchAction,
  importBATourismEventsBatchAction,
  importMeetupEventsBatchAction,
  importLumaEventsBatchAction,
  type PasslinePreviewEvent,
  type EventbritePreviewEvent,
  type BATourismPreviewEvent,
  type MeetupPreviewEvent,
  type LumaPreviewEvent,
  type PasslineImportComplete,
  type EventbriteImportComplete,
  type BATourismImportComplete,
  type MeetupImportComplete,
  type LumaImportComplete,
  type WeekContext,
} from '@/features/import'
import { bulkCreateEventsAction } from '@/features/events/api/crud'
import { getRecentlyImportedPendingEventsAction } from '@/features/events/api/enrichment'
import { getRecentlyCreatedPendingVenuesAction } from '@/features/venues/api/enrichment'
import { useAutoEnrichment, type EventToEnrich, type VenueToEnrich } from './useAutoEnrichment'
import type { ImportSource, ParsedCSVRow } from './useImportSource'

export interface ImportResult {
  inserted: number
  updated: number
  withVenue: number
  withoutVenue: number
  withDescription: number
  withoutDescription: number
  withCategories: number
  withoutCategories: number
}

export interface UseImportSubmitReturn {
  // State
  isImporting: boolean
  importProgress: { current: number; total: number } | null
  importResult: ImportResult | null
  autoEnrich: boolean
  autoEnrichment: ReturnType<typeof useAutoEnrichment>

  // Actions
  importEvents: (params: {
    source: ImportSource | null
    selectedIds: Set<string>
    passlineEvents: PasslinePreviewEvent[]
    eventbriteEvents: EventbritePreviewEvent[]
    baTourismEvents: BATourismPreviewEvent[]
    baTourismWeekContext: WeekContext | null
    meetupEvents: MeetupPreviewEvent[]
    lumaEvents: LumaPreviewEvent[]
    csvRows: ParsedCSVRow[]
  }) => Promise<{ needsEnrichment: boolean; result: ImportResult } | null>
  setAutoEnrich: (value: boolean) => void
  setError: (error: string | null) => void
  reset: () => void
}

export function useImportSubmit(
  setError: (error: string | null) => void
): UseImportSubmitReturn {
  const [isImporting, setIsImporting] = useState(false)
  const [importProgress, setImportProgress] = useState<{ current: number; total: number } | null>(null)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [autoEnrich, setAutoEnrich] = useState(false)

  // Track when import started for auto-enrichment query
  const importStartTimeRef = useRef<string | null>(null)

  // Auto-enrichment hook for post-import enrichment
  const autoEnrichment = useAutoEnrichment()

  const importEvents = useCallback(async (params: {
    source: ImportSource | null
    selectedIds: Set<string>
    passlineEvents: PasslinePreviewEvent[]
    eventbriteEvents: EventbritePreviewEvent[]
    baTourismEvents: BATourismPreviewEvent[]
    baTourismWeekContext: WeekContext | null
    meetupEvents: MeetupPreviewEvent[]
    lumaEvents: LumaPreviewEvent[]
    csvRows: ParsedCSVRow[]
  }): Promise<{ needsEnrichment: boolean; result: ImportResult } | null> => {
    const {
      source,
      selectedIds,
      passlineEvents,
      eventbriteEvents,
      baTourismEvents,
      baTourismWeekContext,
      meetupEvents,
      lumaEvents,
      csvRows,
    } = params

    if (selectedIds.size === 0) return null

    // Capture start time for auto-enrichment query
    importStartTimeRef.current = new Date().toISOString()

    setIsImporting(true)
    setError(null)
    setImportProgress({ current: 0, total: selectedIds.size })

    try {
      let totalInserted = 0
      let totalUpdated = 0
      let withVenue = 0
      let withoutVenue = 0
      let withDescription = 0
      let withoutDescription = 0
      let withCategories = 0
      let withoutCategories = 0
      let needsEnrichment = false

      if (source === 'passline') {
        const selectedEvents = passlineEvents.filter(e => selectedIds.has(e.passline.id))
        const eventsToImport = selectedEvents.map(e => ({
          passlineEvent: e.passline,
          venueId: e.venueMatch.venue?.id || null,
        }))

        withVenue = selectedEvents.filter(e => e.venueMatch.venue?.id).length
        withoutVenue = selectedEvents.length - withVenue
        withDescription = 0
        withoutDescription = selectedEvents.length
        withCategories = 0
        withoutCategories = selectedEvents.length

        const stream = await importPasslineEventsBatchAction({ data: { events: eventsToImport } })
        let finalResult: PasslineImportComplete | null = null

        for await (const update of stream) {
          if (update.type === 'progress') {
            setImportProgress({ current: update.current, total: update.total })
          } else if (update.type === 'complete') {
            finalResult = update
          }
        }

        if (finalResult) {
          totalInserted = finalResult.inserted
          totalUpdated = finalResult.updated
          toast.success(`Imported ${totalInserted} new, ${totalUpdated} updated`)
        }

        if (withoutDescription > 0 && (totalInserted > 0 || totalUpdated > 0)) {
          needsEnrichment = true
        }
      } else if (source === 'eventbrite') {
        const selectedEvents = eventbriteEvents.filter(e => selectedIds.has(e.eventbrite.url))
        const eventsToImport = selectedEvents.map(e => ({
          eventbriteEvent: e.eventbrite,
          venueId: e.venueMatch.venue?.id || null,
        }))

        withVenue = selectedEvents.filter(e => e.venueMatch.venue?.id).length
        withoutVenue = selectedEvents.length - withVenue
        withDescription = selectedEvents.filter(e => e.eventbrite.description).length
        withoutDescription = selectedEvents.length - withDescription
        withCategories = 0
        withoutCategories = selectedEvents.length

        const stream = await importEventbriteEventsBatchAction({ data: { events: eventsToImport } })
        let finalResult: EventbriteImportComplete | null = null

        for await (const update of stream) {
          if (update.type === 'progress') {
            setImportProgress({ current: update.current, total: update.total })
          } else if (update.type === 'complete') {
            finalResult = update
          }
        }

        if (finalResult) {
          totalInserted = finalResult.inserted
          totalUpdated = finalResult.updated
          toast.success(`Imported ${totalInserted} new, ${totalUpdated} updated`)
        }
      } else if (source === 'ba-tourism') {
        if (!baTourismWeekContext) {
          throw new Error('Week context is missing')
        }

        const selectedEvents = baTourismEvents.filter(e => selectedIds.has(`ba-tourism-${e.baTourism.name}`))
        const eventsToImport = selectedEvents.map(e => ({
          baTourismEvent: e.baTourism,
          venueId: e.venueMatch.venue?.id || null,
          weekContext: baTourismWeekContext,
        }))

        withVenue = selectedEvents.filter(e => e.venueMatch.venue?.id).length
        withoutVenue = selectedEvents.length - withVenue
        withDescription = selectedEvents.filter(e => e.baTourism.description).length
        withoutDescription = selectedEvents.length - withDescription
        withCategories = selectedEvents.length
        withoutCategories = 0

        const baTourismStream = await importBATourismEventsBatchAction({ data: { events: eventsToImport } })
        let baTourismFinalResult: BATourismImportComplete | null = null

        for await (const update of baTourismStream) {
          if (update.type === 'progress') {
            setImportProgress({ current: update.current, total: update.total })
          } else if (update.type === 'complete') {
            baTourismFinalResult = update
          }
        }

        if (baTourismFinalResult) {
          totalInserted = baTourismFinalResult.inserted
          totalUpdated = baTourismFinalResult.updated
          toast.success(`Imported ${totalInserted} new, ${totalUpdated} updated`)
        }
      } else if (source === 'meetup') {
        const selectedEvents = meetupEvents.filter(e => selectedIds.has(e.meetup.id))
        const eventsToImport = selectedEvents.map(e => ({
          meetupEvent: e.meetup,
          venueId: e.venueMatch.venue?.id || null,
        }))

        withVenue = selectedEvents.filter(e => e.venueMatch.venue?.id).length
        withoutVenue = selectedEvents.length - withVenue
        withDescription = selectedEvents.filter(e => e.meetup.description).length
        withoutDescription = selectedEvents.length - withDescription
        withCategories = 0
        withoutCategories = selectedEvents.length

        const meetupStream = await importMeetupEventsBatchAction({ data: { events: eventsToImport } })
        let meetupFinalResult: MeetupImportComplete | null = null

        for await (const update of meetupStream) {
          if (update.type === 'progress') {
            setImportProgress({ current: update.current, total: update.total })
          } else if (update.type === 'complete') {
            meetupFinalResult = update
          }
        }

        if (meetupFinalResult) {
          totalInserted = meetupFinalResult.inserted
          totalUpdated = meetupFinalResult.updated
          toast.success(`Imported ${totalInserted} new, ${totalUpdated} updated`)
        }

        if (withoutVenue > 0 && totalInserted > 0) {
          needsEnrichment = true
        }
      } else if (source === 'luma') {
        const selectedEvents = lumaEvents.filter(e => selectedIds.has(e.luma.api_id))
        const eventsToImport = selectedEvents.map(e => ({
          lumaEvent: e.luma,
          venueId: e.venueMatch.venue?.id || null,
        }))

        withVenue = selectedEvents.filter(e => e.venueMatch.venue?.id).length
        withoutVenue = selectedEvents.length - withVenue
        withDescription = selectedEvents.filter(e => e.luma.description).length
        withoutDescription = selectedEvents.length - withDescription
        withCategories = 0
        withoutCategories = selectedEvents.length

        const lumaStream = await importLumaEventsBatchAction({ data: { events: eventsToImport } })
        let lumaFinalResult: LumaImportComplete | null = null

        for await (const update of lumaStream) {
          if (update.type === 'progress') {
            setImportProgress({ current: update.current, total: update.total })
          } else if (update.type === 'complete') {
            lumaFinalResult = update
          }
        }

        if (lumaFinalResult) {
          totalInserted = lumaFinalResult.inserted
          totalUpdated = lumaFinalResult.updated
          toast.success(`Imported ${totalInserted} new, ${totalUpdated} updated`)
        }

        if (withoutDescription > 0 && (totalInserted > 0 || totalUpdated > 0)) {
          needsEnrichment = true
        }
      } else {
        // CSV import
        const events = csvRows
          .filter((_, i) => selectedIds.has(`csv-${i}`))
          .filter(r => r.event)
          .map(r => r.event!)

        withVenue = events.filter(e => e.venue_id).length
        withoutVenue = events.length - withVenue
        withDescription = events.filter(e => e.description_es).length
        withoutDescription = events.length - withDescription
        withCategories = events.filter(e => e.categories && e.categories.length > 0).length
        withoutCategories = events.length - withCategories

        const result = await bulkCreateEventsAction({ data: events })
        totalInserted = result.count
        totalUpdated = 0
        toast.success(`Imported ${result.count} events`)
      }

      const result: ImportResult = {
        inserted: totalInserted,
        updated: totalUpdated,
        withVenue,
        withoutVenue,
        withDescription,
        withoutDescription,
        withCategories,
        withoutCategories,
      }

      setImportResult(result)
      track('admin:import_completed', {
        source,
        inserted: totalInserted,
        updated: totalUpdated,
        with_venue: withVenue,
        without_venue: withoutVenue,
      })

      // Start auto-enrichment for imported events and venues if not going to enrichment step
      if (!needsEnrichment && source && importStartTimeRef.current) {
        try {
          const [pendingEvents, pendingVenues] = await Promise.all([
            getRecentlyImportedPendingEventsAction({
              data: { source, importedAfter: importStartTimeRef.current },
            }),
            getRecentlyCreatedPendingVenuesAction({
              data: { createdAfter: importStartTimeRef.current },
            }),
          ])

          const eventsToEnrich: EventToEnrich[] = pendingEvents.map(
            (e: { id: string; name: string; link: string; source: string }) => ({
              id: e.id,
              name: e.name,
              link: e.link,
              source: e.source,
            })
          )

          const venuesToEnrich: VenueToEnrich[] = pendingVenues.map(
            (v: { id: string; name: string }) => ({
              venueId: v.id,
              venueName: v.name,
            })
          )

          if (eventsToEnrich.length > 0 || venuesToEnrich.length > 0) {
            autoEnrichment.startEnrichment(eventsToEnrich, venuesToEnrich)
          }
        } catch (enrichErr) {
          console.error('[import] Failed to start auto-enrichment:', enrichErr)
        }
      }

      return { needsEnrichment, result }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import events')
      toast.error('Import failed')
      return null
    } finally {
      setIsImporting(false)
      setImportProgress(null)
    }
  }, [autoEnrichment, setError])

  const reset = useCallback(() => {
    setIsImporting(false)
    setImportProgress(null)
    setImportResult(null)
    setAutoEnrich(false)
  }, [])

  return {
    // State
    isImporting,
    importProgress,
    importResult,
    autoEnrich,
    autoEnrichment,

    // Actions
    importEvents,
    setAutoEnrich,
    setError,
    reset,
  }
}
