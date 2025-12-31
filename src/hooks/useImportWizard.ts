import { useState, useMemo, useCallback } from 'react'
import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import Papa from 'papaparse'
import { track } from '@/lib/analytics'
import {
  processPasslineEventsAction,
  importPasslineEventsBatchAction,
  fetchEventbriteEventsAction,
  importEventbriteEventsBatchAction,
  fetchBATourismEventsAction,
  importBATourismEventsBatchAction,
  fetchMeetupEventsAction,
  importMeetupEventsBatchAction,
  getMeetupEventsNeedingEnrichmentAction,
  enrichMeetupVenuesAction,
  bulkCreateVenuesAction,
  bulkCreateEventsAction,
  listVenues,
  mapToNeighborhood,
  type PasslinePreviewEvent,
  type EventbritePreviewEvent,
  type BATourismPreviewEvent,
  type MeetupPreviewEvent,
  type WeekContext,
  type MeetupEnrichmentOutput,
} from '@/lib/admin'
import {
  fetchPasslineEventsClient,
  filterCABAEventsClient,
  filterByDateRangeClient,
} from '@/lib/scrapers/passline/client'
import { CATEGORIES, EVENT_STATUSES } from '@/lib/types'
import type { Neighborhood, Category, EventStatus, EventInsert } from '@/lib/types'

export type ImportSource = 'passline' | 'eventbrite' | 'ba-tourism' | 'meetup' | 'csv'
export type WizardStep = 'source' | 'configure' | 'venues' | 'select' | 'confirm' | 'enrich' | 'summary'

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

interface VenueEdit {
  name: string
  neighborhood: Neighborhood | null
  skip: boolean
  mergeInto?: string
}

interface CSVRow {
  name?: string
  starts_at?: string
  ends_at?: string
  venue_name?: string
  categories?: string
  price?: string
  is_free?: string
  min_age?: string
  link?: string
  ticket_url?: string
  description_es?: string
  description_en?: string
  status?: string
  is_all_day?: string
}

interface ParsedCSVRow {
  rowNumber: number
  data: CSVRow
  errors: string[]
  event?: EventInsert
}

interface UnmatchedVenue {
  name: string
  count: number
  eventIds: string[]
}

export function useImportWizard(
  initialVenues: { id: string; name: string; neighborhood: string | null }[],
  initialSource?: ImportSource
) {
  const router = useRouter()

  // Core wizard state - if initialSource provided, start at configure step
  const [step, setStep] = useState<WizardStep>(initialSource ? 'configure' : 'source')
  const [source, setSource] = useState<ImportSource | null>(initialSource ?? null)

  // Passline/Eventbrite-specific state (shared date range)
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

  // CSV-specific state
  const [csvRows, setCsvRows] = useState<ParsedCSVRow[]>([])
  const [csvFileName, setCsvFileName] = useState<string | null>(null)

  // Shared state
  const [venues, setVenues] = useState(initialVenues)
  const [venueEdits, setVenueEdits] = useState<Map<string, VenueEdit>>(new Map())
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Loading states
  const [isFetching, setIsFetching] = useState(false)
  const [isCreatingVenues, setIsCreatingVenues] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [importProgress, setImportProgress] = useState<{ current: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Enrichment state (for Meetup venue enrichment)
  const [isEnriching, setIsEnriching] = useState(false)
  const [enrichmentProgress, setEnrichmentProgress] = useState<{ current: number; total: number } | null>(null)
  const [enrichmentResult, setEnrichmentResult] = useState<Omit<MeetupEnrichmentOutput, 'success'> | null>(null)
  const [eventsNeedingEnrichment, setEventsNeedingEnrichment] = useState<Array<{ id: string; link: string }>>([])
  const [isLoadingEnrichmentEvents, setIsLoadingEnrichmentEvents] = useState(false)

  // Import result state (for summary step)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [autoEnrich, setAutoEnrich] = useState(false)

  // Venue name to ID lookup
  const venueNameToId = useMemo(() => {
    const map = new Map<string, string>()
    venues.forEach(v => map.set(v.name.toLowerCase(), v.id))
    return map
  }, [venues])

  // Compute unmatched venues for Passline/Eventbrite/BA Tourism events
  const unmatchedVenues = useMemo<UnmatchedVenue[]>(() => {
    if (source === 'passline') {
      const venueMap = new Map<string, UnmatchedVenue>()
      passlineEvents
        .filter(e => e.venueMatch.matchType === 'none')
        .forEach(e => {
          const name = e.passline.lugar
          const existing = venueMap.get(name)
          if (existing) {
            existing.count++
            existing.eventIds.push(e.passline.id)
          } else {
            venueMap.set(name, { name, count: 1, eventIds: [e.passline.id] })
          }
        })
      return Array.from(venueMap.values()).sort((a, b) => b.count - a.count)
    }

    if (source === 'eventbrite') {
      const venueMap = new Map<string, UnmatchedVenue>()
      eventbriteEvents
        .filter(e => e.venueMatch.matchType === 'none')
        .forEach(e => {
          const name = e.eventbrite.location?.name || 'Unknown Venue'
          const eventId = e.eventbrite.url // Use URL as unique ID for Eventbrite
          const existing = venueMap.get(name)
          if (existing) {
            existing.count++
            existing.eventIds.push(eventId)
          } else {
            venueMap.set(name, { name, count: 1, eventIds: [eventId] })
          }
        })
      return Array.from(venueMap.values()).sort((a, b) => b.count - a.count)
    }

    if (source === 'ba-tourism') {
      const venueMap = new Map<string, UnmatchedVenue>()
      baTourismEvents
        .filter(e => e.venueMatch.matchType === 'none')
        .forEach(e => {
          const name = e.baTourism.venueName
          const eventId = `ba-tourism-${e.baTourism.name}`
          const existing = venueMap.get(name)
          if (existing) {
            existing.count++
            existing.eventIds.push(eventId)
          } else {
            venueMap.set(name, { name, count: 1, eventIds: [eventId] })
          }
        })
      return Array.from(venueMap.values()).sort((a, b) => b.count - a.count)
    }

    if (source === 'meetup') {
      const venueMap = new Map<string, UnmatchedVenue>()
      meetupEvents
        .filter(e => e.venueMatch.matchType === 'none')
        .forEach(e => {
          const name = e.meetup.venue?.name || 'Unknown Venue'
          const eventId = e.meetup.id
          const existing = venueMap.get(name)
          if (existing) {
            existing.count++
            existing.eventIds.push(eventId)
          } else {
            venueMap.set(name, { name, count: 1, eventIds: [eventId] })
          }
        })
      return Array.from(venueMap.values()).sort((a, b) => b.count - a.count)
    }

    return []
  }, [source, passlineEvents, eventbriteEvents, baTourismEvents, meetupEvents])

  // Find similar venue names for merge suggestions
  const similarVenues = useMemo(() => {
    const similar = new Map<string, string[]>()
    const names = unmatchedVenues.map(v => v.name)

    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const a = names[i].toLowerCase().trim()
        const b = names[j].toLowerCase().trim()
        if (a.length > 5 && b.length > 5) {
          if (a.includes(b) || b.includes(a)) {
            const existing = similar.get(names[i]) || []
            existing.push(names[j])
            similar.set(names[i], existing)
          }
        }
      }
    }
    return similar
  }, [unmatchedVenues])

  // CSV validation
  const validateCSVRow = useCallback((row: CSVRow, rowNumber: number): ParsedCSVRow => {
    const errors: string[] = []

    if (!row.name?.trim()) errors.push('Name is required')
    if (!row.starts_at?.trim()) {
      errors.push('Start date is required')
    } else {
      const startDate = new Date(row.starts_at)
      if (isNaN(startDate.getTime())) errors.push('Invalid start date format')
    }

    if (row.ends_at?.trim()) {
      const endDate = new Date(row.ends_at)
      if (isNaN(endDate.getTime())) {
        errors.push('Invalid end date format')
      } else if (row.starts_at) {
        const startDate = new Date(row.starts_at)
        if (!isNaN(startDate.getTime()) && endDate <= startDate) {
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

    let minAge: number | null = null
    if (row.min_age?.trim()) {
      const parsed = parseInt(row.min_age, 10)
      if (isNaN(parsed) || parsed < 0) {
        errors.push('Min age must be a positive integer')
      } else {
        minAge = parsed
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
        min_age: minAge,
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
  }, [venueNameToId])

  // CSV stats
  const csvValidCount = csvRows.filter(r => r.errors.length === 0).length
  const csvErrorCount = csvRows.filter(r => r.errors.length > 0).length
  const csvAllValid = csvRows.length > 0 && csvErrorCount === 0

  // Actions
  const selectSource = useCallback((newSource: ImportSource) => {
    track('admin:import_started', { source: newSource })
    setSource(newSource)
    setStep('configure')
    setError(null)
  }, [])

  const fetchPasslineEventsHandler = useCallback(async () => {
    setIsFetching(true)
    setError(null)

    try {
      const allEvents = await fetchPasslineEventsClient()
      const cabaEvents = filterCABAEventsClient(allEvents)
      const filteredEvents = filterByDateRangeClient(cabaEvents, { startDate, endDate })
      const data = await processPasslineEventsAction({ data: { events: filteredEvents } })

      setPasslineEvents(data)

      // Initialize venue edits for unmatched venues (for optional use later)
      const hasUnmatched = data.some(e => e.venueMatch.matchType === 'none')
      if (hasUnmatched) {
        const edits = new Map<string, VenueEdit>()
        data
          .filter(e => e.venueMatch.matchType === 'none')
          .forEach(e => {
            const name = e.passline.lugar
            if (!edits.has(name)) {
              edits.set(name, { name, neighborhood: null, skip: false })
            }
          })
        setVenueEdits(edits)
      }

      // Select all events and go directly to select step
      setSelectedIds(new Set(data.map(e => e.passline.id)))
      setStep('select')

      toast.success(`Found ${data.length} events`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch events')
      toast.error('Failed to fetch events')
    } finally {
      setIsFetching(false)
    }
  }, [startDate, endDate])

  const fetchEventbriteEventsHandler = useCallback(async () => {
    setIsFetching(true)
    setError(null)

    try {
      // Fetch, filter, and process events server-side (avoids CORS/bot protection)
      const { events: data } = await fetchEventbriteEventsAction({ data: { startDate, endDate } })

      setEventbriteEvents(data)

      // Initialize venue edits for unmatched venues (for optional use later)
      const hasUnmatched = data.some(e => e.venueMatch.matchType === 'none')
      if (hasUnmatched) {
        const edits = new Map<string, VenueEdit>()
        data
          .filter(e => e.venueMatch.matchType === 'none')
          .forEach(e => {
            const name = e.eventbrite.location?.name || 'Unknown Venue'
            if (!edits.has(name)) {
              edits.set(name, { name, neighborhood: null, skip: false })
            }
          })
        setVenueEdits(edits)
      }

      // Select all events and go directly to select step
      setSelectedIds(new Set(data.map(e => e.eventbrite.url)))
      setStep('select')

      toast.success(`Found ${data.length} events`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch events')
      toast.error('Failed to fetch events')
    } finally {
      setIsFetching(false)
    }
  }, [startDate, endDate])

  const fetchBaTourismEventsHandler = useCallback(async () => {
    setIsFetching(true)
    setError(null)

    try {
      // Fetch events from BA Tourism website (server-side)
      // Note: This gets limited events due to JS-rendered content
      const { events: data, weekContext } = await fetchBATourismEventsAction({ data: {} })

      setBaTourismEvents(data)
      setBaTourismWeekContext(weekContext)

      // Initialize venue edits for unmatched venues (for optional use later)
      const hasUnmatched = data.some(e => e.venueMatch.matchType === 'none')
      if (hasUnmatched) {
        const edits = new Map<string, VenueEdit>()
        data
          .filter(e => e.venueMatch.matchType === 'none')
          .forEach(e => {
            const name = e.baTourism.venueName
            if (!edits.has(name)) {
              edits.set(name, {
                name,
                neighborhood: mapToNeighborhood(e.baTourism.neighborhood),
                skip: false,
              })
            }
          })
        setVenueEdits(edits)
      }

      // Select all events and go directly to select step
      setSelectedIds(new Set(data.map(e => `ba-tourism-${e.baTourism.name}`)))
      setStep('select')

      // Calculate total events including multi-date expansion
      const totalExpanded = data.reduce((sum, e) => sum + e.dateCount, 0)
      toast.success(`Found ${data.length} events (${totalExpanded} dates)`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch events')
      toast.error('Failed to fetch BA Tourism events')
    } finally {
      setIsFetching(false)
    }
  }, [])

  const fetchMeetupEventsHandler = useCallback(async () => {
    setIsFetching(true)
    setError(null)

    try {
      const { events: data } = await fetchMeetupEventsAction({
        data: { startDate, endDate },
      })

      setMeetupEvents(data)

      // Initialize venue edits for unmatched venues (for optional use later)
      const hasUnmatched = data.some(e => e.venueMatch.matchType === 'none')
      if (hasUnmatched) {
        const edits = new Map<string, VenueEdit>()
        data
          .filter(e => e.venueMatch.matchType === 'none')
          .forEach(e => {
            const name = e.meetup.venue?.name || 'Unknown Venue'
            if (!edits.has(name)) {
              edits.set(name, { name, neighborhood: null, skip: false })
            }
          })
        setVenueEdits(edits)
      }

      // Select all events and go directly to select step
      setSelectedIds(new Set(data.map(e => e.meetup.id)))
      setStep('select')

      // Calculate total events including recurring event expansion
      const totalExpanded = data.reduce((sum, e) => sum + e.dateCount, 0)
      toast.success(`Found ${data.length} events (${totalExpanded} occurrences)`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch events')
      toast.error('Failed to fetch Meetup events')
    } finally {
      setIsFetching(false)
    }
  }, [startDate, endDate])

  const handleCSVFile = useCallback((file: File) => {
    setCsvFileName(file.name)
    setError(null)

    Papa.parse<CSVRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const rows = results.data.map((row, index) => validateCSVRow(row, index + 2))
        setCsvRows(rows)

        // Auto-select all valid rows
        const validIds = rows
          .filter(r => r.errors.length === 0)
          .map((_, i) => `csv-${i}`)
        setSelectedIds(new Set(validIds))

        setStep('select')
        toast.success(`Parsed ${rows.length} rows from CSV`)
      },
      error: (error) => {
        console.error('CSV parsing error:', error)
        setError('Failed to parse CSV file')
        toast.error('Failed to parse CSV file')
      },
    })
  }, [validateCSVRow])

  const updateVenueEdit = useCallback((name: string, updates: Partial<VenueEdit>) => {
    setVenueEdits(prev => {
      const next = new Map(prev)
      const existing = next.get(name)
      if (existing) {
        next.set(name, { ...existing, ...updates })
      }
      return next
    })
  }, [])

  const venuesToCreateCount = useMemo(() => {
    let count = 0
    venueEdits.forEach(edit => {
      if (!edit.skip && !edit.mergeInto) count++
    })
    return count
  }, [venueEdits])

  const createVenuesAndProceed = useCallback(async () => {
    setIsCreatingVenues(true)
    setError(null)

    try {
      const venuesToCreate: { name: string; neighborhood: Neighborhood | null; type: 'other' }[] = []
      const mergeMap = new Map<string, string>()

      venueEdits.forEach((edit, originalName) => {
        if (edit.skip) return
        if (edit.mergeInto) {
          mergeMap.set(originalName, edit.mergeInto)
          return
        }
        venuesToCreate.push({ name: edit.name, neighborhood: edit.neighborhood, type: 'other' })
      })

      if (venuesToCreate.length > 0) {
        await bulkCreateVenuesAction({ data: venuesToCreate })
        toast.success(`Created ${venuesToCreate.length} venues`)
      }

      const updatedVenues = await listVenues()
      setVenues(updatedVenues.map(v => ({ id: v.id, name: v.name, neighborhood: v.neighborhood })))

      if (source === 'passline') {
        // Update Passline event venue matches
        setPasslineEvents(prev =>
          prev.map(event => {
            if (event.venueMatch.matchType !== 'none') return event

            const passlineName = event.passline.lugar
            const edit = venueEdits.get(passlineName)
            let targetName = passlineName
            if (edit?.mergeInto) targetName = edit.mergeInto

            const matchedVenue = updatedVenues.find(
              v => v.name.toLowerCase() === targetName.toLowerCase()
            )

            if (matchedVenue) {
              return {
                ...event,
                venueMatch: {
                  venue: matchedVenue,
                  matchType: 'exact' as const,
                  confidence: 1,
                  searchName: event.venueMatch.searchName,
                },
                transformed: { ...event.transformed, venue_id: matchedVenue.id },
              }
            }
            return event
          })
        )

        // Auto-select Passline events with matched venues
        setSelectedIds(new Set(
          passlineEvents
            .filter(e => e.venueMatch.matchType !== 'none' || !venueEdits.get(e.passline.lugar)?.skip)
            .map(e => e.passline.id)
        ))
      } else if (source === 'eventbrite') {
        // Update Eventbrite event venue matches
        setEventbriteEvents(prev =>
          prev.map(event => {
            if (event.venueMatch.matchType !== 'none') return event

            const eventbriteName = event.eventbrite.location?.name || ''
            const edit = venueEdits.get(eventbriteName)
            let targetName = eventbriteName
            if (edit?.mergeInto) targetName = edit.mergeInto

            const matchedVenue = updatedVenues.find(
              v => v.name.toLowerCase() === targetName.toLowerCase()
            )

            if (matchedVenue) {
              return {
                ...event,
                venueMatch: {
                  venue: matchedVenue,
                  matchType: 'exact' as const,
                  confidence: 1,
                  searchName: event.venueMatch.searchName,
                },
                transformed: { ...event.transformed, venue_id: matchedVenue.id },
              }
            }
            return event
          })
        )

        // Auto-select Eventbrite events with matched venues
        setSelectedIds(new Set(
          eventbriteEvents
            .filter(e => {
              const name = e.eventbrite.location?.name || ''
              return e.venueMatch.matchType !== 'none' || !venueEdits.get(name)?.skip
            })
            .map(e => e.eventbrite.url)
        ))
      } else if (source === 'ba-tourism') {
        // Update BA Tourism event venue matches
        setBaTourismEvents(prev =>
          prev.map(event => {
            if (event.venueMatch.matchType !== 'none') return event

            const baTourismName = event.baTourism.venueName
            const edit = venueEdits.get(baTourismName)
            let targetName = baTourismName
            if (edit?.mergeInto) targetName = edit.mergeInto

            const matchedVenue = updatedVenues.find(
              v => v.name.toLowerCase() === targetName.toLowerCase()
            )

            if (matchedVenue) {
              return {
                ...event,
                venueMatch: {
                  venue: matchedVenue,
                  matchType: 'exact' as const,
                  confidence: 1,
                  searchName: event.venueMatch.searchName,
                },
                transformed: event.transformed.map(t => ({ ...t, venue_id: matchedVenue.id })),
              }
            }
            return event
          })
        )

        // Auto-select BA Tourism events with matched venues
        setSelectedIds(new Set(
          baTourismEvents
            .filter(e => e.venueMatch.matchType !== 'none' || !venueEdits.get(e.baTourism.venueName)?.skip)
            .map(e => `ba-tourism-${e.baTourism.name}`)
        ))
      } else if (source === 'meetup') {
        // Update Meetup event venue matches
        setMeetupEvents(prev =>
          prev.map(event => {
            if (event.venueMatch.matchType !== 'none') return event

            const meetupName = event.meetup.venue?.name || ''
            const edit = venueEdits.get(meetupName)
            let targetName = meetupName
            if (edit?.mergeInto) targetName = edit.mergeInto

            const matchedVenue = updatedVenues.find(
              v => v.name.toLowerCase() === targetName.toLowerCase()
            )

            if (matchedVenue) {
              return {
                ...event,
                venueMatch: {
                  venue: matchedVenue,
                  matchType: 'exact' as const,
                  confidence: 1,
                  searchName: event.venueMatch.searchName,
                },
                transformed: event.transformed.map(t => ({ ...t, venue_id: matchedVenue.id })),
              }
            }
            return event
          })
        )

        // Auto-select Meetup events with matched venues
        setSelectedIds(new Set(
          meetupEvents
            .filter(e => {
              const name = e.meetup.venue?.name || ''
              return e.venueMatch.matchType !== 'none' || !venueEdits.get(name)?.skip
            })
            .map(e => e.meetup.id)
        ))
      }

      setStep('select')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create venues')
      toast.error('Failed to create venues')
    } finally {
      setIsCreatingVenues(false)
    }
  }, [source, venueEdits, passlineEvents, eventbriteEvents, baTourismEvents, meetupEvents])

  const skipVenues = useCallback(() => {
    if (source === 'passline') {
      // Auto-select only Passline events with matched venues
      setSelectedIds(new Set(
        passlineEvents
          .filter(e => e.venueMatch.matchType !== 'none')
          .map(e => e.passline.id)
      ))
    } else if (source === 'eventbrite') {
      // Auto-select only Eventbrite events with matched venues
      setSelectedIds(new Set(
        eventbriteEvents
          .filter(e => e.venueMatch.matchType !== 'none')
          .map(e => e.eventbrite.url)
      ))
    } else if (source === 'ba-tourism') {
      // Auto-select only BA Tourism events with matched venues
      setSelectedIds(new Set(
        baTourismEvents
          .filter(e => e.venueMatch.matchType !== 'none')
          .map(e => `ba-tourism-${e.baTourism.name}`)
      ))
    } else if (source === 'meetup') {
      // Auto-select only Meetup events with matched venues
      setSelectedIds(new Set(
        meetupEvents
          .filter(e => e.venueMatch.matchType !== 'none')
          .map(e => e.meetup.id)
      ))
    }
    setStep('select')
  }, [source, passlineEvents, eventbriteEvents, baTourismEvents, meetupEvents])

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const toggleSelectAll = useCallback(() => {
    if (source === 'passline') {
      if (selectedIds.size === passlineEvents.length) {
        setSelectedIds(new Set())
      } else {
        setSelectedIds(new Set(passlineEvents.map(e => e.passline.id)))
      }
    } else if (source === 'eventbrite') {
      if (selectedIds.size === eventbriteEvents.length) {
        setSelectedIds(new Set())
      } else {
        setSelectedIds(new Set(eventbriteEvents.map(e => e.eventbrite.url)))
      }
    } else if (source === 'ba-tourism') {
      if (selectedIds.size === baTourismEvents.length) {
        setSelectedIds(new Set())
      } else {
        setSelectedIds(new Set(baTourismEvents.map(e => `ba-tourism-${e.baTourism.name}`)))
      }
    } else if (source === 'meetup') {
      if (selectedIds.size === meetupEvents.length) {
        setSelectedIds(new Set())
      } else {
        setSelectedIds(new Set(meetupEvents.map(e => e.meetup.id)))
      }
    } else {
      const validIds = csvRows.filter(r => r.errors.length === 0).map((_, i) => `csv-${i}`)
      if (selectedIds.size === validIds.length) {
        setSelectedIds(new Set())
      } else {
        setSelectedIds(new Set(validIds))
      }
    }
  }, [source, passlineEvents, eventbriteEvents, baTourismEvents, meetupEvents, csvRows, selectedIds.size])

  const proceedToConfirm = useCallback(() => {
    setStep('confirm')
  }, [])

  const importEvents = useCallback(async () => {
    if (selectedIds.size === 0) return

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

      if (source === 'passline') {
        const selectedEvents = passlineEvents.filter(e => selectedIds.has(e.passline.id))
        const eventsToImport = selectedEvents.map(e => ({
          passlineEvent: e.passline,
          venueId: e.venueMatch.venue?.id || null,
        }))

        // Calculate quality stats from selected events
        withVenue = selectedEvents.filter(e => e.venueMatch.venue?.id).length
        withoutVenue = selectedEvents.length - withVenue
        // Passline events lack descriptions - all need enrichment
        withDescription = 0
        withoutDescription = selectedEvents.length
        // Passline events lack categories - all need enrichment
        withCategories = 0
        withoutCategories = selectedEvents.length

        const BATCH_SIZE = 10
        for (let i = 0; i < eventsToImport.length; i += BATCH_SIZE) {
          const batch = eventsToImport.slice(i, i + BATCH_SIZE)
          const result = await importPasslineEventsBatchAction({ data: { events: batch } })
          totalInserted += result.inserted
          totalUpdated += result.updated
          setImportProgress({ current: Math.min(i + BATCH_SIZE, eventsToImport.length), total: eventsToImport.length })
        }

        toast.success(`Imported ${totalInserted} new, ${totalUpdated} updated`)
      } else if (source === 'eventbrite') {
        const selectedEvents = eventbriteEvents.filter(e => selectedIds.has(e.eventbrite.url))
        const eventsToImport = selectedEvents.map(e => ({
          eventbriteEvent: e.eventbrite,
          venueId: e.venueMatch.venue?.id || null,
        }))

        // Calculate quality stats
        withVenue = selectedEvents.filter(e => e.venueMatch.venue?.id).length
        withoutVenue = selectedEvents.length - withVenue
        withDescription = selectedEvents.filter(e => e.eventbrite.description).length
        withoutDescription = selectedEvents.length - withDescription
        // Eventbrite lacks categories - need enrichment
        withCategories = 0
        withoutCategories = selectedEvents.length

        const BATCH_SIZE = 10
        for (let i = 0; i < eventsToImport.length; i += BATCH_SIZE) {
          const batch = eventsToImport.slice(i, i + BATCH_SIZE)
          const result = await importEventbriteEventsBatchAction({ data: { events: batch } })
          totalInserted += result.inserted
          totalUpdated += result.updated
          setImportProgress({ current: Math.min(i + BATCH_SIZE, eventsToImport.length), total: eventsToImport.length })
        }

        toast.success(`Imported ${totalInserted} new, ${totalUpdated} updated`)
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

        // Calculate quality stats
        withVenue = selectedEvents.filter(e => e.venueMatch.venue?.id).length
        withoutVenue = selectedEvents.length - withVenue
        withDescription = selectedEvents.filter(e => e.baTourism.description).length
        withoutDescription = selectedEvents.length - withDescription
        // BA Tourism has categories from the source
        withCategories = selectedEvents.length
        withoutCategories = 0

        const BATCH_SIZE = 10
        for (let i = 0; i < eventsToImport.length; i += BATCH_SIZE) {
          const batch = eventsToImport.slice(i, i + BATCH_SIZE)
          const result = await importBATourismEventsBatchAction({ data: { events: batch } })
          totalInserted += result.inserted
          totalUpdated += result.updated
          setImportProgress({ current: Math.min(i + BATCH_SIZE, eventsToImport.length), total: eventsToImport.length })
        }

        toast.success(`Imported ${totalInserted} new, ${totalUpdated} updated`)
      } else if (source === 'meetup') {
        const selectedEvents = meetupEvents.filter(e => selectedIds.has(e.meetup.id))
        const eventsToImport = selectedEvents.map(e => ({
          meetupEvent: e.meetup,
          venueId: e.venueMatch.venue?.id || null,
        }))

        // Calculate quality stats
        withVenue = selectedEvents.filter(e => e.venueMatch.venue?.id).length
        withoutVenue = selectedEvents.length - withVenue
        withDescription = selectedEvents.filter(e => e.meetup.description).length
        withoutDescription = selectedEvents.length - withDescription
        // Meetup lacks categories - need enrichment
        withCategories = 0
        withoutCategories = selectedEvents.length

        const BATCH_SIZE = 10
        for (let i = 0; i < eventsToImport.length; i += BATCH_SIZE) {
          const batch = eventsToImport.slice(i, i + BATCH_SIZE)
          const result = await importMeetupEventsBatchAction({ data: { events: batch } })
          totalInserted += result.inserted
          totalUpdated += result.updated
          setImportProgress({ current: Math.min(i + BATCH_SIZE, eventsToImport.length), total: eventsToImport.length })
        }

        toast.success(`Imported ${totalInserted} new, ${totalUpdated} updated`)

        // If we imported events without venues, go to enrich step for Meetup
        if (withoutVenue > 0 && totalInserted > 0) {
          setImportResult({
            inserted: totalInserted,
            updated: totalUpdated,
            withVenue,
            withoutVenue,
            withDescription,
            withoutDescription,
            withCategories,
            withoutCategories,
          })
          setIsImporting(false)
          setImportProgress(null)
          setStep('enrich')
          return
        }
      } else {
        const events = csvRows
          .filter((_, i) => selectedIds.has(`csv-${i}`))
          .filter(r => r.event)
          .map(r => r.event!)

        // CSV quality stats
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

      // Set import result and go to summary step
      setImportResult({
        inserted: totalInserted,
        updated: totalUpdated,
        withVenue,
        withoutVenue,
        withDescription,
        withoutDescription,
        withCategories,
        withoutCategories,
      })
      track('admin:import_completed', {
        source,
        inserted: totalInserted,
        updated: totalUpdated,
        with_venue: withVenue,
        without_venue: withoutVenue,
      })
      setStep('summary')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import events')
      toast.error('Import failed')
    } finally {
      setIsImporting(false)
      setImportProgress(null)
    }
  }, [source, selectedIds, passlineEvents, eventbriteEvents, baTourismEvents, baTourismWeekContext, meetupEvents, csvRows])

  // Fetch events needing enrichment when entering enrich step
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

      const result = await enrichMeetupVenuesAction({ data: { events } })

      setEnrichmentResult({
        enriched: result.enriched,
        venuesCreated: result.venuesCreated,
        errors: result.errors,
      })

      if (result.enriched > 0) {
        toast.success(`Enriched ${result.enriched} events with venue data`)
      }

      // Navigate to events page after a short delay
      setTimeout(() => {
        router.navigate({ to: '/admin/events' })
      }, 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to enrich venues')
      toast.error('Venue enrichment failed')
    } finally {
      setIsEnriching(false)
      setEnrichmentProgress(null)
    }
  }, [eventsNeedingEnrichment, router])

  const skipEnrichment = useCallback(() => {
    router.navigate({ to: '/admin/events' })
  }, [router])

  const goToVenues = useCallback(() => {
    if (unmatchedVenues.length > 0) {
      setStep('venues')
    }
  }, [unmatchedVenues.length])

  const goBack = useCallback(() => {
    if (step === 'configure') {
      setStep('source')
      setSource(null)
    } else if (step === 'venues') {
      // Go back to select step (venues is now optional)
      setStep('select')
    } else if (step === 'select') {
      // Always go back to configure from select
      setStep('configure')
    } else if (step === 'confirm') {
      setStep('select')
    } else if (step === 'enrich') {
      // Don't allow going back from enrich step - events are already imported
      // User can skip or complete enrichment
    }
  }, [step])

  const reset = useCallback(() => {
    setStep('source')
    setSource(null)
    setPasslineEvents([])
    setEventbriteEvents([])
    setBaTourismEvents([])
    setBaTourismWeekContext(null)
    setMeetupEvents([])
    setCsvRows([])
    setCsvFileName(null)
    setVenueEdits(new Map())
    setSelectedIds(new Set())
    setError(null)
    // Reset enrichment state
    setIsEnriching(false)
    setEnrichmentProgress(null)
    setEnrichmentResult(null)
    setEventsNeedingEnrichment([])
    // Reset import result state
    setImportResult(null)
    setAutoEnrich(false)
  }, [])

  return {
    // State
    step,
    source,
    startDate,
    endDate,
    passlineEvents,
    eventbriteEvents,
    baTourismEvents,
    meetupEvents,
    csvRows,
    csvFileName,
    venues,
    venueEdits,
    unmatchedVenues,
    similarVenues,
    selectedIds,
    venuesToCreateCount,
    csvValidCount,
    csvErrorCount,
    csvAllValid,
    isFetching,
    isCreatingVenues,
    isImporting,
    importProgress,
    error,

    // Enrichment state
    isEnriching,
    enrichmentProgress,
    enrichmentResult,
    eventsNeedingEnrichment,
    isLoadingEnrichmentEvents,

    // Import result state (for summary step)
    importResult,
    autoEnrich,

    // Actions
    selectSource,
    setStartDate,
    setEndDate,
    fetchPasslineEvents: fetchPasslineEventsHandler,
    fetchEventbriteEvents: fetchEventbriteEventsHandler,
    fetchBaTourismEvents: fetchBaTourismEventsHandler,
    fetchMeetupEvents: fetchMeetupEventsHandler,
    handleCSVFile,
    updateVenueEdit,
    createVenuesAndProceed,
    skipVenues,
    toggleSelect,
    toggleSelectAll,
    proceedToConfirm,
    importEvents,
    goToVenues,
    goBack,
    reset,

    // Enrichment actions
    fetchEventsNeedingEnrichment,
    enrichVenues,
    skipEnrichment,

    // Summary step actions
    setAutoEnrich,
  }
}

export type UseImportWizardReturn = ReturnType<typeof useImportWizard>
