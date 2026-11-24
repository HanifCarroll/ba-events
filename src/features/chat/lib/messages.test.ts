import { describe, expect, it } from 'vitest'
import * as m from '#paraglide/messages.js'
import { formatPrice } from '#features/chat/lib/messages.ts'

describe('formatPrice', () => {
  it('presents zero-priced events as free even when the source flag is inconsistent', () => {
    expect(formatPrice(0, false)).toBe(m.event_free())
  })

  it('keeps positive ARS prices numeric', () => {
    expect(formatPrice(10000, false)).toBe('$10.000 ARS')
  })

  it('presents confirmed free admission even without a numeric price', () => {
    expect(formatPrice(null, true)).toBe(m.event_free())
  })

  it('returns no label for an unknown price', () => {
    expect(formatPrice(null, false)).toBeNull()
  })
})
