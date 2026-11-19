import { describe, expect, it } from 'vitest'
import { agendaEvent } from '../../../../tests/support/home-agenda.ts'
import { homeWindow, nextHomeViewChange, pageHomeView, parseHomeFilter, selectHomeView } from './home-feed.ts'

const monday = homeWindow(new Date('2026-11-24T02:59:59.999Z'))
const asOf = Date.parse(monday.start)
const friday = '2026-11-27T03:00:00.000Z'
const weekEnd = '2026-11-30T03:00:00.000Z'

describe('homepage agenda views', () => {
  it('uses Buenos Aires midnight, with an inclusive Friday and exclusive Monday', () => {
    expect(monday).toEqual({ day: '2026-11-23', start: '2026-11-23T03:00:00.000Z', tomorrow: '2026-11-24T03:00:00.000Z', end: weekEnd,
      weekendStart: friday, weekendEnd: weekEnd })
    expect(homeWindow(new Date('2026-11-30T02:59:59.999Z'))).toMatchObject({ day: '2026-11-29', weekendStart: friday, weekendEnd: weekEnd })
    expect(homeWindow(new Date(weekEnd))).toMatchObject({ day: '2026-11-30', weekendStart: '2026-12-04T03:00:00.000Z' })
  })

  it('matches only dates in the weekly window, including late-night local events', () => {
    const today = agendaEvent('Monday night', '2026-11-24T02:45:00.000Z')
    const beforeWeekend = agendaEvent('Thursday night', '2026-11-27T02:59:59.999Z', { ends_at: friday })
    const first = agendaEvent('Friday', friday)
    const last = agendaEvent('Sunday night', '2026-11-30T02:59:59.999Z')
    const tail = agendaEvent('Next Monday', weekEnd)
    const agenda = { window: monday, asOf, events: [today, beforeWeekend, first, last, tail] }
    expect(selectHomeView(agenda, null).events).toEqual([today, beforeWeekend, first, last])
    expect(selectHomeView(agenda, 'hoy')).toEqual({ events: [today], empty: null })
    expect(selectHomeView(agenda, 'finde')).toEqual({ events: [first, last], empty: null })
    expect(parseHomeFilter('teatro')).toBeNull()
  })

  it('shows a Thursday-to-Saturday exhibition in Finde on Wednesday', () => {
    const asOf = Date.parse('2026-11-25T16:00:00.000Z')
    const window = homeWindow(new Date(asOf))
    const exhibition = agendaEvent('Exhibition', '2026-11-26T17:00:00.000Z', { ends_at: '2026-11-28T22:00:00.000Z' })
    const overnight = agendaEvent('Late Thursday', '2026-11-27T02:00:00.000Z')
    expect(selectHomeView({ window, asOf, events: [exhibition, overnight] }, 'finde')).toEqual({
      events: [exhibition, overnight], empty: null,
    })
  })

  it('shows a labeled fallback only after an empty date filter, never before it', () => {
    const thursday = agendaEvent('Thursday', '2026-11-26T20:00:00.000Z')
    const afterWeekend = agendaEvent('Next Monday', weekEnd)
    const agenda = { window: monday, asOf, events: [thursday, afterWeekend] }
    expect(selectHomeView(agenda, 'hoy')).toEqual({ events: [thursday, afterWeekend], empty: 'hoy' })
    expect(selectHomeView(agenda, 'finde')).toEqual({ events: [afterWeekend], empty: 'finde' })
    expect(selectHomeView(agenda, 'musica')).toEqual({ events: [], empty: 'musica' })
    expect(selectHomeView({ window: monday, asOf, events: [afterWeekend] }, null)).toEqual({ events: [], empty: 'feed' })
    expect(selectHomeView({ window: monday, asOf, events: [] }, 'hoy')).toEqual({ events: [], empty: 'feed' })
  })

  it('expires timed events at their end, holds untimed events through local midnight, and keeps an ongoing exhibition', () => {
    const asOf = Date.parse('2026-11-19T17:00:00.000Z')
    const window = homeWindow(new Date(asOf))
    const events = [
      agendaEvent('exhibition', '2026-11-16T18:00:00.000Z', { ends_at: '2026-11-21T00:00:00.000Z', is_all_day: true }),
      agendaEvent('ended yesterday', '2026-11-18T18:00:00.000Z', { ends_at: '2026-11-19T02:59:59.999Z' }),
      agendaEvent('all day', window.start, { ends_at: '2026-11-19T06:00:00.000Z', is_all_day: true }),
      agendaEvent('time TBA', window.start, { time_tba: true }),
      agendaEvent('ends early', '2026-11-19T13:00:00.000Z', { ends_at: '2026-11-19T13:20:00.000Z' }),
      agendaEvent('three hours exactly', '2026-11-19T14:00:00.000Z'),
      agendaEvent('three hours minus a millisecond', '2026-11-19T14:00:00.001Z'),
      agendaEvent('ends later', '2026-11-19T14:30:00.000Z', { ends_at: '2026-11-19T19:00:00.000Z' }),
    ]
    const agenda = { asOf, window, events }
    for (const filter of [null, 'hoy'] as const) {
      expect(selectHomeView(agenda, filter).events.map(({ id }) => id)).toEqual([
        'exhibition', 'all day', 'time TBA', 'three hours minus a millisecond', 'ends later',
      ])
    }
    expect(nextHomeViewChange(agenda, asOf)).toBe(asOf + 1)
    expect(selectHomeView(agenda, 'hoy', Date.parse(window.tomorrow)).events.map(({ id }) => id)).toEqual(['exhibition'])
  })

  it('groups remaining slots only by title, known venue, and Buenos Aires start day', () => {
    const asOf = Date.parse('2026-11-19T17:00:00.000Z')
    const window = homeWindow(new Date(asOf))
    const venue_id = 'casa'
    const events = [
      agendaEvent('expired', '2026-11-19T14:00:00.000Z', { name: 'Visita guiada — Casa de la Cultura', venue_id }),
      agendaEvent('running', '2026-11-19T15:30:00.000Z', { name: 'VISITA GUIADA: Cása de la Cultura', venue_id }),
      agendaEvent('next', '2026-11-19T17:30:00.000Z', { name: 'Visita guiada — Casa de la Cultura', venue_id }),
      agendaEvent('next duplicate', '2026-11-19T17:30:00.000Z', { name: 'Visita guiada — Casa de la Cultura', venue_id }),
      agendaEvent('another venue', '2026-11-19T18:00:00.000Z', { name: 'Visita guiada — Casa de la Cultura', venue_id: 'otra' }),
      agendaEvent('late', '2026-11-20T02:59:59.999Z', { name: 'Visita guiada — Casa de la Cultura', venue_id }),
      agendaEvent('local tomorrow', window.tomorrow, { name: 'Visita guiada — Casa de la Cultura', venue_id }),
    ]
    const agenda = { asOf, window, events }
    const today = selectHomeView(agenda, 'hoy').events
    expect(today.map(({ id }) => id)).toEqual(['next', 'another venue'])
    expect(today[0].slotStarts).toEqual([events[1].starts_at, events[2].starts_at, events[5].starts_at])
    expect(selectHomeView(agenda, null).events.map(({ id }) => id)).toEqual(['next', 'another venue', 'local tomorrow'])
    expect(selectHomeView(agenda, 'hoy', Date.parse(events[2].starts_at)).events.map(({ id }) => id)).toEqual(['another venue', 'late'])
  })

  it('keeps date-only occurrences separate and links a timed group to a displayed slot', () => {
    const asOf = Date.parse('2026-11-18T12:00:00.000Z')
    const window = homeWindow(new Date(asOf))
    const shared = { name: 'Visita guiada', venue_id: 'casa' }
    const tba = agendaEvent('tba', window.tomorrow, { ...shared, time_tba: true })
    const allDay = agendaEvent('all-day', window.tomorrow, { ...shared, is_all_day: true })
    const first = agendaEvent('first', '2026-11-19T18:00:00.000Z', shared)
    const second = agendaEvent('second', '2026-11-19T20:00:00.000Z', shared)
    expect(selectHomeView({ window, asOf, events: [tba, allDay, first, second] }, null).events).toEqual([
      tba, allDay, { ...first, slotStarts: [first.starts_at, second.starts_at] },
    ])
  })

  it('limits date fallback to four cards rather than four occurrences', () => {
    const asOf = Date.parse(monday.start)
    const events = [
      ...Array.from({ length: 5 }, (_, i) => agendaEvent(`slot ${i}`, `2026-11-24T1${i}:00:00.000Z`, { name: 'Taller', venue_id: 'sala' })),
      ...Array.from({ length: 4 }, (_, i) => agendaEvent(`event ${i}`, `2026-11-24T2${i}:00:00.000Z`)),
    ]
    expect(selectHomeView({ window: monday, asOf, events }, 'hoy').events.map(({ id }) => id)).toEqual(['slot 0', 'event 0', 'event 1', 'event 2'])
  })

  it('splits a busy date between pages without splitting a same-day time-slot group', () => {
    const shared = { name: 'Visita guiada', venue_id: 'casa' }
    const firstSlot = agendaEvent('slot-1', '2026-11-23T20:00:00.000Z', shared)
    const secondSlot = agendaEvent('slot-2', '2026-11-23T21:00:00.000Z', shared)
    const following = agendaEvent('following', '2026-11-23T22:00:00.000Z')
    const events = [
      ...Array.from({ length: 23 }, (_, i) => agendaEvent(`card-${i}`, '2026-11-23T18:00:00.000Z')),
      firstSlot, secondSlot, following,
    ]
    const view = selectHomeView({ window: monday, asOf, events }, 'hoy')
    const first = pageHomeView(view, null)
    expect(first.total).toBe(25)
    expect(first.events).toHaveLength(24)
    expect(first.events.at(-1)).toEqual({ ...firstSlot, slotStarts: [firstSlot.starts_at, secondSlot.starts_at] })
    expect(pageHomeView(view, '48').events).toEqual([...first.events, following])
  })

  it('clamps the requested count to whole pages and at most the view total', () => {
    const events = Array.from({ length: 59 }, (_, i) => agendaEvent(`card-${i}`, '2026-11-23T18:00:00.000Z'))
    const view = { events, empty: null }
    for (const value of [null, 'garbage', '1.5', '2e2', '-1', '0', '23', '9'.repeat(309)]) {
      expect(pageHomeView(view, value).events).toHaveLength(24)
    }
    expect(pageHomeView(view, '49').events).toHaveLength(48)
    expect(pageHomeView(view, '999999').events).toHaveLength(59)
    expect(pageHomeView({ events: events.slice(0, 4), empty: 'hoy' }, '48')).toEqual({
      events: events.slice(0, 4), empty: 'hoy', total: 4,
    })
  })

  it('includes zero and explicit free, but not a la gorra or unknown admission', () => {
    const time = '2026-11-23T20:30:00.000Z'
    const zero = agendaEvent('Zero', time, { price: 0 })
    const free = agendaEvent('Marked free', time, { is_free: true })
    const gorra = agendaEvent('A la gorra', time, { payWhatYouCan: true, music: true })
    const unknown = agendaEvent('Unknown', time)
    const agenda = { window: monday, asOf, events: [zero, free, gorra, unknown] }
    expect(selectHomeView(agenda, 'gratis')).toEqual({ events: [zero, free], empty: null })
    expect(selectHomeView(agenda, 'musica')).toEqual({ events: [gorra], empty: null })
  })
})
