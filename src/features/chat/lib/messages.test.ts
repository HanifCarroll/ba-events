import { describe, expect, it } from 'vitest'
import * as m from '@/paraglide/messages'
import { formatPrice } from '@/features/chat/lib/messages'

describe('formatPrice', () => {
  it('presents zero-priced events as free even when the source flag is inconsistent', () => {
    expect(formatPrice(0, false)).toBe(m.event_free())
  })

  it('keeps positive ARS prices numeric', () => {
    expect(formatPrice(10000, false)).toBe('$10.000 ARS')
  })

  it('localizes an unknown price', () => {
    expect(formatPrice(null, false)).toBe(m.event_price_tba())
  })
})
