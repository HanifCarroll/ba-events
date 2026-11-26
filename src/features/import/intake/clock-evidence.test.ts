import { describe, expect, it } from 'vitest'
import { citesClock } from './clock-evidence.ts'

describe('intake clock tokens', () => {
  it.each([
    ['21h', '21:00'], ['21 hs', '21:00'], ['21:30', '21:30'], ['20.30', '20:30'],
    ['20.00', '20:00'], ['a las 21', '21:00'], ['9 p. m.', '21:00'], ['12 a.m.', '00:00'],
  ])('matches %s as %s', (excerpt, time) => {
    expect(citesClock(excerpt, time)).toBe(true)
  })

  it('checks the source token before allowing a quote that ends partway through it', () => {
    expect(citesClock('a las 21', '21:00', 'a las 21:30')).toBe(false)
    expect(citesClock('9:30', '09:30', '9:30 p. m.')).toBe(false)
    expect(citesClock('8:30 p. m.', '20:30', '9:30 p. m.')).toBe(false)
  })

  it('does not use dates as clocks', () => {
    for (const date of ['20.11', '20.11.2026', '20/11', '2026-11-20']) expect(citesClock(date, '20:11')).toBe(false)
  })
})
