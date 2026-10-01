import { describe, it, expect } from 'vitest'
import { filterByDateRange } from './browser-scraper.ts'
import type { MeetupEvent } from './types.ts'

describe('Meetup inclusive Buenos Aires discovery horizon', () => {
  it('keeps the entire last local day and excludes adjacent local days', () => {
    const rows = ['2026-09-30T23:59:59-03:00', '2026-10-01T00:00:00-03:00', '2026-10-15T23:59:59-03:00', '2026-10-16T00:00:00-03:00']
      .map((dateTime, id) => ({ dateTime, id: String(id) }) as MeetupEvent)
    expect(filterByDateRange(rows, '2026-10-01', '2026-10-15').map(row => row.id)).toEqual(['1', '2'])
  })
})
