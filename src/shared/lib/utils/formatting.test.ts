import { describe, expect, it, vi } from 'vitest'

const localeState = vi.hoisted(() => ({ value: 'en' }))

vi.mock('#paraglide/runtime.js', () => ({
  getLocale: () => localeState.value,
}))

import { formatEventTime } from './formatting.ts'

describe('formatEventTime', () => {
  it('shows the end date when an event crosses a Buenos Aires calendar day', () => {
    localeState.value = 'en'
    const formatted = formatEventTime('2026-10-17T03:00:00Z', '2026-10-18T09:00:00Z').replaceAll(' at ', ', ')
    expect(formatted).toBe('Sat, Oct 17, 12:00 AM - Sun, Oct 18, 6:00 AM')
  })

  it('keeps a time-only end across UTC midnight within the same Buenos Aires day', () => {
    localeState.value = 'en'
    const formatted = formatEventTime('2026-10-17T22:00:00Z', '2026-10-18T01:00:00Z').replaceAll(' at ', ', ')
    expect(formatted).toBe('Sat, Oct 17, 7:00 PM - 10:00 PM')
  })

  it('does not pad English event hours with a leading zero', () => {
    localeState.value = 'en'

    // The date/time separator is ICU-dependent: V8 emits ", ", WebKit/JavaScriptCore
    // (Bun) emits " at ". Normalize it so the exact assertion holds on both runtimes
    // while still pinning the non-padded "4:00 PM" hour.
    const formatted = formatEventTime('2026-08-16T19:00:00.000Z', '2026-08-16T23:00:00.000Z').replace(
      ' at ',
      ', '
    )

    expect(formatted).toBe('Sun, Aug 16, 4:00 PM - 8:00 PM')
  })

  it('keeps two-digit hours in Spanish', () => {
    localeState.value = 'es'

    expect(formatEventTime('2026-08-16T07:00:00.000Z', '2026-08-16T09:00:00.000Z')).toBe(
      'dom, 16 ago, 04:00 - 06:00',
    )
  })
})
