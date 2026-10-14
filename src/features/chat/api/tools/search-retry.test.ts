import { describe, expect, it } from 'vitest'
import { searchRetryBoundary, widenedSearchConstraints, type SearchRetryBoundary } from './search-retry.ts'
import { frozenSearchIntent } from '../../../../../evals/concierge/frozen-corpus.ts'

const original: SearchRetryBoundary = {
  must: { neighborhoodIds: ['Palermo', 'San Telmo'], venueIds: ['venue-1', 'venue-2'],
    categories: ['Music', 'Art'], isFree: true, maxPrice: 10000, attendeeAge: 18,
    startsAfter: '2026-10-13T21:00:00Z', startsBefore: '2026-10-14T09:00:00Z' },
  excludedGenres: ['techno'], happeningNow: false,
}

describe('effective hard constraints on search retries', () => {
  it('allows equivalent ordering and stricter filters without relaxing the original scope', () => {
    const next = structuredClone(original)
    next.must.neighborhoodIds = ['San Telmo', 'Palermo']
    next.must.venueIds = ['venue-2']
    next.must.categories = ['Music']
    next.must.maxPrice = 5000
    next.must.attendeeAge = 17
    next.must.startsAfter = '2026-10-13T22:00:00Z'
    next.must.startsBefore = '2026-10-14T08:00:00Z'
    next.excludedGenres.push('house')
    expect(widenedSearchConstraints(original, next)).toEqual([])
  })

  it('rejects removing each hard constraint and increasing budget or attendee age', () => {
    for (const key of ['neighborhoodIds', 'venueIds', 'categories', 'isFree', 'maxPrice', 'attendeeAge', 'startsAfter', 'startsBefore'] as const) {
      const next = structuredClone(original)
      delete next.must[key]
      expect(widenedSearchConstraints(original, next).length).toBeGreaterThan(0)
    }
    const next = structuredClone(original)
    next.must.maxPrice = 10001
    next.must.attendeeAge = 19
    next.excludedGenres = []
    expect(widenedSearchConstraints(original, next)).toEqual(['maxPrice', 'attendeeAge', 'excludedGenres'])
  })

  it('rejects extending categorical scope or replacing a nonempty filter with an empty list', () => {
    for (const key of ['neighborhoodIds', 'venueIds', 'categories'] as const) {
      const next = structuredClone(original)
      next.must[key] = []
      expect(widenedSearchConstraints(original, next)).toContain(key)
    }
    expect(widenedSearchConstraints(original, { ...original, must: { ...original.must, neighborhoodIds: ['Recoleta'] } })).toContain('neighborhoodIds')
  })

  it('preserves disjoint windows instead of accepting a hull across unrequested days', () => {
    const previous: SearchRetryBoundary = { must: { weekdayWindows: [
      { startsAfter: '2026-10-13T03:00:00Z', startsBefore: '2026-10-14T03:00:00Z' },
      { startsAfter: '2026-10-15T03:00:00Z', startsBefore: '2026-10-16T03:00:00Z' },
    ] }, excludedGenres: [], happeningNow: false }
    const hull = { ...previous, must: { startsAfter: '2026-10-13T03:00:00Z', startsBefore: '2026-10-16T03:00:00Z' } }
    expect(widenedSearchConstraints(previous, hull)).toEqual(['dates'])
    expect(widenedSearchConstraints(previous, { ...previous, must: { weekdayWindows: previous.must.weekdayWindows!.slice(1) } })).toEqual([])
    expect(widenedSearchConstraints(hull, previous)).toEqual([])
  })

  it('preserves unknown venue and happening-now boundaries, and rejects malformed temporal evidence', () => {
    const previous: SearchRetryBoundary = { must: { venueIds: [] }, excludedGenres: [], happeningNow: true, unresolvedVenueName: 'Unknown venue' }
    expect(widenedSearchConstraints(previous, structuredClone(previous))).toEqual([])
    expect(widenedSearchConstraints(previous, { must: {}, excludedGenres: [], happeningNow: false })).toEqual(['venueIds', 'happeningNow', 'venueName'])
    expect(widenedSearchConstraints(original, { ...original, must: { ...original.must, startsAfter: 'invalid' } })).toContain('dates')
  })

  it('compares canonical query-derived constraints and clones captured intent', async () => {
    const input = { query: 'free events in Palermo tonight', timeFilter: 'tonight' as const }
    const intent = await frozenSearchIntent(input)
    const boundary = searchRetryBoundary(intent, input)
    expect(boundary.must).toMatchObject({ isFree: true, neighborhoodIds: ['Palermo'] })
    intent.must.neighborhoodIds?.push('Recoleta')
    expect(boundary.must.neighborhoodIds).toEqual(['Palermo'])
    const broadened = searchRetryBoundary(await frozenSearchIntent({ timeFilter: 'tonight' }), { timeFilter: 'tonight' })
    expect(widenedSearchConstraints(boundary, broadened)).toEqual(['neighborhoodIds', 'isFree'])
    expect(widenedSearchConstraints(undefined, broadened)).toEqual([])
  })
})
