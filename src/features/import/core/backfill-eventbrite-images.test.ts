import { describe, expect, it } from 'vitest'
import { isFutureEvent, parseArgs } from '../../../../scripts/backfill-eventbrite-images.ts'

describe('future-only Eventbrite image backfill', () => {
  it('selects strictly future timestamps', () => {
    expect(isFutureEvent('2026-08-24T00:00:00Z', '2026-08-23T12:00:00Z')).toBe(true)
    expect(isFutureEvent('2026-08-23T12:00:00Z', '2026-08-23T12:00:00Z')).toBe(false)
    expect(isFutureEvent('2026-08-22T12:00:00Z', '2026-08-23T12:00:00Z')).toBe(false)
  })

  it('defaults to dry-run and requires --apply to write', () => {
    expect(parseArgs([], '2026-08-23T12:00:00Z')).toMatchObject({ apply: false, limit: 1000 })
    expect(parseArgs(['--apply'], '2026-08-23T12:00:00Z')).toMatchObject({ apply: true, limit: 1000 })
  })

  it('accepts an explicit bounded limit and rejects invalid values', () => {
    expect(parseArgs(['--limit', '25'], '2026-08-23T12:00:00Z').limit).toBe(25)
    expect(() => parseArgs(['--limit', '0'])).toThrow('--limit must be an integer between 1 and 1000')
    expect(() => parseArgs(['--limit', 'nope'])).toThrow('--limit must be an integer between 1 and 1000')
  })
})
