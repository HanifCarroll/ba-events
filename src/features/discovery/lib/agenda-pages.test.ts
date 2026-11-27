import { describe, expect, it } from 'vitest'
import { homeWindow } from '#features/events/lib/home-feed.ts'
import type { AgendaListing } from '#shared/lib/db/event-reads-d1.server.ts'
import { agendaCopyValues, agendaPages, lastmod, selectAgendaPage } from './agenda-pages.ts'
import { fillCopy } from './copy.ts'

function listing(id: string, starts_at: string, extras: Partial<AgendaListing> = {}): AgendaListing {
  return {
    id, name: id, starts_at, ends_at: null, is_all_day: false, time_tba: false, image_url: 'https://example.test/image.png',
    image_width: null, image_height: null, venue_id: null, venue_name: null, venue_neighborhood: null, price: 1000,
    is_free: false, payWhatYouCan: false, location_tba: false, location_hidden: false, music: false, sourceUrl: null,
    details: { source: 'luma', updated_at: starts_at, description_es: null, ticket_url: null }, ...extras,
  }
}

const friday = listing('friday', '2026-11-27T03:00:00.000Z', { ends_at: '2026-11-27T10:00:00.000Z' })
const thursday = listing('thursday', '2026-11-27T02:30:00.000Z', { ends_at: '2026-11-27T03:00:00.000Z' })
const sunday = listing('sunday', '2026-11-30T02:59:59.999Z', { price: 0 })
const monday = listing('monday', '2026-11-30T03:00:00.000Z', { is_free: true, payWhatYouCan: true })
const nextWeek = listing('next-week', '2026-12-04T03:00:00.000Z')
const events = [thursday, friday, sunday, monday, nextWeek]

function fixture(value: string) {
  const date = new Date(value)
  return { window: homeWindow(date), asOf: +date, events }
}

function select(path: string, date = '2026-11-27T03:00:00.000Z') {
  return selectAgendaPage(fixture(date), agendaPages[path])
}

const ids = (rows: AgendaListing[]) => rows.map(row => row.id)

describe('public date agendas', () => {
  it('switches Hoy at Buenos Aires midnight and excludes an event exactly at its end', () => {
    expect(ids(select('/agenda/hoy', '2026-11-27T02:59:59.999Z').current)).toEqual(['thursday'])
    expect(ids(select('/agenda/hoy').current)).toEqual(['friday'])
  })

  it('includes Friday through Sunday, then starts the coming weekend on Monday in Buenos Aires', () => {
    expect(ids(select('/agenda/fin-de-semana').current)).toEqual(['friday', 'sunday'])
    expect(ids(select('/agenda/fin-de-semana', '2026-11-29T03:00:00.000Z').current)).toEqual(['sunday'])
    expect(ids(select('/agenda/fin-de-semana', '2026-11-30T03:00:00.000Z').current)).toEqual(['next-week'])
  })

  it('stops this week at local midnight on day seven', () => {
    const selection = select('/agenda/esta-semana')
    expect(ids(selection.current)).toEqual(['friday', 'sunday', 'monday'])
    expect(selection.next?.id).toBe('next-week')
    expect(lastmod(selection.current)).toBe(monday.details.updated_at)
  })

  it('counts zero-price events as free unless they are pay-what-you-can', () => {
    expect(ids(select('/agenda/gratis').current)).toEqual(['sunday'])
  })

  it('fills real counts and skips unavailable optional sentences without losing surrounding copy', () => {
    const snapshot = fixture('2026-11-27T03:00:00.000Z')
    const definition = agendaPages['/agenda/hoy']
    const values = agendaCopyValues(snapshot, selectAgendaPage(snapshot, definition))
    const intro = fillCopy(definition.copy.intro, values)
    expect(intro).toContain('Hoy, viernes 27 de noviembre, la agenda de BA Eventos tiene 1 evento')
    expect(intro).toContain('Cada ficha muestra horario')
    expect(intro).not.toContain('Hay 0 eventos gratis')
    expect(intro).not.toContain('{{')
  })
})
