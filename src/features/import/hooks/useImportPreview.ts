import { useState, useCallback, useMemo } from 'react'
import { compareTwoStrings } from 'string-similarity'
import type {
  PasslinePreviewEvent,
  EventbritePreviewEvent,
  BATourismPreviewEvent,
  MeetupPreviewEvent,
  LumaPreviewEvent,
} from '@/features/import'
import {
  passlineAdapter,
  eventbriteAdapter,
  baTourismAdapter,
  meetupAdapter,
  lumaAdapter,
} from '../adapters'
import {
  getUnmatchedVenues as getUnmatchedVenuesHelper,
  getAllEventIds,
  getMatchedEventIds,
} from './helpers'
import type { ImportSource, ParsedCSVRow } from './useImportSource'

interface UnmatchedVenue {
  name: string
  count: number
  eventIds: string[]
}

export interface UseImportPreviewReturn {
  // State
  selectedIds: Set<string>
  unmatchedVenues: UnmatchedVenue[]
  similarVenues: Map<string, Array<{ name: string; similarity: number }>>

  // Actions
  setSelectedIds: (ids: Set<string>) => void
  toggleSelect: (id: string) => void
  toggleSelectAll: (
    source: ImportSource | null,
    passlineEvents: PasslinePreviewEvent[],
    eventbriteEvents: EventbritePreviewEvent[],
    baTourismEvents: BATourismPreviewEvent[],
    meetupEvents: MeetupPreviewEvent[],
    lumaEvents: LumaPreviewEvent[],
    csvRows: ParsedCSVRow[]
  ) => void
  selectMatchedOnly: (
    source: ImportSource | null,
    passlineEvents: PasslinePreviewEvent[],
    eventbriteEvents: EventbritePreviewEvent[],
    baTourismEvents: BATourismPreviewEvent[],
    meetupEvents: MeetupPreviewEvent[],
    lumaEvents: LumaPreviewEvent[]
  ) => void
  computeUnmatchedVenues: (
    source: ImportSource | null,
    passlineEvents: PasslinePreviewEvent[],
    eventbriteEvents: EventbritePreviewEvent[],
    baTourismEvents: BATourismPreviewEvent[],
    meetupEvents: MeetupPreviewEvent[],
    lumaEvents: LumaPreviewEvent[]
  ) => UnmatchedVenue[]
  reset: () => void
}

export function useImportPreview(): UseImportPreviewReturn {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [unmatchedVenues, setUnmatchedVenues] = useState<UnmatchedVenue[]>([])

  // Find similar venue names using fuzzy string matching for merge suggestions
  const similarVenues = useMemo(() => {
    const similar = new Map<string, Array<{ name: string; similarity: number }>>()
    const names = unmatchedVenues.map(v => v.name)
    const SIMILARITY_THRESHOLD = 0.6

    for (let i = 0; i < names.length; i++) {
      const matches: Array<{ name: string; similarity: number }> = []

      for (let j = i + 1; j < names.length; j++) {
        const similarity = compareTwoStrings(
          names[i].toLowerCase().trim(),
          names[j].toLowerCase().trim()
        )

        if (similarity >= SIMILARITY_THRESHOLD) {
          matches.push({ name: names[j], similarity })
        }
      }

      if (matches.length > 0) {
        similar.set(names[i], matches.sort((a, b) => b.similarity - a.similarity))
      }
    }
    return similar
  }, [unmatchedVenues])

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

  const toggleSelectAll = useCallback((
    source: ImportSource | null,
    passlineEvents: PasslinePreviewEvent[],
    eventbriteEvents: EventbritePreviewEvent[],
    baTourismEvents: BATourismPreviewEvent[],
    meetupEvents: MeetupPreviewEvent[],
    lumaEvents: LumaPreviewEvent[],
    csvRows: ParsedCSVRow[]
  ) => {
    let allIds: Set<string> | null = null
    let eventCount = 0

    if (source === 'passline') {
      allIds = getAllEventIds(passlineEvents, passlineAdapter)
      eventCount = passlineEvents.length
    } else if (source === 'eventbrite') {
      allIds = getAllEventIds(eventbriteEvents, eventbriteAdapter)
      eventCount = eventbriteEvents.length
    } else if (source === 'ba-tourism') {
      allIds = getAllEventIds(baTourismEvents, baTourismAdapter)
      eventCount = baTourismEvents.length
    } else if (source === 'meetup') {
      allIds = getAllEventIds(meetupEvents, meetupAdapter)
      eventCount = meetupEvents.length
    } else if (source === 'luma') {
      allIds = getAllEventIds(lumaEvents, lumaAdapter)
      eventCount = lumaEvents.length
    } else if (source === 'csv') {
      const validIds = csvRows.filter(r => r.errors.length === 0).map((_, i) => `csv-${i}`)
      setSelectedIds(prev => {
        if (prev.size === validIds.length) {
          return new Set()
        }
        return new Set(validIds)
      })
      return
    }

    if (allIds) {
      setSelectedIds(prev => {
        if (prev.size === eventCount) {
          return new Set()
        }
        return allIds!
      })
    }
  }, [])

  const selectMatchedOnly = useCallback((
    source: ImportSource | null,
    passlineEvents: PasslinePreviewEvent[],
    eventbriteEvents: EventbritePreviewEvent[],
    baTourismEvents: BATourismPreviewEvent[],
    meetupEvents: MeetupPreviewEvent[],
    lumaEvents: LumaPreviewEvent[]
  ) => {
    if (source === 'passline') {
      setSelectedIds(getMatchedEventIds(passlineEvents, passlineAdapter))
    } else if (source === 'eventbrite') {
      setSelectedIds(getMatchedEventIds(eventbriteEvents, eventbriteAdapter))
    } else if (source === 'ba-tourism') {
      setSelectedIds(getMatchedEventIds(baTourismEvents, baTourismAdapter))
    } else if (source === 'meetup') {
      setSelectedIds(getMatchedEventIds(meetupEvents, meetupAdapter))
    } else if (source === 'luma') {
      setSelectedIds(getMatchedEventIds(lumaEvents, lumaAdapter))
    }
  }, [])

  const computeUnmatchedVenues = useCallback((
    source: ImportSource | null,
    passlineEvents: PasslinePreviewEvent[],
    eventbriteEvents: EventbritePreviewEvent[],
    baTourismEvents: BATourismPreviewEvent[],
    meetupEvents: MeetupPreviewEvent[],
    lumaEvents: LumaPreviewEvent[]
  ): UnmatchedVenue[] => {
    if (!source || source === 'csv') {
      setUnmatchedVenues([])
      return []
    }

    let result: UnmatchedVenue[] = []

    if (source === 'passline') {
      result = getUnmatchedVenuesHelper(passlineEvents, passlineAdapter)
    } else if (source === 'eventbrite') {
      result = getUnmatchedVenuesHelper(eventbriteEvents, eventbriteAdapter)
    } else if (source === 'ba-tourism') {
      result = getUnmatchedVenuesHelper(baTourismEvents, baTourismAdapter)
    } else if (source === 'meetup') {
      result = getUnmatchedVenuesHelper(meetupEvents, meetupAdapter)
    } else if (source === 'luma') {
      result = getUnmatchedVenuesHelper(lumaEvents, lumaAdapter)
    }

    setUnmatchedVenues(result)
    return result
  }, [])

  const reset = useCallback(() => {
    setSelectedIds(new Set())
    setUnmatchedVenues([])
  }, [])

  return {
    // State
    selectedIds,
    unmatchedVenues,
    similarVenues,

    // Actions
    setSelectedIds,
    toggleSelect,
    toggleSelectAll,
    selectMatchedOnly,
    computeUnmatchedVenues,
    reset,
  }
}
