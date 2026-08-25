import { describe, expect, it } from 'vitest'
import {
  buildDuplicateInfo,
  computeDiffs,
  extractExternalIds,
  type ExistingEventData,
} from './duplicate-detection.ts'
import type { EventInsert } from '#shared/lib/types.ts'

const EXISTING: ExistingEventData = {
  id: 'existing-uuid',
  external_id: 'ext-123',
  name: 'Noche de Jazz',
  starts_at: '2026-08-15T00:00:00.000Z',
  ends_at: '2026-08-15T03:00:00.000Z',
  venue_id: 'venue-1',
  price: 5000,
  image_url: 'https://example.com/img.jpg',
  link: 'https://example.com/event',
}

function newEvent(overrides: Partial<EventInsert> = {}): EventInsert {
  return {
    name: EXISTING.name,
    starts_at: '2026-08-15T00:00:00Z', // same instant, different format
    ends_at: '2026-08-15T03:00:00+00:00', // same instant, different format
    venue_id: EXISTING.venue_id,
    price: EXISTING.price,
    image_url: EXISTING.image_url,
    link: EXISTING.link,
    source: 'passline',
    external_id: EXISTING.external_id,
    ...overrides,
  }
}

describe('computeDiffs', () => {
  it('reports no changes for an identical event', () => {
    const diffs = computeDiffs(newEvent(), EXISTING)

    expect(diffs.every((d) => !d.hasChanged)).toBe(true)
  })

  it('treats equal timestamps in different formats as unchanged', () => {
    const diffs = computeDiffs(newEvent(), EXISTING)

    const startsAt = diffs.find((d) => d.field === 'starts_at')!
    const endsAt = diffs.find((d) => d.field === 'ends_at')!
    expect(startsAt.hasChanged).toBe(false)
    expect(endsAt.hasChanged).toBe(false)
  })

  it('flags a genuinely changed start time', () => {
    const diffs = computeDiffs(newEvent({ starts_at: '2026-08-15T01:00:00Z' }), EXISTING)

    expect(diffs.find((d) => d.field === 'starts_at')!.hasChanged).toBe(true)
  })

  it('flags name, price, image, and link changes', () => {
    const diffs = computeDiffs(
      newEvent({
        name: 'Noche de Jazz (postponed)',
        price: 7500,
        image_url: null,
        link: 'https://example.com/event-v2',
      }),
      EXISTING
    )

    expect(diffs.find((d) => d.field === 'name')!.hasChanged).toBe(true)
    expect(diffs.find((d) => d.field === 'price')!.hasChanged).toBe(true)
    expect(diffs.find((d) => d.field === 'image_url')!.hasChanged).toBe(true)
    expect(diffs.find((d) => d.field === 'link')!.hasChanged).toBe(true)
  })

  it('does not flag venue_id when the new scrape has no venue (preserves existing)', () => {
    const diffs = computeDiffs(newEvent({ venue_id: null }), EXISTING)

    expect(diffs.find((d) => d.field === 'venue_id')!.hasChanged).toBe(false)
  })

  it('flags venue_id when the new scrape has a different venue', () => {
    const diffs = computeDiffs(newEvent({ venue_id: 'venue-2' }), EXISTING)

    const venue = diffs.find((d) => d.field === 'venue_id')!
    expect(venue.hasChanged).toBe(true)
    expect(venue.existingValue).toBe('venue-1')
    expect(venue.newValue).toBe('venue-2')
  })

  it('flags a newly set end date when existing has none', () => {
    const existingNoEnd = { ...EXISTING, ends_at: null }
    const diffs = computeDiffs(newEvent(), existingNoEnd)

    expect(diffs.find((d) => d.field === 'ends_at')!.hasChanged).toBe(true)
  })

  it('compares every DIFF_FIELDS entry so a new field cannot be silently skipped', () => {
    const diffs = computeDiffs(newEvent(), EXISTING)

    expect(diffs.map((d) => d.field)).toEqual([
      'name',
      'starts_at',
      'ends_at',
      'venue_id',
      'price',
      'image_url',
      'link',
    ])
  })
})

describe('buildDuplicateInfo', () => {
  it('reports hasChanges=false for identical events', () => {
    const info = buildDuplicateInfo(newEvent(), EXISTING)

    expect(info.hasChanges).toBe(false)
    expect(info.existingId).toBe(EXISTING.id)
    expect(info.externalId).toBe(EXISTING.external_id)
  })

  it('reports hasChanges=true when any field changed', () => {
    const info = buildDuplicateInfo(newEvent({ price: 9999 }), EXISTING)

    expect(info.hasChanges).toBe(true)
  })
})

describe('extractExternalIds', () => {
  it('collects ids from single transforms and skips missing ids', () => {
    const previews = [{ a: 1 }, { a: 2 }, { a: 3 }]
    const ids = extractExternalIds(previews, (p) =>
      p.a === 2 ? { external_id: null } : { external_id: `ext-${p.a}` }
    )

    expect(ids).toEqual(['ext-1', 'ext-3'])
  })

  it('flattens array transforms (one preview producing multiple events)', () => {
    const previews = [{ ids: ['a', 'b'] }, { ids: ['c'] }]
    const ids = extractExternalIds(previews, (p) => p.ids.map((id) => ({ external_id: id })))

    expect(ids).toEqual(['a', 'b', 'c'])
  })

})
