import { describe, expect, it, vi } from 'vitest'

const localeState = vi.hoisted(() => ({ value: 'en' }))

vi.mock('#paraglide/runtime.js', () => ({
  getLocale: () => localeState.value,
}))

import { formatEventTime } from './formatting.ts'

describe('formatEventTime', () => {
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
