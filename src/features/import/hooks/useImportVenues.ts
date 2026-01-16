import { useState, useCallback, useMemo } from 'react'
import { toast } from 'sonner'
import type {
  PasslinePreviewEvent,
  EventbritePreviewEvent,
  BATourismPreviewEvent,
  MeetupPreviewEvent,
  LumaPreviewEvent,
} from '@/features/import'
import { bulkCreateVenuesAction, listVenues } from '@/features/venues/api/crud'
import type { Neighborhood, Venue } from '@/shared/lib/types'
import type { ImportSource } from './useImportSource'

type VenueAction = 'create' | 'merge' | 'skip'

export interface VenueEdit {
  name: string
  neighborhood: Neighborhood | null
  action: VenueAction
  mergeInto?: string
}

interface UnmatchedVenue {
  name: string
  count: number
  eventIds: string[]
}

export interface UseImportVenuesReturn {
  // State
  venues: { id: string; name: string; neighborhood: string | null }[]
  venueEdits: Map<string, VenueEdit>
  venueNameToId: Map<string, string>
  venuesToCreateCount: number
  isCreatingVenues: boolean

  // Actions
  setVenues: (venues: { id: string; name: string; neighborhood: string | null }[]) => void
  setVenueEdits: (edits: Map<string, VenueEdit>) => void
  updateVenueEdit: (name: string, updates: Partial<VenueEdit>) => void
  createVenuesAndProceed: (
    source: ImportSource | null,
    passlineEvents: PasslinePreviewEvent[],
    eventbriteEvents: EventbritePreviewEvent[],
    baTourismEvents: BATourismPreviewEvent[],
    meetupEvents: MeetupPreviewEvent[],
    lumaEvents: LumaPreviewEvent[]
  ) => Promise<{
    updatedVenues: Venue[]
    passlineEvents?: PasslinePreviewEvent[]
    eventbriteEvents?: EventbritePreviewEvent[]
    baTourismEvents?: BATourismPreviewEvent[]
    meetupEvents?: MeetupPreviewEvent[]
    lumaEvents?: LumaPreviewEvent[]
    selectedIds: Set<string>
  }>
  createAllVenuesAndProceed: (
    source: ImportSource | null,
    unmatchedVenues: UnmatchedVenue[],
    passlineEvents: PasslinePreviewEvent[],
    eventbriteEvents: EventbritePreviewEvent[],
    baTourismEvents: BATourismPreviewEvent[],
    meetupEvents: MeetupPreviewEvent[],
    lumaEvents: LumaPreviewEvent[]
  ) => Promise<{
    updatedVenues: Venue[]
    passlineEvents?: PasslinePreviewEvent[]
    eventbriteEvents?: EventbritePreviewEvent[]
    baTourismEvents?: BATourismPreviewEvent[]
    meetupEvents?: MeetupPreviewEvent[]
    lumaEvents?: LumaPreviewEvent[]
  }>
  reset: () => void
}

export function useImportVenues(
  initialVenues: { id: string; name: string; neighborhood: string | null }[]
): UseImportVenuesReturn {
  const [venues, setVenues] = useState(initialVenues)
  const [venueEdits, setVenueEdits] = useState<Map<string, VenueEdit>>(new Map())
  const [isCreatingVenues, setIsCreatingVenues] = useState(false)

  // Venue name to ID lookup
  const venueNameToId = useMemo(() => {
    const map = new Map<string, string>()
    venues.forEach(v => map.set(v.name.toLowerCase(), v.id))
    return map
  }, [venues])

  const venuesToCreateCount = useMemo(() => {
    let count = 0
    venueEdits.forEach(edit => {
      if (edit.action === 'create') count++
    })
    return count
  }, [venueEdits])

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

  // Helper to update events with venue matches
  function updateEventVenueMatches<T extends { venueMatch: { matchType: string; searchName: string; venue?: { id: string } | null } }>(
    events: T[],
    getVenueName: (e: T) => string,
    updateEvent: (e: T, venue: Venue) => T,
    updatedVenues: Venue[],
    edits: Map<string, VenueEdit>
  ): T[] {
    return events.map(event => {
      if (event.venueMatch.matchType !== 'none') return event

      const venueName = getVenueName(event)
      const edit = edits.get(venueName)
      let targetName = venueName
      if (edit?.mergeInto) targetName = edit.mergeInto

      const matchedVenue = updatedVenues.find(
        v => v.name.toLowerCase() === targetName.toLowerCase()
      )

      if (matchedVenue) {
        return updateEvent(event, matchedVenue)
      }
      return event
    })
  }

  const createVenuesAndProceed = useCallback(async (
    source: ImportSource | null,
    passlineEvents: PasslinePreviewEvent[],
    eventbriteEvents: EventbritePreviewEvent[],
    baTourismEvents: BATourismPreviewEvent[],
    meetupEvents: MeetupPreviewEvent[],
    lumaEvents: LumaPreviewEvent[]
  ) => {
    setIsCreatingVenues(true)

    try {
      const venuesToCreate: { name: string; neighborhood: Neighborhood | null; type: 'other' }[] = []

      venueEdits.forEach((edit) => {
        if (edit.action !== 'create') return
        venuesToCreate.push({ name: edit.name, neighborhood: edit.neighborhood, type: 'other' })
      })

      if (venuesToCreate.length > 0) {
        await bulkCreateVenuesAction({ data: venuesToCreate })
        toast.success(`Created ${venuesToCreate.length} venues`)
      }

      const updatedVenues = await listVenues()
      setVenues(updatedVenues.map(v => ({ id: v.id, name: v.name, neighborhood: v.neighborhood })))

      let updatedPasslineEvents: PasslinePreviewEvent[] | undefined
      let updatedEventbriteEvents: EventbritePreviewEvent[] | undefined
      let updatedBaTourismEvents: BATourismPreviewEvent[] | undefined
      let updatedMeetupEvents: MeetupPreviewEvent[] | undefined
      let updatedLumaEvents: LumaPreviewEvent[] | undefined
      let selectedIds = new Set<string>()

      if (source === 'passline') {
        updatedPasslineEvents = updateEventVenueMatches(
          passlineEvents,
          e => e.passline.lugar,
          (e, venue) => ({
            ...e,
            venueMatch: { venue, matchType: 'exact' as const, confidence: 1, searchName: e.venueMatch.searchName },
            transformed: { ...e.transformed, venue_id: venue.id },
          }),
          updatedVenues,
          venueEdits
        )
        selectedIds = new Set(
          passlineEvents
            .filter(e => e.venueMatch.matchType !== 'none' || venueEdits.get(e.passline.lugar)?.action !== 'skip')
            .map(e => e.passline.id)
        )
      } else if (source === 'eventbrite') {
        updatedEventbriteEvents = updateEventVenueMatches(
          eventbriteEvents,
          e => e.eventbrite.location?.name || '',
          (e, venue) => ({
            ...e,
            venueMatch: { venue, matchType: 'exact' as const, confidence: 1, searchName: e.venueMatch.searchName },
            transformed: { ...e.transformed, venue_id: venue.id },
          }),
          updatedVenues,
          venueEdits
        )
        selectedIds = new Set(
          eventbriteEvents
            .filter(e => {
              const name = e.eventbrite.location?.name || ''
              return e.venueMatch.matchType !== 'none' || venueEdits.get(name)?.action !== 'skip'
            })
            .map(e => e.eventbrite.url)
        )
      } else if (source === 'ba-tourism') {
        updatedBaTourismEvents = updateEventVenueMatches(
          baTourismEvents,
          e => e.baTourism.venueName,
          (e, venue) => ({
            ...e,
            venueMatch: { venue, matchType: 'exact' as const, confidence: 1, searchName: e.venueMatch.searchName },
            transformed: e.transformed.map(t => ({ ...t, venue_id: venue.id })),
          }),
          updatedVenues,
          venueEdits
        )
        selectedIds = new Set(
          baTourismEvents
            .filter(e => e.venueMatch.matchType !== 'none' || venueEdits.get(e.baTourism.venueName)?.action !== 'skip')
            .map(e => `ba-tourism-${e.baTourism.name}`)
        )
      } else if (source === 'meetup') {
        updatedMeetupEvents = updateEventVenueMatches(
          meetupEvents,
          e => e.meetup.venue?.name || '',
          (e, venue) => ({
            ...e,
            venueMatch: { venue, matchType: 'exact' as const, confidence: 1, searchName: e.venueMatch.searchName },
            transformed: e.transformed.map(t => ({ ...t, venue_id: venue.id })),
          }),
          updatedVenues,
          venueEdits
        )
        selectedIds = new Set(
          meetupEvents
            .filter(e => {
              const name = e.meetup.venue?.name || ''
              return e.venueMatch.matchType !== 'none' || venueEdits.get(name)?.action !== 'skip'
            })
            .map(e => e.meetup.id)
        )
      } else if (source === 'luma') {
        updatedLumaEvents = updateEventVenueMatches(
          lumaEvents,
          e => e.luma.venue?.name || '',
          (e, venue) => ({
            ...e,
            venueMatch: { venue, matchType: 'exact' as const, confidence: 1, searchName: e.venueMatch.searchName },
            transformed: { ...e.transformed, venue_id: venue.id },
          }),
          updatedVenues,
          venueEdits
        )
        selectedIds = new Set(
          lumaEvents
            .filter(e => {
              const name = e.luma.venue?.name || ''
              return e.venueMatch.matchType !== 'none' || venueEdits.get(name)?.action !== 'skip'
            })
            .map(e => e.luma.api_id)
        )
      }

      return {
        updatedVenues,
        passlineEvents: updatedPasslineEvents,
        eventbriteEvents: updatedEventbriteEvents,
        baTourismEvents: updatedBaTourismEvents,
        meetupEvents: updatedMeetupEvents,
        lumaEvents: updatedLumaEvents,
        selectedIds,
      }
    } finally {
      setIsCreatingVenues(false)
    }
  }, [venueEdits])

  const createAllVenuesAndProceed = useCallback(async (
    source: ImportSource | null,
    unmatchedVenues: UnmatchedVenue[],
    passlineEvents: PasslinePreviewEvent[],
    eventbriteEvents: EventbritePreviewEvent[],
    baTourismEvents: BATourismPreviewEvent[],
    meetupEvents: MeetupPreviewEvent[],
    lumaEvents: LumaPreviewEvent[]
  ) => {
    setIsCreatingVenues(true)

    try {
      const venuesToCreate: { name: string; neighborhood: Neighborhood | null; type: 'other' }[] = []

      for (const venue of unmatchedVenues) {
        venuesToCreate.push({ name: venue.name, neighborhood: null, type: 'other' })
      }

      if (venuesToCreate.length > 0) {
        await bulkCreateVenuesAction({ data: venuesToCreate })
        toast.success(`Created ${venuesToCreate.length} venues`)
      }

      const updatedVenues = await listVenues()
      setVenues(updatedVenues.map(v => ({ id: v.id, name: v.name, neighborhood: v.neighborhood })))

      let updatedPasslineEvents: PasslinePreviewEvent[] | undefined
      let updatedEventbriteEvents: EventbritePreviewEvent[] | undefined
      let updatedBaTourismEvents: BATourismPreviewEvent[] | undefined
      let updatedMeetupEvents: MeetupPreviewEvent[] | undefined
      let updatedLumaEvents: LumaPreviewEvent[] | undefined

      // Helper for direct name matching (no edits)
      function updateEventsDirectMatch<T extends { venueMatch: { matchType: string; searchName: string } }>(
        events: T[],
        getVenueName: (e: T) => string,
        updateEvent: (e: T, venue: Venue) => T
      ): T[] {
        return events.map(event => {
          if (event.venueMatch.matchType !== 'none') return event

          const venueName = getVenueName(event)
          const matchedVenue = updatedVenues.find(
            v => v.name.toLowerCase() === venueName.toLowerCase()
          )

          if (matchedVenue) {
            return updateEvent(event, matchedVenue)
          }
          return event
        })
      }

      if (source === 'passline') {
        updatedPasslineEvents = updateEventsDirectMatch(
          passlineEvents,
          e => e.passline.lugar,
          (e, venue) => ({
            ...e,
            venueMatch: { venue, matchType: 'exact' as const, confidence: 1, searchName: e.venueMatch.searchName },
            transformed: { ...e.transformed, venue_id: venue.id },
          })
        )
      } else if (source === 'eventbrite') {
        updatedEventbriteEvents = updateEventsDirectMatch(
          eventbriteEvents,
          e => e.eventbrite.location?.name || '',
          (e, venue) => ({
            ...e,
            venueMatch: { venue, matchType: 'exact' as const, confidence: 1, searchName: e.venueMatch.searchName },
            transformed: { ...e.transformed, venue_id: venue.id },
          })
        )
      } else if (source === 'ba-tourism') {
        updatedBaTourismEvents = updateEventsDirectMatch(
          baTourismEvents,
          e => e.baTourism.venueName,
          (e, venue) => ({
            ...e,
            venueMatch: { venue, matchType: 'exact' as const, confidence: 1, searchName: e.venueMatch.searchName },
            transformed: e.transformed.map(t => ({ ...t, venue_id: venue.id })),
          })
        )
      } else if (source === 'meetup') {
        updatedMeetupEvents = updateEventsDirectMatch(
          meetupEvents,
          e => e.meetup.venue?.name || '',
          (e, venue) => ({
            ...e,
            venueMatch: { venue, matchType: 'exact' as const, confidence: 1, searchName: e.venueMatch.searchName },
            transformed: e.transformed.map(t => ({ ...t, venue_id: venue.id })),
          })
        )
      } else if (source === 'luma') {
        updatedLumaEvents = updateEventsDirectMatch(
          lumaEvents,
          e => e.luma.venue?.name || '',
          (e, venue) => ({
            ...e,
            venueMatch: { venue, matchType: 'exact' as const, confidence: 1, searchName: e.venueMatch.searchName },
            transformed: { ...e.transformed, venue_id: venue.id },
          })
        )
      }

      return {
        updatedVenues,
        passlineEvents: updatedPasslineEvents,
        eventbriteEvents: updatedEventbriteEvents,
        baTourismEvents: updatedBaTourismEvents,
        meetupEvents: updatedMeetupEvents,
        lumaEvents: updatedLumaEvents,
      }
    } finally {
      setIsCreatingVenues(false)
    }
  }, [])

  const reset = useCallback(() => {
    setVenues(initialVenues)
    setVenueEdits(new Map())
  }, [initialVenues])

  return {
    // State
    venues,
    venueEdits,
    venueNameToId,
    venuesToCreateCount,
    isCreatingVenues,

    // Actions
    setVenues,
    setVenueEdits,
    updateVenueEdit,
    createVenuesAndProceed,
    createAllVenuesAndProceed,
    reset,
  }
}
