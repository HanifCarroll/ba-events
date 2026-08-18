import { describe, expect, it } from 'vitest'
import {
  classifyPasslineEvent,
  type ExistingPasslineEvent,
  type VenueSettlement,
} from './passline-classify.ts'
import { EMPTY_FACETS } from '#shared/lib/search-facets.ts'
import type { EventInsert } from '#shared/lib/types.ts'

const baseExisting: ExistingPasslineEvent = {
  id: 'row-1',
  external_id: '1',
  name: 'Test Event',
  starts_at: '2026-08-15T20:00:00.000Z',
  ends_at: null,
  is_all_day: false,
  venue_id: 'venue-1',
  price: null,
  is_free: true,
  time_tba: true,
  ticket_url: 'https://passline.example/event/1',
  location_tba: false,
  image_url: null,
  link: 'https://passline.example/event/1',
  description_es: 'Stored Spanish description',
  description_en: null,
  categories: ['music'],
  facets: EMPTY_FACETS,
}

function incoming(overrides: Partial<EventInsert> = {}): EventInsert {
  return {
    name: 'Test Event',
    starts_at: '2026-08-15T20:00:00.000Z',
    ends_at: null,
    is_all_day: false,
    venue_id: 'venue-1',
    price: null,
    is_free: true,
    time_tba: true,
    ticket_url: 'https://passline.example/event/1',
    location_tba: false,
    image_url: null,
    link: 'https://passline.example/event/1',
    source: 'passline',
    external_id: '1',
    ...overrides,
  }
}

const resolved = (venueId: string): VenueSettlement => ({ kind: 'resolved', venueId })
const placeholder: VenueSettlement = { kind: 'placeholder' }
const unresolved: VenueSettlement = { kind: 'unresolved' }

describe('classifyPasslineEvent', () => {
  it('classifies an identical event as unchanged', () => {
    expect(classifyPasslineEvent(incoming(), baseExisting, resolved('venue-1'))).toEqual({
      kind: 'unchanged',
    })
  })

  it('classifies a time_tba flip as mutable-only', () => {
    expect(classifyPasslineEvent(incoming({ time_tba: false }), baseExisting, resolved('venue-1'))).toEqual({
      kind: 'mutable-only',
    })
  })

  it('classifies an is_all_day flip as mutable-only', () => {
    expect(classifyPasslineEvent(incoming({ is_all_day: true }), baseExisting, resolved('venue-1'))).toEqual({
      kind: 'mutable-only',
    })
  })

  it('classifies a ticket_url change as mutable-only', () => {
    expect(
      classifyPasslineEvent(
        incoming({ ticket_url: 'https://passline.example/event/new' }),
        baseExisting,
        resolved('venue-1')
      )
    ).toEqual({ kind: 'mutable-only' })
  })

  it('classifies a name change as name-changed', () => {
    expect(
      classifyPasslineEvent(incoming({ name: 'Renamed Event' }), baseExisting, resolved('venue-1'))
    ).toEqual({ kind: 'name-changed' })
  })

  it('classifies a price change as search-input-changed', () => {
    expect(
      classifyPasslineEvent(incoming({ price: 5000, is_free: false }), baseExisting, resolved('venue-1'))
    ).toEqual({ kind: 'search-input-changed' })
  })

  it('classifies a settled venue change as search-input-changed', () => {
    expect(classifyPasslineEvent(incoming({ venue_id: 'venue-2' }), baseExisting, resolved('venue-2'))).toEqual({
      kind: 'search-input-changed',
    })
  })

  it('preserves the existing venue when settlement is unresolved', () => {
    expect(classifyPasslineEvent(incoming(), baseExisting, unresolved)).toEqual({ kind: 'unchanged' })
  })

  it('clears an existing venue when settlement is an explicit placeholder', () => {
    expect(classifyPasslineEvent(incoming(), baseExisting, placeholder)).toEqual({
      kind: 'search-input-changed',
    })
  })

  it('does not flag a placeholder as a change when no existing venue is set', () => {
    const noVenue = { ...baseExisting, venue_id: null }
    expect(classifyPasslineEvent(incoming({ venue_id: null }), noVenue, placeholder)).toEqual({
      kind: 'unchanged',
    })
  })

  it('prioritizes name change over price change', () => {
    expect(
      classifyPasslineEvent(
        incoming({ name: 'Renamed', price: 9000, is_free: false }),
        baseExisting,
        resolved('venue-1')
      )
    ).toEqual({ kind: 'name-changed' })
  })
})
