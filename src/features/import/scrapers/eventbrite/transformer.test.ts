import { describe, expect, it } from 'vitest'
import { extractEventId, type EventbriteEvent } from './api'
import { transformEventbriteEvent } from './transformer'

const baseEvent: EventbriteEvent = {
  '@type': 'Event',
  name: 'Test event',
  startDate: '2026-08-15',
  endDate: '2026-08-15',
  url: 'https://www.eventbrite.com.ar/e/test-tickets-1234567890',
}

describe('Eventbrite transformer', () => {
  it('extracts IDs from ticket and registration URLs', () => {
    expect(extractEventId(baseEvent.url)).toBe('1234567890')
    expect(
      extractEventId(
        'https://www.eventbrite.com.ar/e/test-registration-9876543210',
      ),
    ).toBe('9876543210')
  })

  it('marks same-day date-only listings as time TBA', () => {
    const transformed = transformEventbriteEvent(baseEvent, null)

    expect(transformed.time_tba).toBe(true)
    expect(transformed.is_all_day).toBe(false)
  })

  it('keeps explicit multi-day listings as all-day', () => {
    const transformed = transformEventbriteEvent(
      { ...baseEvent, endDate: '2026-08-16' },
      null,
    )

    expect(transformed.time_tba).toBe(false)
    expect(transformed.is_all_day).toBe(true)
  })
})
