import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import Papa from 'papaparse'
import { track } from '@/lib/analytics'
import {
  processPasslineEventsAction,
  fetchEventbriteEventsAction,
  fetchBATourismEventsAction,
  fetchMeetupEventsAction,
  fetchLumaEventsAction,
  type PasslinePreviewEvent,
  type EventbritePreviewEvent,
  type BATourismPreviewEvent,
  type MeetupPreviewEvent,
  type LumaPreviewEvent,
  type WeekContext,
} from '@/features/import'
import { listBlocklistEntriesAction } from '@/features/import/api/blocklist'
import {
  fetchPasslineEventsClient,
  filterCABAEventsClient,
  filterByDateRangeClient,
} from '@/features/import/scrapers/passline/client'
import { CATEGORIES, EVENT_STATUSES } from '@/shared/lib/types'
import type { Neighborhood, Category, EventStatus, EventInsert } from '@/shared/lib/types'

export type ImportSource = 'passline' | 'eventbrite' | 'ba-tourism' | 'meetup' | 'luma' | 'csv'

interface CSVRow {
  name?: string
  starts_at?: string
  ends_at?: string
  venue_name?: string
  categories?: string
  price?: string
  is_free?: string
  link?: string
  ticket_url?: string
  description_es?: string
  description_en?: string
  status?: string
  is_all_day?: string
}

export interface ParsedCSVRow {
  rowNumber: number
  data: CSVRow
  errors: string[]
  event?: EventInsert
}

interface VenueEdit {
  name: string
  neighborhood: Neighborhood | null
  action: 'create' | 'merge' | 'skip'
  mergeInto?: string
}

export interface UseImportSourceReturn {
  // State
  source: ImportSource | null
  startDate: string
  endDate: string
  passlineEvents: PasslinePreviewEvent[]
  eventbriteEvents: EventbritePreviewEvent[]
  baTourismEvents: BATourismPreviewEvent[]
  baTourismWeekContext: WeekContext | null
  meetupEvents: MeetupPreviewEvent[]
  lumaEvents: LumaPreviewEvent[]
  csvRows: ParsedCSVRow[]
  csvFileName: string | null
  isFetching: boolean
  meetupFetchProgress: { currentBatch: number; totalBatches: number; eventsFound: number } | null
  error: string | null

  // CSV stats
  csvValidCount: number
  csvErrorCount: number
  csvAllValid: boolean

  // Actions
  selectSource: (source: ImportSource) => void
  setStartDate: (date: string) => void
  setEndDate: (date: string) => void
  fetchPasslineEvents: () => Promise<{ events: PasslinePreviewEvent[]; venueEdits: Map<string, VenueEdit>; selectedIds: Set<string> }>
  fetchEventbriteEvents: () => Promise<{ events: EventbritePreviewEvent[]; venueEdits: Map<string, VenueEdit>; selectedIds: Set<string> }>
  fetchBaTourismEvents: () => Promise<{ events: BATourismPreviewEvent[]; venueEdits: Map<string, VenueEdit>; selectedIds: Set<string> }>
  fetchMeetupEvents: () => Promise<{ events: MeetupPreviewEvent[]; venueEdits: Map<string, VenueEdit>; selectedIds: Set<string> }>
  fetchLumaEvents: () => Promise<{ events: LumaPreviewEvent[]; venueEdits: Map<string, VenueEdit>; selectedIds: Set<string> }>
  handleCSVFile: (file: File, venueNameToId: Map<string, string>) => void
  setPasslineEvents: (events: PasslinePreviewEvent[]) => void
  setEventbriteEvents: (events: EventbritePreviewEvent[]) => void
  setBaTourismEvents: (events: BATourismPreviewEvent[]) => void
  setMeetupEvents: (events: MeetupPreviewEvent[]) => void
  setLumaEvents: (events: LumaPreviewEvent[]) => void
  setCsvRows: (rows: ParsedCSVRow[]) => void
  setError: (error: string | null) => void
  reset: () => void
}

export function useImportSource(initialSource?: ImportSource): UseImportSourceReturn {
  const [source, setSource] = useState<ImportSource | null>(initialSource ?? null)
  const [startDate, setStartDate] = useState(() => new Date().toISOString().split('T')[0])
  const [endDate, setEndDate] = useState(() => {
    const date = new Date()
    date.setDate(date.getDate() + 30)
    return date.toISOString().split('T')[0]
  })

  const [passlineEvents, setPasslineEvents] = useState<PasslinePreviewEvent[]>([])
  const [eventbriteEvents, setEventbriteEvents] = useState<EventbritePreviewEvent[]>([])
  const [baTourismEvents, setBaTourismEvents] = useState<BATourismPreviewEvent[]>([])
  const [baTourismWeekContext, setBaTourismWeekContext] = useState<WeekContext | null>(null)
  const [meetupEvents, setMeetupEvents] = useState<MeetupPreviewEvent[]>([])
  const [lumaEvents, setLumaEvents] = useState<LumaPreviewEvent[]>([])

  const [csvRows, setCsvRows] = useState<ParsedCSVRow[]>([])
  const [csvFileName, setCsvFileName] = useState<string | null>(null)

  const [isFetching, setIsFetching] = useState(false)
  const [meetupFetchProgress, setMeetupFetchProgress] = useState<{
    currentBatch: number
    totalBatches: number
    eventsFound: number
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  // CSV stats
  const csvValidCount = csvRows.filter(r => r.errors.length === 0).length
  const csvErrorCount = csvRows.filter(r => r.errors.length > 0).length
  const csvAllValid = csvRows.length > 0 && csvErrorCount === 0

  const selectSource = useCallback((newSource: ImportSource) => {
    track('admin:import_started', { source: newSource })
    setSource(newSource)
    setError(null)
  }, [])

  // Helper: chunk a date range into batches of N days
  const chunkDateRange = useCallback((start: string, end: string, daysPerChunk = 7): Array<{ start: string; end: string }> => {
    const chunks: Array<{ start: string; end: string }> = []
    const startDateObj = new Date(start)
    const endDateObj = new Date(end)

    let currentStart = new Date(startDateObj)
    while (currentStart <= endDateObj) {
      const currentEnd = new Date(currentStart)
      currentEnd.setDate(currentEnd.getDate() + daysPerChunk - 1)

      const actualEnd = currentEnd > endDateObj ? endDateObj : currentEnd

      chunks.push({
        start: currentStart.toISOString().split('T')[0],
        end: actualEnd.toISOString().split('T')[0],
      })

      currentStart = new Date(actualEnd)
      currentStart.setDate(currentStart.getDate() + 1)
    }

    return chunks
  }, [])

  // Helper: dedupe events by meetup.id
  const dedupeByMeetupId = useCallback((events: MeetupPreviewEvent[]): MeetupPreviewEvent[] => {
    const seen = new Map<string, MeetupPreviewEvent>()
    for (const event of events) {
      const existing = seen.get(event.meetup.id)
      if (!existing || (event.venueMatch.venue && !existing.venueMatch.venue)) {
        seen.set(event.meetup.id, event)
      }
    }
    return Array.from(seen.values())
  }, [])

  // Initialize venue edits for unmatched venues
  function initVenueEdits<T>(
    events: T[],
    hasUnmatched: (e: T) => boolean,
    getVenueName: (e: T) => string
  ): Map<string, VenueEdit> {
    const edits = new Map<string, VenueEdit>()
    events
      .filter(hasUnmatched)
      .forEach(e => {
        const name = getVenueName(e)
        if (!edits.has(name)) {
          edits.set(name, { name, neighborhood: null, action: 'create' })
        }
      })
    return edits
  }

  const fetchPasslineEvents = useCallback(async () => {
    setIsFetching(true)
    setError(null)

    try {
      const blocklistEntries = await listBlocklistEntriesAction({ data: 'passline' })
      const allEvents = await fetchPasslineEventsClient()
      const cabaEvents = filterCABAEventsClient(allEvents, blocklistEntries)
      const filteredEvents = filterByDateRangeClient(cabaEvents, { startDate, endDate })
      const data = await processPasslineEventsAction({ data: { events: filteredEvents } })

      setPasslineEvents(data)

      const venueEdits = initVenueEdits(
        data,
        e => e.venueMatch.matchType === 'none',
        e => e.passline.lugar
      )

      const newEvents = data.filter(e => !e.alreadyImported)
      const selectedIds = new Set(newEvents.map(e => e.passline.id))

      const alreadyImportedCount = data.length - newEvents.length
      const message = alreadyImportedCount > 0
        ? `Found ${data.length} events (${alreadyImportedCount} already imported)`
        : `Found ${data.length} events`
      toast.success(message)

      return { events: data, venueEdits, selectedIds }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch events'
      setError(errorMessage)
      toast.error('Failed to fetch events')
      throw err
    } finally {
      setIsFetching(false)
    }
  }, [startDate, endDate])

  const fetchEventbriteEvents = useCallback(async () => {
    setIsFetching(true)
    setError(null)

    try {
      const { events: data } = await fetchEventbriteEventsAction({ data: { startDate, endDate } })
      setEventbriteEvents(data)

      const venueEdits = initVenueEdits(
        data,
        e => e.venueMatch.matchType === 'none',
        e => e.eventbrite.location?.name || 'Unknown Venue'
      )

      const newEvents = data.filter(e => !e.alreadyImported)
      const selectedIds = new Set(newEvents.map(e => e.eventbrite.url))

      const alreadyImportedCount = data.length - newEvents.length
      const message = alreadyImportedCount > 0
        ? `Found ${data.length} events (${alreadyImportedCount} already imported)`
        : `Found ${data.length} events`
      toast.success(message)

      return { events: data, venueEdits, selectedIds }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch events'
      setError(errorMessage)
      toast.error('Failed to fetch events')
      throw err
    } finally {
      setIsFetching(false)
    }
  }, [startDate, endDate])

  const fetchBaTourismEvents = useCallback(async () => {
    setIsFetching(true)
    setError(null)

    try {
      const { events: data, weekContext } = await fetchBATourismEventsAction({ data: {} })
      setBaTourismEvents(data)
      setBaTourismWeekContext(weekContext)

      const venueEdits = new Map<string, VenueEdit>()
      data
        .filter(e => e.venueMatch.matchType === 'none')
        .forEach(e => {
          const name = e.baTourism.venueName
          if (!venueEdits.has(name)) {
            // Use mapToNeighborhood inline since it's only used here
            const neighborhood = e.baTourism.neighborhood as Neighborhood | null
            venueEdits.set(name, { name, neighborhood, action: 'create' })
          }
        })

      const newEvents = data.filter(e => !e.alreadyImported)
      const selectedIds = new Set(newEvents.map(e => `ba-tourism-${e.baTourism.name}`))

      const totalExpanded = data.reduce((sum, e) => sum + e.dateCount, 0)
      const alreadyImportedCount = data.length - newEvents.length
      const message = alreadyImportedCount > 0
        ? `Found ${data.length} events (${totalExpanded} dates, ${alreadyImportedCount} already imported)`
        : `Found ${data.length} events (${totalExpanded} dates)`
      toast.success(message)

      return { events: data, venueEdits, selectedIds }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch events'
      setError(errorMessage)
      toast.error('Failed to fetch BA Tourism events')
      throw err
    } finally {
      setIsFetching(false)
    }
  }, [])

  const fetchMeetupEvents = useCallback(async () => {
    setIsFetching(true)
    setError(null)
    setMeetupFetchProgress(null)

    try {
      const chunks = chunkDateRange(startDate, endDate, 7)
      const allEvents: MeetupPreviewEvent[] = []

      for (let i = 0; i < chunks.length; i++) {
        setMeetupFetchProgress({
          currentBatch: i + 1,
          totalBatches: chunks.length,
          eventsFound: allEvents.length,
        })

        try {
          const { events } = await fetchMeetupEventsAction({
            data: { startDate: chunks[i].start, endDate: chunks[i].end },
          })
          allEvents.push(...events)
        } catch (batchErr) {
          console.error(`Batch ${i + 1}/${chunks.length} failed:`, batchErr)
          if (allEvents.length === 0 && i === chunks.length - 1) {
            throw batchErr
          }
        }
      }

      const data = dedupeByMeetupId(allEvents)
      setMeetupEvents(data)

      const venueEdits = initVenueEdits(
        data,
        e => e.venueMatch.matchType === 'none',
        e => e.meetup.venue?.name || 'Unknown Venue'
      )

      const newEvents = data.filter(e => !e.alreadyImported)
      const selectedIds = new Set(newEvents.map(e => e.meetup.id))

      const totalExpanded = data.reduce((sum, e) => sum + e.dateCount, 0)
      const alreadyImportedCount = data.length - newEvents.length
      const message = alreadyImportedCount > 0
        ? `Found ${data.length} events (${totalExpanded} occurrences, ${alreadyImportedCount} already imported)`
        : `Found ${data.length} events (${totalExpanded} occurrences)`
      toast.success(message)

      return { events: data, venueEdits, selectedIds }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch events'
      setError(errorMessage)
      toast.error('Failed to fetch Meetup events')
      throw err
    } finally {
      setIsFetching(false)
      setMeetupFetchProgress(null)
    }
  }, [startDate, endDate, chunkDateRange, dedupeByMeetupId])

  const fetchLumaEvents = useCallback(async () => {
    setIsFetching(true)
    setError(null)

    try {
      const { events: data } = await fetchLumaEventsAction({ data: { startDate, endDate } })
      setLumaEvents(data)

      const venueEdits = initVenueEdits(
        data,
        e => e.venueMatch.matchType === 'none',
        e => e.luma.venue?.name || 'Unknown Venue'
      )

      const newEvents = data.filter(e => !e.alreadyImported)
      const selectedIds = new Set(newEvents.map(e => e.luma.api_id))

      const alreadyImportedCount = data.length - newEvents.length
      const message = alreadyImportedCount > 0
        ? `Found ${data.length} events (${alreadyImportedCount} already imported)`
        : `Found ${data.length} events`
      toast.success(message)

      return { events: data, venueEdits, selectedIds }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch events'
      setError(errorMessage)
      toast.error('Failed to fetch Luma events')
      throw err
    } finally {
      setIsFetching(false)
    }
  }, [startDate, endDate])

  const validateCSVRow = useCallback((row: CSVRow, rowNumber: number, venueNameToId: Map<string, string>): ParsedCSVRow => {
    const errors: string[] = []

    if (!row.name?.trim()) errors.push('Name is required')
    if (!row.starts_at?.trim()) {
      errors.push('Start date is required')
    } else {
      const parsedStartDate = new Date(row.starts_at)
      if (isNaN(parsedStartDate.getTime())) errors.push('Invalid start date format')
    }

    if (row.ends_at?.trim()) {
      const parsedEndDate = new Date(row.ends_at)
      if (isNaN(parsedEndDate.getTime())) {
        errors.push('Invalid end date format')
      } else if (row.starts_at) {
        const parsedStartDate = new Date(row.starts_at)
        if (!isNaN(parsedStartDate.getTime()) && parsedEndDate <= parsedStartDate) {
          errors.push('End date must be after start date')
        }
      }
    }

    let venueId: string | null = null
    if (row.venue_name?.trim()) {
      const foundId = venueNameToId.get(row.venue_name.trim().toLowerCase())
      if (!foundId) {
        errors.push(`Venue "${row.venue_name}" not found`)
      } else {
        venueId = foundId
      }
    }

    const categories: Category[] = []
    if (row.categories?.trim()) {
      const cats = row.categories.split(',').map(c => c.trim().toLowerCase())
      for (const cat of cats) {
        if (CATEGORIES.includes(cat as Category)) {
          categories.push(cat as Category)
        } else {
          errors.push(`Invalid category: "${cat}"`)
        }
      }
    }

    let price: number | null = null
    if (row.price?.trim()) {
      const parsed = parseFloat(row.price)
      if (isNaN(parsed) || parsed < 0) {
        errors.push('Price must be a positive number')
      } else {
        price = parsed
      }
    }

    let status: EventStatus = 'scheduled'
    if (row.status?.trim()) {
      const s = row.status.trim().toLowerCase()
      if (EVENT_STATUSES.includes(s as EventStatus)) {
        status = s as EventStatus
      } else {
        errors.push(`Invalid status: "${row.status}"`)
      }
    }

    const isFree = row.is_free?.trim().toLowerCase() === 'true'
    const isAllDay = row.is_all_day?.trim().toLowerCase() === 'true'

    let event: EventInsert | undefined
    if (errors.length === 0) {
      event = {
        name: row.name!.trim(),
        starts_at: new Date(row.starts_at!).toISOString(),
        ends_at: row.ends_at?.trim() ? new Date(row.ends_at).toISOString() : null,
        venue_id: venueId,
        categories,
        price: isFree ? null : price,
        is_free: isFree,
        link: row.link?.trim() || null,
        ticket_url: row.ticket_url?.trim() || null,
        description_es: row.description_es?.trim() || null,
        description_en: row.description_en?.trim() || null,
        status,
        is_all_day: isAllDay,
        source: 'csv_import',
      }
    }

    return { rowNumber, data: row, errors, event }
  }, [])

  const handleCSVFile = useCallback((file: File, venueNameToId: Map<string, string>) => {
    setCsvFileName(file.name)
    setError(null)

    Papa.parse<CSVRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const rows = results.data.map((row, index) => validateCSVRow(row, index + 2, venueNameToId))
        setCsvRows(rows)
        toast.success(`Parsed ${rows.length} rows from CSV`)
      },
      error: (parseError) => {
        console.error('CSV parsing error:', parseError)
        setError('Failed to parse CSV file')
        toast.error('Failed to parse CSV file')
      },
    })
  }, [validateCSVRow])

  const reset = useCallback(() => {
    setSource(null)
    setPasslineEvents([])
    setEventbriteEvents([])
    setBaTourismEvents([])
    setBaTourismWeekContext(null)
    setMeetupEvents([])
    setLumaEvents([])
    setCsvRows([])
    setCsvFileName(null)
    setError(null)
    setMeetupFetchProgress(null)
  }, [])

  return {
    // State
    source,
    startDate,
    endDate,
    passlineEvents,
    eventbriteEvents,
    baTourismEvents,
    baTourismWeekContext,
    meetupEvents,
    lumaEvents,
    csvRows,
    csvFileName,
    isFetching,
    meetupFetchProgress,
    error,

    // CSV stats
    csvValidCount,
    csvErrorCount,
    csvAllValid,

    // Actions
    selectSource,
    setStartDate,
    setEndDate,
    fetchPasslineEvents,
    fetchEventbriteEvents,
    fetchBaTourismEvents,
    fetchMeetupEvents,
    fetchLumaEvents,
    handleCSVFile,
    setPasslineEvents,
    setEventbriteEvents,
    setBaTourismEvents,
    setMeetupEvents,
    setLumaEvents,
    setCsvRows,
    setError,
    reset,
  }
}
