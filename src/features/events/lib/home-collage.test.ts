import { describe, expect, it } from 'vitest'
import { agendaEvent } from '../../../../tests/support/home-agenda.ts'
import { homeWindow, selectHomeCollage, type HomeAgendaEvent } from './home-feed.ts'

const asOf = Date.parse('2026-11-26T21:00:00Z')
const window = homeWindow(new Date(asOf))
const firstRow = Array.from({ length: 5 }, (_, i) =>
  agendaEvent(`grid-${i}`, '2026-11-26T22:00:00Z', { venue_id: `grid-venue-${i}` }))
const weekday = '2026-11-26T23:30:00Z'
const flyer = (id: string, overrides: Partial<HomeAgendaEvent> = {}) =>
  agendaEvent(id, window.weekendStart, { venue_id: id, image_width: 720, image_height: 800, ...overrides })
const pick = (events: HomeAgendaEvent[], now = asOf, row = firstRow) =>
  selectHomeCollage({ window, asOf, events: [...row, ...events] }, now).map(({ id }) => id)

describe('homepage flyer collage', () => {
  it('excludes the first five default cards even when they all qualify for the weekend', () => {
    const row = firstRow.map(event => ({ ...event, starts_at: window.weekendStart }))
    const candidates = ['a', 'b', 'c', 'd'].map(id => flyer(id, { starts_at: '2026-11-27T22:00:00Z' }))
    expect(pick(candidates, asOf, row).sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('prioritizes weekend overlap, then portrait artwork, with only one flyer per known venue', () => {
    const events = [
      flyer('weekday', { starts_at: weekday }),
      flyer('landscape', { venue_id: 'shared', image_width: 1000 }),
      flyer('portrait', { venue_id: 'shared' }),
      flyer('overlap', { starts_at: weekday, ends_at: '2026-11-27T04:00:00Z' }),
      flyer('second'), flyer('third'),
      flyer('unknown size', { image_width: null, image_height: null }),
    ]
    expect(pick(events).sort()).toEqual(['overlap', 'portrait', 'second', 'third'])
  })

  it('keeps three weekend flyers without padding with a weekday', () => {
    expect(pick([flyer('weekday', { starts_at: weekday }), flyer('a'), flyer('b'), flyer('c')]).sort())
      .toEqual(['a', 'b', 'c'])
  })

  it('fills from the rest of the week when fewer than three weekend venues qualify', () => {
    const events = [flyer('a'), flyer('b'), flyer('duplicate', { venue_id: 'a' }),
      flyer('c', { starts_at: weekday, venue_id: null }), flyer('d', { starts_at: weekday, venue_id: null })]
    const picks = pick(events)
    expect(picks).toHaveLength(4)
    expect(picks).toEqual(expect.arrayContaining(['b', 'c', 'd']))
    expect(picks.filter(id => id === 'a' || id === 'duplicate')).toHaveLength(1)
  })

  it('omits the collage when artwork, expiry, or venue duplication leaves fewer than three', () => {
    expect(pick([flyer('a'), flyer('b'), flyer('duplicate', { venue_id: 'a' }),
      flyer('empty', { image_url: ' ' }),
      flyer('finished', { starts_at: '2026-11-26T20:00:00Z', ends_at: '2026-11-26T21:00:00Z' }),
    ])).toEqual([])
    expect(selectHomeCollage({ window, asOf, events: [] })).toEqual([])
  })

  it('uses the same order across UTC midnight within a Buenos Aires day', () => {
    const events = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => flyer(id))
    const row = firstRow.map(event => ({ ...event, ends_at: '2026-11-27T03:00:00Z' }))
    expect(pick(events, Date.parse('2026-11-27T01:00:00Z'), row)).toEqual(pick(events, asOf, row))
  })
})
