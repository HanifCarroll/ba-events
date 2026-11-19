import { describe, expect, it } from 'vitest'
import { agendaEvent } from '../../../../tests/support/home-agenda.ts'
import { homeWindow, parseHomeFilter, selectHomeView } from './home-feed.ts'

const monday = homeWindow(new Date('2026-11-24T02:59:59.999Z'))
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
    const beforeWeekend = agendaEvent('Thursday night', '2026-11-27T02:59:59.999Z')
    const first = agendaEvent('Friday', friday)
    const last = agendaEvent('Sunday night', '2026-11-30T02:59:59.999Z')
    const tail = agendaEvent('Next Monday', weekEnd)
    const agenda = { window: monday, events: [today, beforeWeekend, first, last, tail] }
    expect(selectHomeView(agenda, null).events).toEqual([today, beforeWeekend, first, last])
    expect(selectHomeView(agenda, 'hoy')).toEqual({ events: [today], empty: null })
    expect(selectHomeView(agenda, 'finde')).toEqual({ events: [first, last], empty: null })
    expect(parseHomeFilter('teatro')).toBeNull()
  })

  it('shows a labeled fallback only after an empty date filter, never before it', () => {
    const thursday = agendaEvent('Thursday', '2026-11-26T20:00:00.000Z')
    const afterWeekend = agendaEvent('Next Monday', weekEnd)
    const agenda = { window: monday, events: [thursday, afterWeekend] }
    expect(selectHomeView(agenda, 'hoy')).toEqual({ events: [thursday, afterWeekend], empty: 'hoy' })
    expect(selectHomeView(agenda, 'finde')).toEqual({ events: [afterWeekend], empty: 'finde' })
    expect(selectHomeView(agenda, 'musica')).toEqual({ events: [], empty: 'musica' })
    expect(selectHomeView({ window: monday, events: [afterWeekend] }, null)).toEqual({ events: [], empty: 'feed' })
    expect(selectHomeView({ window: monday, events: [] }, 'hoy')).toEqual({ events: [], empty: 'feed' })
  })

  it('includes zero and explicit free, but not a la gorra or unknown admission', () => {
    const time = '2026-11-23T20:30:00.000Z'
    const zero = agendaEvent('Zero', time, { price: 0 })
    const free = agendaEvent('Marked free', time, { is_free: true })
    const gorra = agendaEvent('A la gorra', time, { payWhatYouCan: true, music: true })
    const unknown = agendaEvent('Unknown', time)
    const agenda = { window: monday, events: [zero, free, gorra, unknown] }
    expect(selectHomeView(agenda, 'gratis')).toEqual({ events: [zero, free], empty: null })
    expect(selectHomeView(agenda, 'musica')).toEqual({ events: [gorra], empty: null })
  })
})
